use std::path::{Path, PathBuf};

use serde::Serialize;
use tempfile::TempDir;
use tauri::{AppHandle, Manager, State};
use tokio::sync::oneshot;

use crate::config::CompilerConfig;
use crate::error::AppError;
use crate::run_manager::{RunKind, RunManager};
use crate::runner::{run_with_limits, KillReason, ResourceLimits};
use crate::settings::{self, AppSettings};

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
}

/// 编译结果（供 compile_and_run 和 PTY 复用）
pub enum CompileResult {
    /// 编译成功，返回可执行文件路径
    Success(PathBuf),
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
/// 调用者负责持有 work_dir（TempDir）直到不再需要 exe。
pub async fn compile_only(
    code: &str,
    config: &CompilerConfig,
    work_dir: &Path,
    compile_limits: ResourceLimits,
    cancel_rx: Option<oneshot::Receiver<()>>,
) -> Result<CompileResult, AppError> {
    // 写 main.cpp
    let main_cpp = work_dir.join("main.cpp");
    std::fs::write(&main_cpp, code)?;

    // 编译：clang++/g++ <compile_args> -o main main.cpp
    // Windows 可执行文件需 .exe 后缀
    #[cfg(unix)]
    let exe_name = "main";
    #[cfg(windows)]
    let exe_name = "main.exe";
    let exe_path = work_dir.join(exe_name);
    let mut compile_cmd: Vec<String> = vec![config.compiler_path.to_string_lossy().into_owned()];
    compile_cmd.extend(config.compile_args.iter().cloned());
    compile_cmd.push("-o".into());
    compile_cmd.push(exe_path.to_string_lossy().into_owned());
    compile_cmd.push(main_cpp.to_string_lossy().into_owned());

    let compile_out = run_with_limits(
        compile_cmd,
        work_dir,
        None,
        config.compile_timeout,
        compile_limits,
        cancel_rx,
    )
    .await?;

    if compile_out.exit_code != Some(0) {
        return Ok(CompileResult::Failed {
            stdout: String::from_utf8_lossy(&compile_out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&compile_out.stderr).into_owned(),
            exit_code: compile_out.exit_code,
        });
    }

    Ok(CompileResult::Success(exe_path))
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
/// 编译和运行两阶段共享同一 cancel 信号。
#[tauri::command]
pub async fn compile_and_run(
    code: String,
    stdin: Option<String>,
    app: AppHandle,
    manager: State<'_, RunManager>,
) -> Result<RunResult, AppError> {
    // 注册会话（若已有活动任务则返回错误）
    let (run_id, cancel_rx) = manager
        .register(RunKind::CompileRun)
        .map_err(|e| AppError::Other { detail: e })?;

    let (_settings, config, limits) = load_config(&app)?;
    let result = run_compile_and_run_inner(code, stdin, run_id.clone(), Some(cancel_rx), &config, limits).await;

    // 无论成功失败，都清理会话
    manager.complete(&run_id);
    result
}

/// 实际执行逻辑（独立出来便于测试，测试时不需要 RunManager）
async fn run_compile_and_run_inner(
    code: String,
    stdin: Option<String>,
    run_id: String,
    cancel_rx: Option<oneshot::Receiver<()>>,
    config: &CompilerConfig,
    limits: ResourceLimits,
) -> Result<RunResult, AppError> {
    let work_dir = TempDir::new()?;
    let work_path = work_dir.path().to_path_buf();

    // 编译（复用 compile_only）
    let exe_path = match compile_only(&code, config, &work_path, limits, cancel_rx).await? {
        CompileResult::Success(p) => p,
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
            });
        }
    };

    // 运行：./main
    let run_cmd: Vec<String> = vec![exe_path.to_string_lossy().into_owned()];
    let run_out = run_with_limits(
        run_cmd,
        &work_path,
        stdin,
        config.run_timeout,
        limits,
        None,
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
        let result = run_compile_and_run_inner(code.into(), None, "test".into(), None, &config, limits)
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
        let result = run_compile_and_run_inner(code.into(), Some("21".into()), "test".into(), None, &config, limits)
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
        let result = run_compile_and_run_inner(bad_code.into(), None, "test".into(), None, &config, limits)
            .await
            .expect("应返回编译失败结果");
        assert_eq!(result.stage, RunStage::CompileFailed);
        assert!(!result.success);
        assert!(!result.stderr.is_empty());
    }
}
