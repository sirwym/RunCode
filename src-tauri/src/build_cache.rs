use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use crate::commands::compile_run::CompileScenario;
use crate::config::CompilerConfig;

/// LRU 上限条目数。
///
/// 单条缓存约 = main.exe（Windows ~290KB，macOS ~50KB）+ main.cpp（< 100KB），
/// 20 条总量 < 8MB，对磁盘无压力，且能覆盖典型教学场景的 tab 工作集。
const MAX_ENTRIES: usize = 20;

/// 编译产物缓存。
///
/// 维护 `cache_key → 缓存 exe 母本路径` 的映射。命中时调用方拷贝母本到自己的
/// work_dir，运行阶段对母本只读，互不干扰。
///
/// - 线程安全：内部用 Mutex 保护 HashMap
/// - 跨重启复用：`new()` 扫描磁盘子目录重建 entries
/// - LRU 淘汰：插入超限时删除 `last_used` 最旧的条目及其磁盘子目录
pub struct BuildCache {
    entries: Mutex<HashMap<u64, CacheEntry>>,
    cache_dir: PathBuf,
}

struct CacheEntry {
    /// 缓存 exe 母本路径：cache_dir/<key_hex>/main[.exe]
    exe_path: PathBuf,
    /// 上次访问时间（LRU 用）
    last_used: Instant,
}

/// 平台相关的可执行文件名
#[cfg(unix)]
fn exe_name() -> &'static str {
    "main"
}
#[cfg(windows)]
fn exe_name() -> &'static str {
    "main.exe"
}

/// 构建 cache_key（纯函数，便于单测）
///
/// 输入项必须覆盖所有影响二进制产物的参数：
/// - code：源码内容
/// - scenario：Run=O0 / Test=O2，不同 scenario 参数不同
/// - compiler_path：切换编译器必须重编译
/// - args_for(scenario)：包含 -std / -O / -Wall / -fexec-charset / extra_args
pub fn build_cache_key(
    code: &str,
    config: &CompilerConfig,
    scenario: CompileScenario,
) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    code.hash(&mut hasher);
    scenario.hash(&mut hasher);
    config.compiler_path.hash(&mut hasher);
    config.args_for(scenario).hash(&mut hasher);
    hasher.finish()
}

impl BuildCache {
    /// 创建缓存实例。
    ///
    /// 扫描 `cache_dir` 下所有 `<key_hex>/` 子目录重建 entries，实现跨重启复用：
    /// - 子目录含 main[.exe] → 解析 key 加入 entries（last_used = now）
    /// - 子目录无 main[.exe] 或 key 解析失败 → 视为孤儿，删除
    /// - cache_dir 不存在 → 创建空目录
    pub fn new(cache_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&cache_dir);
        let mut entries: HashMap<u64, CacheEntry> = HashMap::new();

        if let Ok(subdirs) = std::fs::read_dir(&cache_dir) {
            for entry in subdirs.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let dir_name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) => n,
                    None => continue,
                };
                // 子目录名应为 16 位 hex（u64）
                let key = match u64::from_str_radix(dir_name, 16) {
                    Ok(k) => k,
                    Err(_) => {
                        // 非法目录名，视为孤儿删除
                        let _ = std::fs::remove_dir_all(&path);
                        continue;
                    }
                };
                let exe_path = path.join(exe_name());
                if !exe_path.exists() {
                    // 缺 exe 母本，视为孤儿删除
                    let _ = std::fs::remove_dir_all(&path);
                    continue;
                }
                entries.insert(
                    key,
                    CacheEntry {
                        exe_path,
                        last_used: Instant::now(),
                    },
                );
            }
        }

        Self {
            entries: Mutex::new(entries),
            cache_dir,
        }
    }

    /// 查询缓存。命中时返回 exe 母本路径并更新 last_used。
    pub fn get(&self, key: u64) -> Option<PathBuf> {
        let mut entries = self.entries.lock().ok()?;
        if let Some(entry) = entries.get_mut(&key) {
            entry.last_used = Instant::now();
            Some(entry.exe_path.clone())
        } else {
            None
        }
    }

    /// 插入缓存条目。拷贝 source_exe 到 `cache_dir/<key_hex>/main[.exe]`，
    /// 同时写入 main.cpp 源码快照便于排查。超限时按 LRU 淘汰最旧条目。
    pub fn insert(&self, key: u64, source_exe: &Path, code: &str) {
        let key_hex = format!("{:016x}", key);
        let sub_dir = self.cache_dir.join(&key_hex);
        let target_exe = sub_dir.join(exe_name());

        // 创建子目录并拷贝 exe 母本
        if std::fs::create_dir_all(&sub_dir).is_err() {
            return;
        }
        if std::fs::copy(source_exe, &target_exe).is_err() {
            // 拷贝失败（杀软锁定等）→ 清理已创建的子目录，放弃缓存
            let _ = std::fs::remove_dir_all(&sub_dir);
            return;
        }
        // 写入源码快照（失败不影响缓存主路径）
        let _ = std::fs::write(sub_dir.join("main.cpp"), code);

        let mut entries = match self.entries.lock() {
            Ok(e) => e,
            Err(_) => return,
        };
        entries.insert(
            key,
            CacheEntry {
                exe_path: target_exe,
                last_used: Instant::now(),
            },
        );

        // LRU 淘汰
        while entries.len() > MAX_ENTRIES {
            if let Some((&oldest_key, _)) = entries.iter().min_by_key(|(_, e)| e.last_used) {
                if let Some(removed) = entries.remove(&oldest_key) {
                    // 删除母本所在子目录（注意：exe_path 父目录就是 <key_hex>/）
                    if let Some(parent) = removed.exe_path.parent() {
                        let _ = std::fs::remove_dir_all(parent);
                    }
                }
            } else {
                break;
            }
        }
    }

    /// 删除指定 key 的缓存条目及其磁盘子目录。
    /// 用于缓存命中后拷贝失败时清理可疑条目。
    pub fn remove(&self, key: u64) {
        if let Ok(mut entries) = self.entries.lock() {
            if let Some(removed) = entries.remove(&key) {
                if let Some(parent) = removed.exe_path.parent() {
                    let _ = std::fs::remove_dir_all(parent);
                }
            }
        }
    }
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

    // ============ build_cache_key 纯函数测试 ============

    #[test]
    fn test_key_changes_with_code() {
        let config = make_config();
        let k1 = build_cache_key("int main(){}", &config, CompileScenario::Run);
        let k2 = build_cache_key("int main(){return 0;}", &config, CompileScenario::Run);
        assert_ne!(k1, k2, "不同代码应产生不同 key");
    }

    #[test]
    fn test_key_changes_with_scenario() {
        let config = make_config();
        let k_run = build_cache_key("int main(){}", &config, CompileScenario::Run);
        let k_test = build_cache_key("int main(){}", &config, CompileScenario::Test);
        assert_ne!(k_run, k_test, "Run(O0) 与 Test(O2) 应产生不同 key");
    }

    #[test]
    fn test_key_changes_with_compiler_path() {
        let mut s = AppSettings::default();
        s.compiler.compiler_path = Some("/usr/bin/clang++".into());
        let config_a = CompilerConfig::from_settings(&s, None).unwrap();

        let mut s2 = AppSettings::default();
        s2.compiler.compiler_path = Some("/usr/local/bin/g++".into());
        let config_b = CompilerConfig::from_settings(&s2, None).unwrap();

        let k_a = build_cache_key("int main(){}", &config_a, CompileScenario::Run);
        let k_b = build_cache_key("int main(){}", &config_b, CompileScenario::Run);
        assert_ne!(k_a, k_b, "不同 compiler_path 应产生不同 key");
    }

    #[test]
    fn test_key_changes_with_args() {
        let s = AppSettings::default();
        let config = CompilerConfig::from_settings(&s, None).unwrap();
        // run_args 用 O0，test_args 用 O2，应产生不同 key（同 scenario 内对比）
        let k1 = build_cache_key("code", &config, CompileScenario::Run);
        // 修改 cpp_standard 后构建新 config
        let mut s2 = AppSettings::default();
        s2.compiler.cpp_standard = "c++20".into();
        let config2 = CompilerConfig::from_settings(&s2, None).unwrap();
        let k2 = build_cache_key("code", &config2, CompileScenario::Run);
        assert_ne!(k1, k2, "不同 cpp_standard（args 不同）应产生不同 key");
    }

    #[test]
    fn test_key_stable_for_same_input() {
        let config = make_config();
        let k1 = build_cache_key("int main(){}", &config, CompileScenario::Run);
        let k2 = build_cache_key("int main(){}", &config, CompileScenario::Run);
        assert_eq!(k1, k2, "相同输入应产生相同 key");
    }

    // ============ LRU 淘汰测试 ============

    #[test]
    fn test_lru_evicts_oldest_when_full() {
        let tmp = TempDir::new().unwrap();
        let cache = BuildCache::new(tmp.path().to_path_buf());

        // 准备一个假的 exe 文件用于 insert
        let dummy_exe_src = tmp.path().join("dummy_src");
        std::fs::write(&dummy_exe_src, b"fake exe").unwrap();

        // 插入 MAX_ENTRIES 条
        for i in 0..MAX_ENTRIES as u64 {
            let key = i + 1; // 避开 0
            cache.insert(key, &dummy_exe_src, &format!("code{}", i));
        }
        {
            let entries = cache.entries.lock().unwrap();
            assert_eq!(entries.len(), MAX_ENTRIES, "插入后应填满 MAX_ENTRIES");
        }

        // 插入第 MAX_ENTRIES+1 条，应淘汰 key=1（最早插入的）
        cache.insert(MAX_ENTRIES as u64 + 1, &dummy_exe_src, "new");

        {
            let entries = cache.entries.lock().unwrap();
            assert_eq!(entries.len(), MAX_ENTRIES, "淘汰后仍为 MAX_ENTRIES");
            assert!(!entries.contains_key(&1), "最旧的 key=1 应被淘汰");
            assert!(entries.contains_key(&(MAX_ENTRIES as u64 + 1)), "新 key 应存在");
        }
        // key=1 对应子目录应被删除
        let key1_dir = tmp.path().join(format!("{:016x}", 1u64));
        assert!(!key1_dir.exists(), "淘汰条目的磁盘子目录应被删除");
    }

    #[test]
    fn test_get_updates_last_used() {
        let tmp = TempDir::new().unwrap();
        let cache = BuildCache::new(tmp.path().to_path_buf());

        let dummy_exe_src = tmp.path().join("dummy_src");
        std::fs::write(&dummy_exe_src, b"fake exe").unwrap();

        // 插入 MAX_ENTRIES+1 条，让第一条面临被淘汰
        for i in 0..MAX_ENTRIES as u64 {
            cache.insert(i + 1, &dummy_exe_src, &format!("code{}", i));
        }
        // 访问 key=1，更新其 last_used
        assert!(cache.get(1).is_some(), "key=1 应命中");
        // 等待 Instant 推进（get 后立即 insert 可能因时间精度未推进而淘汰错误条目）
        std::thread::sleep(std::time::Duration::from_millis(2));
        // 插入新条目，应淘汰 key=2 而非 key=1（因为 key=1 刚被访问）
        cache.insert(MAX_ENTRIES as u64 + 1, &dummy_exe_src, "new");
        {
            let entries = cache.entries.lock().unwrap();
            assert!(entries.contains_key(&1), "刚被访问的 key=1 不应被淘汰");
            assert!(!entries.contains_key(&2), "key=2 应被淘汰");
        }
    }

    // ============ 磁盘扫描测试 ============

    #[test]
    fn test_new_scans_existing_cache_dir() {
        let tmp = TempDir::new().unwrap();
        let cache_dir = tmp.path().join("build_cache");
        std::fs::create_dir_all(&cache_dir).unwrap();

        // 预创建两个合法子目录
        let key1 = 0xabc123u64;
        let key2 = 0xdef456u64;
        for &key in &[key1, key2] {
            let sub = cache_dir.join(format!("{:016x}", key));
            std::fs::create_dir_all(&sub).unwrap();
            std::fs::write(sub.join(exe_name()), b"fake exe").unwrap();
        }

        let cache = BuildCache::new(cache_dir);
        let entries = cache.entries.lock().unwrap();
        assert_eq!(entries.len(), 2, "应扫描到 2 个缓存条目");
        assert!(entries.contains_key(&key1));
        assert!(entries.contains_key(&key2));
    }

    #[test]
    fn test_new_cleans_orphan_subdir() {
        let tmp = TempDir::new().unwrap();
        let cache_dir = tmp.path().join("build_cache");
        std::fs::create_dir_all(&cache_dir).unwrap();

        // 合法子目录（含 exe）
        let valid_key = 0x100u64;
        let valid_sub = cache_dir.join(format!("{:016x}", valid_key));
        std::fs::create_dir_all(&valid_sub).unwrap();
        std::fs::write(valid_sub.join(exe_name()), b"exe").unwrap();

        // 孤儿 1：非法目录名（非 hex）
        let bad_name = cache_dir.join("not_a_hex");
        std::fs::create_dir_all(&bad_name).unwrap();
        std::fs::write(bad_name.join(exe_name()), b"exe").unwrap();

        // 孤儿 2：缺 exe 母本
        let missing_exe_key = 0x200u64;
        let missing_sub = cache_dir.join(format!("{:016x}", missing_exe_key));
        std::fs::create_dir_all(&missing_sub).unwrap();

        let cache = BuildCache::new(cache_dir);

        {
            let entries = cache.entries.lock().unwrap();
            assert_eq!(entries.len(), 1, "只应保留合法条目");
            assert!(entries.contains_key(&valid_key));
        }
        assert!(!bad_name.exists(), "非法目录名孤儿应被删除");
        assert!(!missing_sub.exists(), "缺 exe 孤儿应被删除");
    }

    // ============ insert / get / remove 行为测试 ============

    #[test]
    fn test_insert_then_get_hit() {
        let tmp = TempDir::new().unwrap();
        let cache = BuildCache::new(tmp.path().join("cache"));

        let dummy_exe_src = tmp.path().join("src");
        std::fs::write(&dummy_exe_src, b"fake exe content").unwrap();

        let key = 0xdeadbeefu64;
        cache.insert(key, &dummy_exe_src, "code");

        let cached = cache.get(key).expect("应命中");
        assert!(cached.exists(), "缓存母本应存在");
        assert_eq!(cached.file_name().unwrap(), exe_name());
    }

    #[test]
    fn test_get_miss_returns_none() {
        let tmp = TempDir::new().unwrap();
        let cache = BuildCache::new(tmp.path().join("cache"));
        assert!(cache.get(999).is_none(), "未插入的 key 应返回 None");
    }

    #[test]
    fn test_remove_deletes_entry_and_dir() {
        let tmp = TempDir::new().unwrap();
        let cache_dir = tmp.path().join("cache");
        let cache = BuildCache::new(cache_dir.clone());

        let dummy_exe_src = tmp.path().join("src");
        std::fs::write(&dummy_exe_src, b"fake exe").unwrap();

        let key = 0x42u64;
        cache.insert(key, &dummy_exe_src, "code");
        assert!(cache.get(key).is_some());

        cache.remove(key);
        assert!(cache.get(key).is_none(), "remove 后应不再命中");
        let sub_dir = cache_dir.join(format!("{:016x}", key));
        assert!(!sub_dir.exists(), "remove 应删除磁盘子目录");
    }
}
