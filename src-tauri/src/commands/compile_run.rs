use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

use crate::config::CompilerConfig;
use crate::error::AppError;
use crate::run_manager::{RunKind, RunManager};
use crate::runner::{run_with_limits, KillReason, ResourceLimits};
use crate::settings::{self, AppSettings};

/// 编译场景：决定使用哪套编译参数
#[derive(Clone, Copy, Debug, PartialEq)]
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
        return Ok(CompileResult::Failed {
            stdout: String::from_utf8_lossy(&compile_out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&compile_out.stderr).into_owned(),
            exit_code: compile_out.exit_code,
        });
    }

    Ok(CompileResult::Success {
        exe_path,
        stdout: String::from_utf8_lossy(&compile_out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&compile_out.stderr).into_owned(),
    })
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
) -> Result<RunResult, AppError> {
    let work_dir = TempDir::new()?;
    let work_path = work_dir.path().to_path_buf();

    // 编译（复用 compile_only），clone token 保留原 token 给运行阶段
    let exe_path = match compile_only(
        &code,
        config,
        CompileScenario::Run,
        &work_path,
        limits,
        Some(cancel_token.clone()),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::AppSettings;

    fn test_config() -> (CompilerConfig, ResourceLimits) {
        let s = AppSettings::default();
        let config = CompilerConfig::from_settings(&s, None).unwrap();
        let limits = ResourceLimits::from_settings(&s.runtime, &s.test);
        (config, limits)
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
        let cancel_token = CancellationToken::new();
        let result = run_compile_and_run_inner(code.into(), None, "test".into(), cancel_token, &config, limits)
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
        let cancel_token = CancellationToken::new();
        let result = run_compile_and_run_inner(code.into(), Some("21".into()), "test".into(), cancel_token, &config, limits)
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
        let cancel_token = CancellationToken::new();
        let result = run_compile_and_run_inner(bad_code.into(), None, "test".into(), cancel_token, &config, limits)
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
        let result = compile_only(warning_code, &config, CompileScenario::Run, work_dir.path(), limits, None)
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
                // stdout 通常为空（编译器诊断都走 stderr）
                let _ = stdout;
            }
            CompileResult::Failed { stderr, .. } => {
                panic!("预期编译成功（warning 不阻止编译），但得到 CompileFailed: {stderr}");
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
}
