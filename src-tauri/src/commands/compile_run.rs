use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

use crate::build_cache::{build_cache_key, BuildCache};
use crate::config::CompilerConfig;
use crate::error::AppError;
use crate::pch_cache::{generate_pch, pch_platform_enabled, PchCache};
use crate::run_manager::{RunKind, RunManager};
use crate::runner::{run_with_limits, KillReason, ResourceLimits};
use crate::settings::{self, AppSettings};

/// 编译场景：决定使用哪套编译参数
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum CompileScenario {
    /// 快速运行（终端交互 + 普通运行），用 run_args（compiler.opt_level）
    Run,
    /// 多样例测试，用 test_args（test.opt_level）
    Test,
}

/// 运行阶段标识
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RunStage {
    /// 编译失败
    CompileFailed,
    /// 已运行（无论成功失败）
    Ran,
}

/// 前端拿到的运行结果
#[derive(Serialize, Clone)]
pub struct RunResult {
    pub run_id: String,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub killed_by: Option<KillReason>,
    pub truncated: bool,
    pub stage: RunStage,
    /// 运行阶段内存峰值（KB）。编译失败时为 0
    pub max_rss_kb: u64,
    /// Windows JobObject 降级标志（CPU 时间限制未生效）。编译失败时为 false
    pub job_object_degraded: bool,
}

/// 编译结果（供 compile_and_run 和 PTY 复用）
pub enum CompileResult {
    /// 编译成功，返回可执行文件路径 + 编译器输出（可能含 warning）
    Success {
        exe_path: PathBuf,
        stdout: String,
        stderr: String,
    },
    /// 编译失败，返回编译器输出
    Failed {
        stdout: String,
        stderr: String,
        exit_code: Option<i32>,
    },
}

/// 编译 C++ 代码（抽取出来供 compile_and_run 和 PTY 复用）。
///
/// 在 work_dir 中写 main.cpp 并编译为 main 可执行文件。
/// `scenario` 决定使用哪套编译参数（Run=快速运行 O0，Test=多样例测试 O2）。
/// `pch_gch` 为 Some 时编译命令追加 `-include <pch.h>` 复用预编译头（仅加速过程，不改变产物）。
/// 调用者负责持有 work_dir（TempDir）直到不再需要 exe。
///
/// `cancel_token` 由调用方 clone 传入，支持编译阶段取消。
pub async fn compile_only(
    code: &str,
    config: &CompilerConfig,
    scenario: CompileScenario,
    work_dir: &Path,
    compile_limits: ResourceLimits,
    cancel_token: Option<CancellationToken>,
    pch_gch: Option<&Path>,
) -> Result<CompileResult, AppError> {
    // 写 main.cpp
    let main_cpp = work_dir.join("main.cpp");
    std::fs::write(&main_cpp, code)?;

    // 编译：clang++/g++ <args_for(scenario)> -o main main.cpp
    // Windows 可执行文件需 .exe 后缀
    #[cfg(unix)]
    let exe_name = "main";
    #[cfg(windows)]
    let exe_name = "main.exe";
    let exe_path = work_dir.join(exe_name);
    let mut compile_cmd: Vec<String> = vec![config.compiler_path.to_string_lossy().into_owned()];
    compile_cmd.extend(config.args_for(scenario).iter().cloned());
    if let Some(gch) = pch_gch {
        // GCC 无 -include-pch（Clang 专用；GCC 按 Joined 规则解析成 -include + "-pch"，报
        // fatal error: -pch: No such file or directory）。改用 -include <pch.h>，
        // GCC 自动复用同目录 pch.h.gch；clang 下退化为文本包含（仅无加速，不影响正确性）。
        compile_cmd.push("-include".into());
        compile_cmd.push(gch.with_file_name("pch.h").to_string_lossy().into_owned());
    }
    compile_cmd.push("-o".into());
    compile_cmd.push(exe_path.to_string_lossy().into_owned());
    compile_cmd.push(main_cpp.to_string_lossy().into_owned());

    let compile_out = run_with_limits(
        compile_cmd,
        work_dir,
        None,
        config.compile_timeout,
        compile_limits,
        cancel_token,
    )
    .await?;

    if compile_out.exit_code != Some(0) {
        // 将诊断输出中的绝对路径替换为 main.cpp，避免冗长临时路径干扰阅读
        let main_cpp_str = main_cpp.to_string_lossy();
        let stderr = String::from_utf8_lossy(&compile_out.stderr)
            .replace(main_cpp_str.as_ref(), "main.cpp");
        return Ok(CompileResult::Failed {
            stdout: String::from_utf8_lossy(&compile_out.stdout).into_owned(),
            stderr,
            exit_code: compile_out.exit_code,
        });
    }

    // 编译成功仍可能有 warning，同样做路径替换
    let main_cpp_str = main_cpp.to_string_lossy();
    let stderr = String::from_utf8_lossy(&compile_out.stderr)
        .replace(main_cpp_str.as_ref(), "main.cpp");
    Ok(CompileResult::Success {
        exe_path,
        stdout: String::from_utf8_lossy(&compile_out.stdout).into_owned(),
        stderr,
    })
}

/// 带缓存的编译入口。
///
/// 缓存命中：拷贝母本 exe 到 work_dir/main[.exe]，直接返回 Success（stdout/stderr 为空）。
/// 缓存未命中：调用 `compile_only` 正常编译，成功后写入缓存。
/// 拷贝失败时删除可疑缓存条目并回退到正常编译，保证健壮性。
///
/// PCH（仅 Windows + 代码含 bits/stdc++.h）：编译前查可用预编译头，命中则加速编译；
/// 未命中且可生成时 spawn 后台 task 生成（不阻塞本次编译），下次编译开始加速。
///
/// `cache=None` 时退化为 `compile_only`（用于单元测试）。
pub async fn compile_with_cache(
    code: &str,
    config: &CompilerConfig,
    scenario: CompileScenario,
    work_dir: &Path,
    compile_limits: ResourceLimits,
    cancel_token: Option<CancellationToken>,
    cache: Option<&BuildCache>,
    pch: Option<&PchCache>,
) -> Result<CompileResult, AppError> {
    // 查可用 PCH（平台开关在 acquire_pch 语义之外，用运行时布尔保证全平台可测）
    let pch_gch = if pch_platform_enabled() {
        pch.and_then(|p| p.acquire_pch(config, scenario, code))
    } else {
        None
    };

    // PCH 未命中且可生成 → spawn 后台生成 task（本次编译不等待）
    if pch_gch.is_none() && pch_platform_enabled() {
        if let Some(p) = pch {
            if let Some((hash, hash_dir)) = p.try_start_generation(config, scenario) {
                let compiler = config.compiler_path.clone();
                let args: Vec<String> = config.args_for(scenario).to_vec();
                // PCH 生成比普通编译慢（一次性开销），超时取 compile_timeout 与 30s 的较大者
                let timeout = config.compile_timeout.max(std::time::Duration::from_secs(30));
                let limits = compile_limits;
                let cache_clone = p.clone();
                tokio::spawn(async move {
                    match generate_pch(&compiler, &args, &hash_dir, timeout, limits).await {
                        Ok(_) => cache_clone.finish_generation(hash),
                        Err(_) => cache_clone.abort_generation(hash),
                    }
                });
            }
        }
    }

    // cache_key 在 cache 分支内计算，避免 cache=None 时浪费
    if let Some(cache) = cache {
        let key = build_cache_key(code, config, scenario);
        if let Some(cached_exe) = cache.get(key) {
            // 命中：拷贝母本到 work_dir。缓存命中时不写 main.cpp（运行阶段不需要源码）
            #[cfg(unix)]
            let exe_name = "main";
            #[cfg(windows)]
            let exe_name = "main.exe";
            let target = work_dir.join(exe_name);
            match std::fs::copy(&cached_exe, &target) {
                Ok(_) => {
                    return Ok(CompileResult::Success {
                        exe_path: target,
                        stdout: String::new(),
                        stderr: String::new(),
                    });
                }
                Err(_) => {
                    // 拷贝失败（杀软锁定等）→ 删除可疑缓存条目，回退到编译
                    cache.remove(key);
                }
            }
        }

        // 未命中或拷贝失败回退：正常编译（可能带 -include 预编译头）
        let result = compile_only(
            code,
            config,
            scenario,
            work_dir,
            compile_limits,
            cancel_token,
            pch_gch.as_deref(),
        )
        .await?;

        // 编译成功后写入缓存（仅 Success 才缓存，Failed 不缓存）
        if let CompileResult::Success { exe_path, .. } = &result {
            cache.insert(key, exe_path, code);
        }

        Ok(result)
    } else {
        // 无缓存：直接走 compile_only
        compile_only(
            code,
            config,
            scenario,
            work_dir,
            compile_limits,
            cancel_token,
            pch_gch.as_deref(),
        )
        .await
    }
}

/// 从 app handle 加载设置并构建 CompilerConfig + ResourceLimits
pub fn load_config(app: &AppHandle) -> Result<(AppSettings, CompilerConfig, ResourceLimits), AppError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other {
            detail: format!("获取数据目录失败: {e}"),
        })?;
    let s = settings::load(&base);
    let resource_dir = app.path().resource_dir().ok();
    let config = CompilerConfig::from_settings(&s, resource_dir.as_deref())?;
    let run_limits = ResourceLimits::from_settings(&s.runtime, &s.test);
    // 编译阶段用相同的 limits（CPU + fsize）
    Ok((s, config, run_limits))
}

/// 编译并运行 C++ 代码。
///
/// 通过 RunManager 注册会话，实现单活动任务互斥 + 前端可取消。
/// 编译和运行两阶段共享同一 CancellationToken（clone 复用），
/// 因此运行阶段也能被外部取消（之前用 oneshot 时运行阶段无法取消）。
///
/// RAII guard 保证任何 ? 提前返回（包括 load_config 失败）都会自动 complete 会话。
#[tauri::command]
pub async fn compile_and_run(
    code: String,
    stdin: Option<String>,
    run_id: String,
    app: AppHandle,
    manager: State<'_, RunManager>,
    cache: State<'_, BuildCache>,
    pch: State<'_, PchCache>,
) -> Result<RunResult, AppError> {
    // 接受前端传入的 run_id，让停止按钮在 invoke 前就可用
    let cancel_token = manager
        .register_with_id(run_id.clone(), RunKind::CompileRun)
        .map_err(|e| AppError::Other { detail: e })?;

    // RAII guard：任何 ? 提前返回（包括 load_config 失败）都保证 complete 执行
    struct RunGuard<'a> {
        manager: &'a RunManager,
        run_id: String,
        active: bool,
    }
    impl<'a> Drop for RunGuard<'a> {
        fn drop(&mut self) {
            if self.active {
                self.manager.complete(&self.run_id);
            }
        }
    }
    let guard = RunGuard {
        manager: &manager,
        run_id: run_id.clone(),
        active: true,
    };

    let (_settings, config, limits) = load_config(&app)?;
    let result = run_compile_and_run_inner(
        code,
        stdin,
        run_id.clone(),
        cancel_token,
        &config,
        limits,
        &cache,
        &pch,
    )
    .await;
    // guard 自然 drop 时调用 complete，释放 RunManager 会话。
    // 不主动设 active=false（之前的写法导致 Drop 不调用 complete，session 永久残留）。
    drop(guard);
    result
}

/// 实际执行逻辑（独立出来便于测试，测试时不需要 RunManager）
async fn run_compile_and_run_inner(
    code: String,
    stdin: Option<String>,
    run_id: String,
    cancel_token: CancellationToken,
    config: &CompilerConfig,
    limits: ResourceLimits,
    cache: &BuildCache,
    pch: &PchCache,
) -> Result<RunResult, AppError> {
    let work_dir = TempDir::new()?;
    let work_path = work_dir.path().to_path_buf();

    // 编译（复用 compile_with_cache），clone token 保留原 token 给运行阶段
    let exe_path = match compile_with_cache(
        &code,
        config,
        CompileScenario::Run,
        &work_path,
        limits,
        Some(cancel_token.clone()),
        Some(cache),
        Some(pch),
    )
    .await?
    {
        CompileResult::Success { exe_path, .. } => exe_path,
        CompileResult::Failed {
            stdout,
            stderr,
            exit_code,
        } => {
            return Ok(RunResult {
                run_id,
                success: false,
                stdout,
                stderr,
                exit_code,
                duration_ms: 0,
                killed_by: None,
                truncated: false,
                stage: RunStage::CompileFailed,
                max_rss_kb: 0,
                job_object_degraded: false,
            });
        }
    };

    // 运行：./main（再次 clone token，运行阶段也可取消，之前传 None）
    let run_cmd: Vec<String> = vec![exe_path.to_string_lossy().into_owned()];
    let run_out = run_with_limits(
        run_cmd,
        &work_path,
        stdin,
        config.run_timeout,
        limits,
        Some(cancel_token.clone()),
    )
    .await?;

    Ok(RunResult {
        run_id,
        success: run_out.exit_code == Some(0),
        stdout: String::from_utf8_lossy(&run_out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&run_out.stderr).into_owned(),
        exit_code: run_out.exit_code,
        duration_ms: run_out.duration_ms,
        killed_by: run_out.killed_by,
        truncated: run_out.truncated,
        stage: RunStage::Ran,
        max_rss_kb: run_out.max_rss_kb,
        job_object_degraded: run_out.job_object_degraded,
    })
}

/// 编译缓存统计（exe 产物 + PCH），供设置面板展示占用
#[derive(Serialize)]
pub struct BuildCacheStats {
    pub exe_count: usize,
    pub exe_bytes: u64,
    pub pch_count: usize,
    pub pch_bytes: u64,
    pub total_bytes: u64,
}

#[tauri::command]
pub async fn get_build_cache_stats(
    cache: State<'_, BuildCache>,
    pch: State<'_, PchCache>,
) -> Result<BuildCacheStats, AppError> {
    let (exe_count, exe_bytes) = cache.stats();
    let (pch_count, pch_bytes) = pch.stats();
    Ok(BuildCacheStats {
        exe_count,
        exe_bytes,
        pch_count,
        pch_bytes,
        total_bytes: exe_bytes + pch_bytes,
    })
}

#[tauri::command]
pub async fn clear_build_cache(
    cache: State<'_, BuildCache>,
    pch: State<'_, PchCache>,
) -> Result<(), AppError> {
    cache.clear();
    pch.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pch_cache::PchCache;
    use crate::settings::AppSettings;
    use tempfile::TempDir as TestTempDir;

    fn test_config() -> (CompilerConfig, ResourceLimits) {
        let s = AppSettings::default();
        let config = CompilerConfig::from_settings(&s, None).unwrap();
        let limits = ResourceLimits::from_settings(&s.runtime, &s.test);
        (config, limits)
    }

    /// 为测试创建独立 BuildCache（独立临时目录），避免测试间相互污染。
    /// 返回 (BuildCache, 临时目录句柄)。临时目录由调用方持有，drop 时清理。
    fn test_cache() -> (BuildCache, TestTempDir) {
        let tmp = TestTempDir::new().unwrap();
        let cache = BuildCache::new(tmp.path().join("cache"));
        (cache, tmp)
    }

    /// 为测试创建独立 PchCache（独立临时目录）
    fn test_pch() -> (PchCache, TestTempDir) {
        let tmp = TestTempDir::new().unwrap();
        let pch = PchCache::new(tmp.path().join("pch"));
        (pch, tmp)
    }

    #[tokio::test]
    async fn compile_and_run_hello_world() {
        let code = r#"#include <iostream>
using namespace std;
int main() {
    cout << "hi" << endl;
    return 0;
}
"#;
        let (config, limits) = test_config();
        let (cache, _tmp) = test_cache();
        let (pch, _pch_tmp) = test_pch();
        let cancel_token = CancellationToken::new();
        let result = run_compile_and_run_inner(code.into(), None, "test".into(), cancel_token, &config, limits, &cache, &pch)
            .await
            .expect("应编译运行成功");
        assert_eq!(result.stage, RunStage::Ran);
        assert!(result.success);
        // Windows 上 C++ cout 输出 \r\n（C runtime 文本模式），去掉 \r 后比较
        assert_eq!(result.stdout.replace('\r', ""), "hi\n");
    }

    #[tokio::test]
    async fn compile_and_run_with_stdin() {
        let code = r#"#include <iostream>
using namespace std;
int main() {
    int n;
    cin >> n;
    cout << n * 2 << endl;
    return 0;
}
"#;
        let (config, limits) = test_config();
        let (cache, _tmp) = test_cache();
        let (pch, _pch_tmp) = test_pch();
        let cancel_token = CancellationToken::new();
        let result = run_compile_and_run_inner(code.into(), Some("21".into()), "test".into(), cancel_token, &config, limits, &cache, &pch)
            .await
            .expect("应编译运行成功");
        assert_eq!(result.stdout.replace('\r', ""), "42\n");
    }

    #[tokio::test]
    async fn compile_failed_returns_error() {
        let bad_code = r#"#include <iostream>
int main() {
    cout << "no namespace" << endl;
    return 0;
}
"#;
        let (config, limits) = test_config();
        let (cache, _tmp) = test_cache();
        let (pch, _pch_tmp) = test_pch();
        let cancel_token = CancellationToken::new();
        let result = run_compile_and_run_inner(bad_code.into(), None, "test".into(), cancel_token, &config, limits, &cache, &pch)
            .await
            .expect("应返回编译失败结果");
        assert_eq!(result.stage, RunStage::CompileFailed);
        assert!(!result.success);
        assert!(!result.stderr.is_empty());
    }

    /// 验证 compile_only 在编译成功且 stderr 含 warning 时，诊断信息不会丢失。
    /// 场景：缺 return 的非 void 函数，clang++ 在 -Wall -Wextra 下产生
    /// "non-void function does not return a value in all control paths" warning。
    /// 编译仍成功（exit_code=0），但 stderr 不应为空，且应包含 "warning" 关键字。
    #[tokio::test]
    async fn compile_only_preserves_warnings_on_success() {
        let warning_code = r#"#include <string>
using namespace std;
char _find(string s){
    for (int i=0; i<(int)s.size(); i++){
        if (s[i] == 'A') return s[i];
    }
}
int main() { return 0; }
"#;
        let (config, limits) = test_config();
        let work_dir = TempDir::new().unwrap();
        let result = compile_only(warning_code, &config, CompileScenario::Run, work_dir.path(), limits, None, None)
            .await
            .expect("应编译成功（warning 不阻止编译）");
        match result {
            CompileResult::Success { exe_path, stdout, stderr } => {
                // 可执行文件存在
                assert!(exe_path.exists(), "exe_path 应存在");
                // warning 不应丢失
                assert!(
                    stderr.contains("warning") || stderr.contains("_find"),
                    "stderr 应包含 warning 诊断，实际: {stderr}"
                );
                // 路径替换验证：stderr 不应包含临时目录绝对路径
                let work_dir_str = work_dir.path().to_string_lossy();
                assert!(
                    !stderr.contains(work_dir_str.as_ref()),
                    "stderr 不应包含临时目录绝对路径，实际: {stderr}"
                );
                // stdout 通常为空（编译器诊断都走 stderr）
                let _ = stdout;
            }
            CompileResult::Failed { stderr, .. } => {
                panic!("预期编译成功（warning 不阻止编译），但得到 CompileFailed: {stderr}");
            }
        }
    }

    /// 验证 compile_only 在编译失败时，stderr 中的绝对路径被替换为 main.cpp
    #[tokio::test]
    async fn compile_only_replaces_path_in_failed_stderr() {
        // 缺分号，必定编译失败
        let bad_code = "int main() { int a = 10 }";
        let (config, limits) = test_config();
        let work_dir = TempDir::new().unwrap();
        let result = compile_only(bad_code, &config, CompileScenario::Run, work_dir.path(), limits, None, None)
            .await
            .expect("应返回编译失败结果");
        match result {
            CompileResult::Failed { stderr, .. } => {
                let work_dir_str = work_dir.path().to_string_lossy();
                assert!(
                    !stderr.contains(work_dir_str.as_ref()),
                    "stderr 不应包含临时目录绝对路径，实际: {stderr}"
                );
            }
            CompileResult::Success { .. } => {
                panic!("预期编译失败，但得到 Success");
            }
        }
    }

    /// 回归测试：PCH 命中后编译命令曾用 -include-pch（Clang 专用选项），
    /// GCC 将其按 Joined 规则解析为 -include + "-pch"，报
    /// "cc1plus.exe: fatal error: -pch: No such file or directory"。
    /// 修复后改用 -include <pch.h>，GCC 自动复用同目录 .gch。
    /// 仅在打包 TDM-GCC 存在时执行（与 Windows 生产编译器一致），其余环境跳过。
    #[tokio::test]
    async fn compile_only_with_pch_succeeds_on_bundled_gcc() {
        let tdm_gcc = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("tdm-gcc")
            .join("bin")
            .join("g++.exe");
        if !tdm_gcc.exists() {
            return;
        }

        let (config, mut limits) = test_config();
        // 与 generate_pch 一致：放宽 fsize（.gch 是编译器合法产物，超默认 10MB）
        limits.fsize_mb = 512;

        // 生成 iostream PCH（比 bits/stdc++.h 快得多，-include 通路与生产一致）
        let tmp = TempDir::new().unwrap();
        let pch_h = tmp.path().join("pch.h");
        std::fs::write(&pch_h, "#include <iostream>\n").unwrap();
        let gch = tmp.path().join("pch.h.gch");
        let mut gen_cmd: Vec<String> = vec![config.compiler_path.to_string_lossy().into_owned()];
        gen_cmd.extend(config.args_for(CompileScenario::Run).iter().cloned());
        gen_cmd.extend([
            "-x".into(),
            "c++-header".into(),
            pch_h.to_string_lossy().into_owned(),
            "-o".into(),
            gch.to_string_lossy().into_owned(),
        ]);
        let gen = run_with_limits(
            gen_cmd,
            tmp.path(),
            None,
            std::time::Duration::from_secs(60),
            limits,
            None,
        )
        .await
        .unwrap();
        assert_eq!(gen.exit_code, Some(0), "PCH 生成应成功");

        let work = TempDir::new().unwrap();
        let code = "#include <iostream>\nint main() { return 0; }";
        let result = compile_only(
            code,
            &config,
            CompileScenario::Run,
            work.path(),
            limits,
            None,
            Some(&gch),
        )
        .await
        .unwrap();
        match result {
            CompileResult::Success { .. } => {}
            CompileResult::Failed { stderr, .. } => {
                panic!("TDM-GCC 下复用 PCH 编译应成功，实际失败: {stderr}");
            }
        }
    }

    /// 回归测试：修复前正常路径会主动 guard.active = false，导致 Drop 不调用 complete，
    /// session 永久残留，下次 register 报"已有运行任务在进行中"。
    /// 修复后 guard 自然 drop，complete 被调用，可再次 register。
    #[test]
    fn run_guard_releases_session_on_normal_drop() {
        use crate::run_manager::{RunManager, RunKind};
        use uuid::Uuid;

        let manager = RunManager::new();
        let run_id = Uuid::new_v4().to_string();
        let _token = manager
            .register_with_id(run_id.clone(), RunKind::CompileRun)
            .unwrap();
        assert!(manager.is_busy());

        // 复刻 compile_and_run 中修复后的 guard 模式
        struct RunGuard<'a> {
            manager: &'a RunManager,
            run_id: String,
            active: bool,
        }
        impl<'a> Drop for RunGuard<'a> {
            fn drop(&mut self) {
                if self.active {
                    self.manager.complete(&self.run_id);
                }
            }
        }
        {
            let _guard = RunGuard {
                manager: &manager,
                run_id: run_id.clone(),
                active: true,
            };
            // 模拟 inner 正常返回（不设 active = false）
        }

        // session 应已释放
        assert!(!manager.is_busy());
        // 可再次注册新会话
        assert!(manager.register(RunKind::CompileRun).is_ok());
    }

    // ============ compile_with_cache 集成测试 ============

    #[tokio::test]
    async fn test_cache_miss_then_hit_skips_compile() {
        // 首次编译未命中缓存 → 编译并写入；第二次相同输入 → 命中缓存，跳过编译
        let code = r#"#include <iostream>
using namespace std;
int main() { cout << "cached" << endl; return 0; }
"#;
        let (config, limits) = test_config();
        let (cache, _tmp) = test_cache();
        let (pch, _pch_tmp) = test_pch();
        let key = build_cache_key(code, &config, CompileScenario::Run);

        // 第一次：未命中，正常编译
        let work1 = TempDir::new().unwrap();
        let r1 = compile_with_cache(code, &config, CompileScenario::Run, work1.path(), limits, None, Some(&cache), Some(&pch))
            .await
            .expect("首次编译应成功");
        let exe1 = match r1 {
            CompileResult::Success { exe_path, .. } => exe_path,
            _ => panic!("预期 Success"),
        };
        assert!(exe1.exists());
        assert!(cache.get(key).is_some(), "首次编译后应写入缓存");

        // 第二次：命中缓存，exe_path 应在新的 work_dir 中（拷贝而来）
        let work2 = TempDir::new().unwrap();
        let r2 = compile_with_cache(code, &config, CompileScenario::Run, work2.path(), limits, None, Some(&cache), Some(&pch))
            .await
            .expect("缓存命中应返回 Success");
        match r2 {
            CompileResult::Success { exe_path, stdout, stderr } => {
                assert!(exe_path.exists(), "拷贝来的 exe 应存在");
                // 命中时 stdout/stderr 为空（无编译输出）
                assert!(stdout.is_empty(), "命中时 stdout 应为空");
                assert!(stderr.is_empty(), "命中时 stderr 应为空");
                // exe_path 应在 work2 内（拷贝目标），不是缓存母本路径
                assert!(exe_path.starts_with(work2.path()), "exe 应拷贝到新 work_dir");
            }
            _ => panic!("预期 Success"),
        }
    }

    #[tokio::test]
    async fn test_cache_none_falls_back_to_compile() {
        // cache=None 时退化为 compile_only
        let code = r#"#include <iostream>
using namespace std;
int main() { cout << "no_cache" << endl; return 0; }
"#;
        let (config, limits) = test_config();
        let work = TempDir::new().unwrap();
        let result = compile_with_cache(code, &config, CompileScenario::Run, work.path(), limits, None, None, None)
            .await
            .expect("cache=None 应正常编译");
        assert!(matches!(result, CompileResult::Success { .. }));
    }

    #[tokio::test]
    async fn test_compile_failure_not_cached() {
        // 编译失败不应写入缓存
        let bad_code = "int main() { syntax error }";
        let (config, limits) = test_config();
        let (cache, _tmp) = test_cache();
        let (pch, _pch_tmp) = test_pch();
        let key = build_cache_key(bad_code, &config, CompileScenario::Run);

        let work = TempDir::new().unwrap();
        let result = compile_with_cache(bad_code, &config, CompileScenario::Run, work.path(), limits, None, Some(&cache), Some(&pch))
            .await
            .expect("应返回编译失败结果（不 panic）");
        assert!(matches!(result, CompileResult::Failed { .. }));
        assert!(cache.get(key).is_none(), "编译失败不应写入缓存");
    }

    #[tokio::test]
    async fn test_different_code_uses_different_cache_entries() {
        // 不同代码产生不同 cache_key，互不干扰
        let code1 = r#"#include <iostream>
int main() { std::cout << 1; return 0; }
"#;
        let code2 = r#"#include <iostream>
int main() { std::cout << 2; return 0; }
"#;
        let (config, limits) = test_config();
        let (cache, _tmp) = test_cache();
        let (pch, _pch_tmp) = test_pch();
        let key1 = build_cache_key(code1, &config, CompileScenario::Run);
        let key2 = build_cache_key(code2, &config, CompileScenario::Run);
        assert_ne!(key1, key2, "不同代码应有不同 key");

        // 编译 code1
        let w1 = TempDir::new().unwrap();
        let _ = compile_with_cache(code1, &config, CompileScenario::Run, w1.path(), limits, None, Some(&cache), Some(&pch))
            .await
            .expect("code1 应编译成功");
        assert!(cache.get(key1).is_some());
        assert!(cache.get(key2).is_none(), "code2 未编译，不应命中");
    }

    #[tokio::test]
    async fn test_different_scenario_uses_different_entries() {
        // 同代码 + Run vs Test 应产生不同 cache 条目
        let code = r#"#include <iostream>
int main() { return 0; }
"#;
        let (config, limits) = test_config();
        let (cache, _tmp) = test_cache();
        let (pch, _pch_tmp) = test_pch();
        let key_run = build_cache_key(code, &config, CompileScenario::Run);
        let key_test = build_cache_key(code, &config, CompileScenario::Test);
        assert_ne!(key_run, key_test, "Run 和 Test 应有不同 key");

        // 仅编译 Run 场景
        let w = TempDir::new().unwrap();
        let _ = compile_with_cache(code, &config, CompileScenario::Run, w.path(), limits, None, Some(&cache), Some(&pch))
            .await
            .expect("Run 编译应成功");
        assert!(cache.get(key_run).is_some(), "Run 应缓存命中");
        assert!(cache.get(key_test).is_none(), "Test 未编译，不应命中");
    }

    #[tokio::test]
    async fn test_run_compile_and_run_inner_uses_cache() {
        // 验证 run_compile_and_run_inner 接入缓存后，连续两次运行第二次命中缓存
        let code = r#"#include <iostream>
using namespace std;
int main() { cout << "hi" << endl; return 0; }
"#;
        let (config, limits) = test_config();
        let (cache, _tmp) = test_cache();
        let (pch, _pch_tmp) = test_pch();

        // 第一次：编译并写入缓存
        let r1 = run_compile_and_run_inner(
            code.into(), None, "run1".into(), CancellationToken::new(),
            &config, limits, &cache, &pch,
        )
        .await
        .expect("第一次运行应成功");
        assert_eq!(r1.stdout.replace('\r', ""), "hi\n");

        // 第二次：应命中缓存（输出应一致，且不报错）
        let r2 = run_compile_and_run_inner(
            code.into(), None, "run2".into(), CancellationToken::new(),
            &config, limits, &cache, &pch,
        )
        .await
        .expect("第二次运行应成功（命中缓存）");
        assert_eq!(r2.stdout.replace('\r', ""), "hi\n", "缓存命中输出应与首次一致");
        assert_eq!(r2.stage, RunStage::Ran);
    }
}
