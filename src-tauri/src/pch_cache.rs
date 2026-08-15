use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::commands::compile_run::CompileScenario;
use crate::config::CompilerConfig;
use crate::error::AppError;
use crate::runner::{run_with_limits, ResourceLimits};

/// PCH LRU 上限套数。
///
/// Run(O0) + Test(O2) 恰好 2 套共存互不淘汰；每套 40-100MB，
/// 总占用上限 ~200MB，用户很少改 cpp_standard，2 套覆盖典型工作集。
const MAX_PCH_ENTRIES: usize = 2;

/// PCH 是否在当前平台启用（仅 Windows：TDM-GCC 冷启动慢且 bits/stdc++.h 为 GCC 特有）。
/// 用 `cfg!` 运行时布尔而非条件编译，保证全平台代码可编译、核心逻辑可测试。
pub fn pch_platform_enabled() -> bool {
    cfg!(windows)
}

/// PCH 预编译头缓存。
///
/// 维护 `params_hash → .gch 路径` 映射，按参数组合（编译器 + args）分目录存储：
///
/// ```text
/// <pch_dir>/<params_hash_hex>/
///   ├── pch.h        ← 内容固定 "#include <bits/stdc++.h>"
///   └── pch.h.gch    ← PCH 产物
/// ```
///
/// - 后台异步生成：未命中时调用方 spawn task，`generating` 防并发重复生成
/// - 失败标记：`failed` 记录本会话失败过的组合，不再重试（清空缓存/重启即重试）
/// - `Clone` + `Arc` 内部：支持 move 进 `tokio::spawn` 的 'static 要求
#[derive(Clone)]
pub struct PchCache {
    inner: Arc<PchCacheInner>,
}

struct PchCacheInner {
    entries: Mutex<HashMap<u64, PchEntry>>,
    /// 生成中的 params_hash（防并发重复生成）
    generating: Mutex<HashSet<u64>>,
    /// 本会话生成失败的 params_hash（不再重试）
    failed: Mutex<HashSet<u64>>,
    pch_dir: PathBuf,
}

pub struct PchEntry {
    pub gch_path: PathBuf,
    pub last_used: Instant,
}

/// 全文搜 bits/stdc++.h（宽容检测：注释中出现也无害，只是多生成一套 PCH）
pub fn uses_bits_stdcpp(code: &str) -> bool {
    code.contains("#include <bits/stdc++.h>")
}

/// 参数组合哈希（与 build_cache_key 同源但不含 code——粒度是"参数组合"而非"代码版本"）。
/// 覆盖 compiler_path 与 args_for(scenario)（含 -std / -O / -Wall / -fexec-charset / extra_args）。
pub fn pch_params_hash(config: &CompilerConfig, scenario: CompileScenario) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    config.compiler_path.hash(&mut hasher);
    config.args_for(scenario).hash(&mut hasher);
    hasher.finish()
}

impl PchCache {
    /// 创建实例。扫描 pch_dir 重建 entries（跨重启复用）：
    /// - 子目录含 pch.h.gch → 解析 hash 加入 entries
    /// - 其余子目录视为孤儿删除
    pub fn new(pch_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&pch_dir);
        let mut entries: HashMap<u64, PchEntry> = HashMap::new();

        if let Ok(subdirs) = std::fs::read_dir(&pch_dir) {
            for entry in subdirs.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let dir_name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n,
                    None => continue,
                };
                let key = match u64::from_str_radix(dir_name, 16) {
                    Ok(k) => k,
                    Err(_) => {
                        let _ = std::fs::remove_dir_all(&path);
                        continue;
                    }
                };
                let gch_path = path.join("pch.h.gch");
                if !gch_path.exists() {
                    let _ = std::fs::remove_dir_all(&path);
                    continue;
                }
                entries.insert(
                    key,
                    PchEntry {
                        gch_path,
                        last_used: Instant::now(),
                    },
                );
            }
        }

        Self {
            inner: Arc::new(PchCacheInner {
                entries: Mutex::new(entries),
                generating: Mutex::new(HashSet::new()),
                failed: Mutex::new(HashSet::new()),
                pch_dir,
            }),
        }
    }

    /// 查询可用 PCH。命中返回 .gch 路径并更新 last_used。
    ///
    /// 平台开关由调用方用 `pch_platform_enabled()` 守卫（保证本方法核心逻辑跨平台可测）。
    pub fn acquire_pch(
        &self,
        config: &CompilerConfig,
        scenario: CompileScenario,
        code: &str,
    ) -> Option<PathBuf> {
        if !uses_bits_stdcpp(code) {
            return None;
        }
        let hash = pch_params_hash(config, scenario);
        if self.inner.failed.lock().ok()?.contains(&hash) {
            return None;
        }
        let mut entries = self.inner.entries.lock().ok()?;
        if let Some(entry) = entries.get_mut(&hash) {
            if entry.gch_path.exists() {
                entry.last_used = Instant::now();
                return Some(entry.gch_path.clone());
            }
            // 文件丢失（外部删除/损坏）→ 移除 entry，调用方按 miss 处理并重新生成
            entries.remove(&hash);
        }
        None
    }

    /// 尝试标记"生成中"。已在生成中或本会话已失败 → None；
    /// 否则标记并返回 (hash, hash_dir)，调用方 spawn 后台生成 task。
    pub fn try_start_generation(
        &self,
        config: &CompilerConfig,
        scenario: CompileScenario,
    ) -> Option<(u64, PathBuf)> {
        let hash = pch_params_hash(config, scenario);
        {
            let failed = self.inner.failed.lock().ok()?;
            if failed.contains(&hash) {
                return None;
            }
        }
        let mut generating = self.inner.generating.lock().ok()?;
        if !generating.insert(hash) {
            // 已在生成中
            return None;
        }
        let hash_dir = self.inner.pch_dir.join(format!("{:016x}", hash));
        Some((hash, hash_dir))
    }

    /// 后台生成成功回调：移出 generating，插入 entry，LRU 超 2 套淘汰最旧。
    /// .gch 文件不存在（clear 竞态后目录被删）则放弃插入。
    pub fn finish_generation(&self, hash: u64) {
        if let Ok(mut generating) = self.inner.generating.lock() {
            generating.remove(&hash);
        }
        let Ok(mut entries) = self.inner.entries.lock() else {
            return;
        };
        let hash_dir = self.inner.pch_dir.join(format!("{:016x}", hash));
        let gch_path = hash_dir.join("pch.h.gch");
        if !gch_path.exists() {
            return;
        }
        entries.insert(
            hash,
            PchEntry {
                gch_path,
                last_used: Instant::now(),
            },
        );
        while entries.len() > MAX_PCH_ENTRIES {
            if let Some((&oldest_key, _)) = entries.iter().min_by_key(|(_, e)| e.last_used) {
                if let Some(removed) = entries.remove(&oldest_key) {
                    if let Some(parent) = removed.gch_path.parent() {
                        let _ = std::fs::remove_dir_all(parent);
                    }
                }
            } else {
                break;
            }
        }
    }

    /// 后台生成失败回调：移出 generating，加入 failed（本会话不再试），删除 hash 子目录。
    pub fn abort_generation(&self, hash: u64) {
        if let Ok(mut generating) = self.inner.generating.lock() {
            generating.remove(&hash);
        }
        if let Ok(mut failed) = self.inner.failed.lock() {
            failed.insert(hash);
        }
        let hash_dir = self.inner.pch_dir.join(format!("{:016x}", hash));
        let _ = std::fs::remove_dir_all(&hash_dir);
    }

    /// 清空全部状态并删除磁盘子目录（保留 pch_dir 本身）。
    /// 同时重置 failed 标记（清空缓存即用户的"重试"语义）。
    pub fn clear(&self) {
        if let Ok(mut entries) = self.inner.entries.lock() {
            entries.clear();
        }
        if let Ok(mut generating) = self.inner.generating.lock() {
            generating.clear();
        }
        if let Ok(mut failed) = self.inner.failed.lock() {
            failed.clear();
        }
        if let Ok(subdirs) = std::fs::read_dir(&self.inner.pch_dir) {
            for entry in subdirs.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let _ = std::fs::remove_dir_all(&p);
                }
            }
        }
        let _ = std::fs::create_dir_all(&self.inner.pch_dir);
    }

    /// (套数, 磁盘占用字节数)。walkdir 递归统计。
    pub fn stats(&self) -> (usize, u64) {
        let count = self
            .inner
            .entries
            .lock()
            .map(|e| e.len())
            .unwrap_or(0);
        let bytes = dir_size_bytes(&self.inner.pch_dir);
        (count, bytes)
    }
}

/// 递归统计目录下所有文件字节数（目录不存在返回 0）
fn dir_size_bytes(dir: &Path) -> u64 {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

/// 生成 PCH：写 pch.h（内容固定 `#include <bits/stdc++.h>`，由编译器自身定位头文件，
/// 无需拼接 bits/stdc++.h 物理路径）并执行 `g++ <args> -x c++-header pch.h -o pch.h.gch`。
///
/// fsize 放宽到 512MB：.gch 是编译器合法产物（bits/stdc++.h 约 40-100MB），
/// 用户配置的 fsize 限制针对学生程序输出，不应约束 PCH 生成（默认 10MB 会直接写失败）。
/// 由后台 tokio task 调用；成功后调用方应调 `finish_generation`，失败调 `abort_generation`。
pub async fn generate_pch(
    compiler_path: &Path,
    args: &[String],
    hash_dir: &Path,
    timeout: Duration,
    mut limits: ResourceLimits,
) -> Result<PathBuf, AppError> {
    limits.fsize_mb = 512;
    std::fs::create_dir_all(hash_dir)?;
    let pch_h = hash_dir.join("pch.h");
    std::fs::write(&pch_h, "#include <bits/stdc++.h>\n")?;
    let gch_path = hash_dir.join("pch.h.gch");

    let mut cmd: Vec<String> = vec![compiler_path.to_string_lossy().into_owned()];
    cmd.extend(args.iter().cloned());
    cmd.push("-x".into());
    cmd.push("c++-header".into());
    cmd.push(pch_h.to_string_lossy().into_owned());
    cmd.push("-o".into());
    cmd.push(gch_path.to_string_lossy().into_owned());

    let out = run_with_limits(cmd, hash_dir, None, timeout, limits, None).await?;
    if out.exit_code != Some(0) {
        return Err(AppError::Other {
            detail: format!(
                "PCH 生成失败: {}",
                String::from_utf8_lossy(&out.stderr)
            ),
        });
    }
    Ok(gch_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::AppSettings;
    use tempfile::TempDir;

    fn make_config() -> CompilerConfig {
        let s = AppSettings::default();
        CompilerConfig::from_settings(&s, None).unwrap()
    }

    // ============ 纯函数测试 ============

    #[test]
    fn test_pch_params_hash_changes_with_scenario() {
        let config = make_config();
        let h_run = pch_params_hash(&config, CompileScenario::Run);
        let h_test = pch_params_hash(&config, CompileScenario::Test);
        assert_ne!(h_run, h_test, "Run(O0) 与 Test(O2) 应有不同 hash");
    }

    #[test]
    fn test_pch_params_hash_changes_with_compiler_path() {
        let mut s = AppSettings::default();
        s.compiler.compiler_path = Some("/usr/bin/g++".into());
        let c1 = CompilerConfig::from_settings(&s, None).unwrap();
        let mut s2 = AppSettings::default();
        s2.compiler.compiler_path = Some("/usr/local/bin/g++".into());
        let c2 = CompilerConfig::from_settings(&s2, None).unwrap();
        assert_ne!(
            pch_params_hash(&c1, CompileScenario::Run),
            pch_params_hash(&c2, CompileScenario::Run)
        );
    }

    #[test]
    fn test_pch_params_hash_changes_with_args() {
        let config = make_config();
        let mut s2 = AppSettings::default();
        s2.compiler.cpp_standard = "c++20".into();
        let config2 = CompilerConfig::from_settings(&s2, None).unwrap();
        assert_ne!(
            pch_params_hash(&config, CompileScenario::Run),
            pch_params_hash(&config2, CompileScenario::Run),
            "cpp_standard 变化（args 不同）应有不同 hash"
        );
    }

    #[test]
    fn test_pch_params_hash_stable() {
        let config = make_config();
        assert_eq!(
            pch_params_hash(&config, CompileScenario::Run),
            pch_params_hash(&config, CompileScenario::Run)
        );
    }

    #[test]
    fn test_uses_bits_stdcpp_full_text() {
        assert!(uses_bits_stdcpp("#include <bits/stdc++.h>\nint main(){}"));
        assert!(uses_bits_stdcpp("// comment\n#include <bits/stdc++.h>\nint main(){}"));
        assert!(uses_bits_stdcpp("int main(){ /* #include <bits/stdc++.h> */ }"));
        assert!(!uses_bits_stdcpp("#include <iostream>\nint main(){}"));
        assert!(!uses_bits_stdcpp(""));
    }

    // ============ acquire / 生成状态测试 ============

    #[test]
    fn test_acquire_requires_bits_stdcpp() {
        let cache = PchCache::new(TempDir::new().unwrap().path().join("pch"));
        let config = make_config();
        assert!(cache
            .acquire_pch(&config, CompileScenario::Run, "#include <iostream>")
            .is_none());
    }

    #[test]
    fn test_acquire_hit_updates_and_returns_path() {
        let tmp = TempDir::new().unwrap();
        let cache = PchCache::new(tmp.path().join("pch"));
        let config = make_config();
        let code = "#include <bits/stdc++.h>\nint main(){}";
        let hash = pch_params_hash(&config, CompileScenario::Run);

        // 手动构造已生成的 PCH（绕过真实编译）
        let hash_dir = tmp.path().join("pch").join(format!("{:016x}", hash));
        std::fs::create_dir_all(&hash_dir).unwrap();
        std::fs::write(hash_dir.join("pch.h.gch"), b"fake gch").unwrap();
        cache.finish_generation(hash);

        let got = cache.acquire_pch(&config, CompileScenario::Run, code);
        assert!(got.is_some(), "已生成的 PCH 应命中");
        assert_eq!(got.unwrap(), hash_dir.join("pch.h.gch"));
    }

    #[test]
    fn test_acquire_returns_none_without_gch_file() {
        let tmp = TempDir::new().unwrap();
        let cache = PchCache::new(tmp.path().join("pch"));
        let config = make_config();
        let code = "#include <bits/stdc++.h>\nint main(){}";
        let hash = pch_params_hash(&config, CompileScenario::Run);

        let hash_dir = tmp.path().join("pch").join(format!("{:016x}", hash));
        std::fs::create_dir_all(&hash_dir).unwrap();
        std::fs::write(hash_dir.join("pch.h.gch"), b"fake").unwrap();
        cache.finish_generation(hash);

        // 模拟文件丢失/损坏
        std::fs::remove_file(hash_dir.join("pch.h.gch")).unwrap();
        assert!(cache.acquire_pch(&config, CompileScenario::Run, code).is_none());
        // entry 应被移除（stats 归零）
        assert_eq!(cache.stats().0, 0);
    }

    #[test]
    fn test_try_start_generation_prevents_concurrent() {
        let cache = PchCache::new(TempDir::new().unwrap().path().join("pch"));
        let config = make_config();
        let first = cache.try_start_generation(&config, CompileScenario::Run);
        assert!(first.is_some(), "首次应允许生成");
        let second = cache.try_start_generation(&config, CompileScenario::Run);
        assert!(second.is_none(), "生成中不允许重复生成");
    }

    #[test]
    fn test_failed_hash_blocks_acquire_and_generation() {
        let cache = PchCache::new(TempDir::new().unwrap().path().join("pch"));
        let config = make_config();
        let code = "#include <bits/stdc++.h>\nint main(){}";
        let hash = pch_params_hash(&config, CompileScenario::Run);

        let (h, _dir) = cache.try_start_generation(&config, CompileScenario::Run).unwrap();
        assert_eq!(h, hash);
        cache.abort_generation(hash);

        assert!(cache.acquire_pch(&config, CompileScenario::Run, code).is_none());
        assert!(cache.try_start_generation(&config, CompileScenario::Run).is_none(),
            "本会话失败的组合不再重试");
    }

    #[test]
    fn test_finish_generation_skips_missing_gch() {
        let tmp = TempDir::new().unwrap();
        let cache = PchCache::new(tmp.path().join("pch"));
        let hash = 0x123u64;
        // 不创建文件直接 finish（clear 竞态场景）
        cache.finish_generation(hash);
        assert_eq!(cache.stats().0, 0, "gch 不存在不应插入 entry");
    }

    // ============ LRU / 磁盘扫描 / clear / stats 测试 ============

    #[test]
    fn test_lru_evicts_oldest_beyond_two() {
        let tmp = TempDir::new().unwrap();
        let pch_dir = tmp.path().join("pch");
        let cache = PchCache::new(pch_dir.clone());

        fn seed(cache: &PchCache, pch_dir: &Path, key: u64, sleep: bool) {
            if sleep {
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            let dir = pch_dir.join(format!("{:016x}", key));
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("pch.h.gch"), b"gch").unwrap();
            cache.finish_generation(key);
        }

        seed(&cache, &pch_dir, 1, false);
        seed(&cache, &pch_dir, 2, false);
        assert_eq!(cache.stats().0, 2);

        // 第 3 套 → 淘汰 key=1（最旧）
        seed(&cache, &pch_dir, 3, true);
        assert_eq!(cache.stats().0, 2, "上限 2 套");
        assert!(!pch_dir.join(format!("{:016x}", 1u64)).exists(), "最旧子目录应被删除");
        assert!(pch_dir.join(format!("{:016x}", 3u64)).exists());
    }

    #[test]
    fn test_new_scans_and_cleans_orphans() {
        let tmp = TempDir::new().unwrap();
        let pch_dir = tmp.path().join("pch");
        std::fs::create_dir_all(&pch_dir).unwrap();

        // 合法：含 pch.h.gch
        let ok_dir = pch_dir.join(format!("{:016x}", 0xaau64));
        std::fs::create_dir_all(&ok_dir).unwrap();
        std::fs::write(ok_dir.join("pch.h.gch"), b"gch").unwrap();
        // 孤儿 1：非法目录名
        let bad = pch_dir.join("not_hex");
        std::fs::create_dir_all(&bad).unwrap();
        // 孤儿 2：缺 .gch
        let no_gch = pch_dir.join(format!("{:016x}", 0xbbu64));
        std::fs::create_dir_all(&no_gch).unwrap();

        let cache = PchCache::new(pch_dir);
        assert_eq!(cache.stats().0, 1);
        assert!(!bad.exists());
        assert!(!no_gch.exists());
    }

    #[test]
    fn test_clear_resets_everything() {
        let tmp = TempDir::new().unwrap();
        let pch_dir = tmp.path().join("pch");
        let cache = PchCache::new(pch_dir.clone());

        let dir = pch_dir.join(format!("{:016x}", 0xccu64));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("pch.h.gch"), b"gch").unwrap();
        cache.finish_generation(0xcc);
        let (h, _) = cache.try_start_generation(&make_config(), CompileScenario::Run).unwrap();
        cache.abort_generation(h); // 记录 failed

        cache.clear();
        assert_eq!(cache.stats().0, 0, "entries 应清空");
        assert!(!dir.exists(), "磁盘子目录应删除");
        assert!(pch_dir.exists(), "pch_dir 本身保留");
        // failed 已重置：允许再次生成
        assert!(cache.try_start_generation(&make_config(), CompileScenario::Run).is_some());
    }

    #[test]
    fn test_stats_counts_disk_bytes() {
        let tmp = TempDir::new().unwrap();
        let pch_dir = tmp.path().join("pch");
        let cache = PchCache::new(pch_dir.clone());

        let dir = pch_dir.join(format!("{:016x}", 0xddu64));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("pch.h"), vec![0u8; 100]).unwrap();
        std::fs::write(dir.join("pch.h.gch"), vec![0u8; 900]).unwrap();
        cache.finish_generation(0xdd);

        let (count, bytes) = cache.stats();
        assert_eq!(count, 1);
        assert_eq!(bytes, 1000, "应递归统计子目录所有文件字节");
    }

    // ============ generate_pch 失败路径（macOS 真实触发：clang 无 bits/stdc++.h） ============

    #[tokio::test]
    async fn test_generate_pch_failure_aborts() {
        let tmp = TempDir::new().unwrap();
        let cache = PchCache::new(tmp.path().join("pch"));
        let config = make_config();
        let limits = ResourceLimits::from_settings(&AppSettings::default().runtime, &AppSettings::default().test);

        let (hash, hash_dir) = cache
            .try_start_generation(&config, CompileScenario::Run)
            .unwrap();
        let result = generate_pch(
            &config.compiler_path,
            config.args_for(CompileScenario::Run),
            &hash_dir,
            std::time::Duration::from_secs(30),
            limits,
        )
        .await;
        if result.is_err() {
            // macOS（clang++ 无 bits/stdc++.h）真实失败路径
            cache.abort_generation(hash);
            assert!(cache.try_start_generation(&config, CompileScenario::Run).is_none(),
                "失败后本会话不再重试");
            assert!(!hash_dir.exists(), "失败应清理 hash 子目录");
        }
        // Windows（TDM-GCC 有 bits/stdc++.h）生成成功时跳过断言，成功路径由 finish 流程覆盖
    }

    // ============ -include-pch 参数通路集成测试（跨平台真实 PCH） ============

    #[tokio::test]
    async fn test_compile_with_pch_integration() {
        // 用 iostream 生成真实 PCH（macOS clang++ / Windows g++ 均支持 -x c++-header），
        // 验证 compile_only 的 -include-pch 参数通路真实可用
        use crate::commands::compile_run::{compile_only, CompileResult, CompileScenario as Cs};
        use which::which;

        let compiler = which("clang++")
            .or_else(|_| which("g++"))
            .expect("测试环境需有 clang++ 或 g++");

        let tmp = TempDir::new().unwrap();
        let pch_h = tmp.path().join("pch.h");
        std::fs::write(&pch_h, "#include <iostream>\n").unwrap();
        let gch = tmp.path().join("pch.h.gch");

        let s = AppSettings::default();
        let config = CompilerConfig::from_settings(&s, None).unwrap();
        let mut limits = ResourceLimits::from_settings(&s.runtime, &s.test);
        // 与 generate_pch 一致：放宽 fsize（.gch 是编译器合法产物，超默认 10MB）
        limits.fsize_mb = 512;

        let gen = run_with_limits(
            vec![
                compiler.to_string_lossy().into_owned(),
                "-std=c++17".into(),
                "-x".into(),
                "c++-header".into(),
                pch_h.to_string_lossy().into_owned(),
                "-o".into(),
                gch.to_string_lossy().into_owned(),
            ],
            tmp.path(),
            None,
            std::time::Duration::from_secs(30),
            limits,
            None,
        )
        .await
        .unwrap();
        assert_eq!(gen.exit_code, Some(0), "PCH 生成应成功");

        let work = TempDir::new().unwrap();
        let code = "#include <iostream>\nint main() { std::cout << \"pch\" << std::endl; }";
        let result = compile_only(code, &config, Cs::Run, work.path(), limits, None, Some(&gch))
            .await
            .expect("带 PCH 编译应成功");
        assert!(
            matches!(result, CompileResult::Success { .. }),
            "-include-pch 通路应可用"
        );
    }
}
