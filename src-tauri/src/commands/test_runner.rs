use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

use crate::commands::compile_run::{compile_only, load_config, RunStage};
use crate::error::AppError;
use crate::run_manager::{RunKind, RunManager};
use crate::runner::{run_with_limits, KillReason, ResourceLimits};
use crate::test_suite::TestSuite;

/// 单个测试用例的运行结果
#[derive(Serialize, Clone)]
pub struct TestCaseResult {
    pub id: String,
    pub passed: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub killed_by: Option<KillReason>,
    pub truncated: bool,
    /// 首次差异位置（标准化后字符串中的字符索引）；通过时为 None
    pub first_diff: Option<usize>,
    /// 内存峰值（KB）
    pub max_rss_kb: u64,
}

/// 批量测试结果
#[derive(Serialize, Clone)]
pub struct TestRunResult {
    pub run_id: String,
    pub success: bool,
    pub total: usize,
    pub passed: usize,
    pub stage: RunStage,
    pub compile_stdout: String,
    pub compile_stderr: String,
    pub results: Vec<TestCaseResult>,
}

/// 逐例进度事件
#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
#[serde(tag = "status")]
pub enum TestProgress {
    /// 开始运行某用例
    Running {
        run_id: String,
        case_id: String,
        index: usize,
        total: usize,
    },
    /// 用例通过
    Passed {
        run_id: String,
        case_id: String,
        index: usize,
        total: usize,
        duration_ms: u64,
    },
    /// 用例失败
    Failed {
        run_id: String,
        case_id: String,
        index: usize,
        total: usize,
        duration_ms: u64,
        first_diff: Option<usize>,
    },
    /// 运行被取消
    Cancelled {
        run_id: String,
        index: usize,
        total: usize,
    },
}

/// 标准化输出用于比较。
/// - 始终 CRLF→LF（跨平台一致性）
/// - strict=false（默认）：去掉末尾换行，教学场景更友好
/// - strict=true：保留末尾换行，精确比较
fn normalize_output(s: &str, strict: bool) -> String {
    let s = s.replace("\r\n", "\n");
    if strict {
        s
    } else {
        s.trim_end_matches('\n').to_string()
    }
}

/// 判断测试用例是否通过（纯函数，便于单元测试）
///
/// 通过条件：exit_code == 0 && 输出匹配 && 未超时
fn judge_case_passed(
    exit_code: Option<i32>,
    expected: &str,
    actual: &str,
    duration_ms: u64,
    time_limit_ms: u64,
    strict: bool,
) -> bool {
    let time_exceeded = duration_ms > time_limit_ms;
    let expected_norm = normalize_output(expected, strict);
    let actual_norm = normalize_output(actual, strict);
    exit_code == Some(0) && expected_norm == actual_norm && !time_exceeded
}

/// 找首次差异位置（字符索引）；完全相同返回 None
fn first_diff_index(a: &str, b: &str) -> Option<usize> {
    if a == b {
        return None;
    }
    let mut idx = 0;
    for (ca, cb) in a.chars().zip(b.chars()) {
        if ca != cb {
            return Some(idx);
        }
        idx += 1;
    }
    Some(idx)
}

/// 批量测试：编译一次，逐个运行测试用例（stdin/expected 从文件读取）。
///
/// - 通过 RunManager 注册会话，实现单活动任务互斥 + 前端可取消
/// - 每个用例运行前 emit `test_progress` (Running)
/// - 每个用例运行后 emit `test_progress` (Passed/Failed)
/// - 取消时 emit `test_progress` (Cancelled)
#[tauri::command]
pub async fn run_tests(
    code: String,
    suite_id: String,
    strict: Option<bool>,
    app: AppHandle,
    manager: State<'_, RunManager>,
) -> Result<TestRunResult, AppError> {
    let strict = strict.unwrap_or(false);

    let (run_id, cancel_rx) = manager
        .register(RunKind::TestRun)
        .map_err(|e| AppError::Other { detail: e })?;

    let base = base_dir(&app)?;
    let (_settings, config, limits) = load_config(&app)?;
    let result = run_tests_inner(&code, &suite_id, strict, &base, run_id.clone(), Some(cancel_rx), &app, &config, limits).await;

    manager.complete(&run_id);
    result
}

/// 获取 app data 目录
fn base_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Other {
            detail: format!("获取数据目录失败: {e}"),
        })
}

/// 实际执行逻辑
async fn run_tests_inner(
    code: &str,
    suite_id: &str,
    strict: bool,
    base: &Path,
    run_id: String,
    mut cancel_rx: Option<oneshot::Receiver<()>>,
    app: &AppHandle,
    config: &crate::config::CompilerConfig,
    limits: ResourceLimits,
) -> Result<TestRunResult, AppError> {
    // 临时工作目录
    let work_dir = tempfile::TempDir::new()?;
    let work_path = work_dir.path().to_path_buf();

    // 编译（复用 compile_only）
    let exe_path = match compile_only(code, config, &work_path, limits, cancel_rx.take()).await? {
        crate::commands::compile_run::CompileResult::Success(p) => p,
        crate::commands::compile_run::CompileResult::Failed {
            stdout,
            stderr,
            exit_code: _,
        } => {
            // 加载套件清单获取用例数量
            let manifest = TestSuite::load(base, suite_id).unwrap_or_else(|_| {
                // 加载失败也返回编译错误结果
                return crate::test_suite::TestSuiteManifest {
                    suite_id: suite_id.into(),
                    doc_path: None,
                    cases: vec![],
                    updated_at: 0,
                    schema_version: 2,
                };
            });
            return Ok(TestRunResult {
                run_id,
                success: false,
                total: manifest.cases.len(),
                passed: 0,
                stage: RunStage::CompileFailed,
                compile_stdout: stdout,
                compile_stderr: stderr,
                results: vec![],
            });
        }
    };

    // 加载套件清单
    let manifest = TestSuite::load(base, suite_id)?;
    let total = manifest.cases.len();

    let mut results = Vec::with_capacity(total);
    let mut passed_count = 0;

    for (index, case) in manifest.cases.iter().enumerate() {
        // 每个用例运行前检查是否已取消
        let should_cancel = if let Some(rx) = cancel_rx.as_mut() {
            tokio::select! {
                _ = rx => true,
                _ = tokio::time::sleep(std::time::Duration::from_micros(0)) => false,
            }
        } else {
            false
        };
        if should_cancel {
            let _ = app.emit(
                "test_progress",
                TestProgress::Cancelled {
                    run_id: run_id.clone(),
                    index,
                    total,
                },
            );
            break;
        }

        // emit Running
        let _ = app.emit(
            "test_progress",
            TestProgress::Running {
                run_id: run_id.clone(),
                case_id: case.id.clone(),
                index,
                total,
            },
        );

        // 从文件读取 stdin（大样例不经过 IPC）
        let stdin_bytes = TestSuite::read_case_input(base, suite_id, &case.id)?;
        let stdin = String::from_utf8_lossy(&stdin_bytes).into_owned();

        // 运行
        let run_cmd: Vec<String> = vec![exe_path.to_string_lossy().into_owned()];
        let run_out = run_with_limits(
            run_cmd,
            &work_path,
            Some(stdin),
            config.run_timeout,
            limits,
            None,
        )
        .await?;

        let stdout = String::from_utf8_lossy(&run_out.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&run_out.stderr).into_owned();

        // 从文件读取期望输出
        let expected_bytes = TestSuite::read_case_expected(base, suite_id, &case.id)?;
        let expected = String::from_utf8_lossy(&expected_bytes).into_owned();

        // 用例级 strict 优先，fallback 到全局 strict
        let case_strict = case.strict || strict;
        let passed = judge_case_passed(
            run_out.exit_code,
            &expected,
            &stdout,
            run_out.duration_ms,
            config.test_time_limit_ms,
            case_strict,
        );
        let expected_norm = normalize_output(&expected, case_strict);
        let actual_norm = normalize_output(&stdout, case_strict);
        let first_diff = if passed {
            None
        } else {
            first_diff_index(&expected_norm, &actual_norm)
        };

        if passed {
            passed_count += 1;
            let _ = app.emit(
                "test_progress",
                TestProgress::Passed {
                    run_id: run_id.clone(),
                    case_id: case.id.clone(),
                    index,
                    total,
                    duration_ms: run_out.duration_ms,
                },
            );
        } else {
            let _ = app.emit(
                "test_progress",
                TestProgress::Failed {
                    run_id: run_id.clone(),
                    case_id: case.id.clone(),
                    index,
                    total,
                    duration_ms: run_out.duration_ms,
                    first_diff,
                },
            );
        }

        results.push(TestCaseResult {
            id: case.id.clone(),
            passed,
            stdout,
            stderr,
            exit_code: run_out.exit_code,
            duration_ms: run_out.duration_ms,
            killed_by: run_out.killed_by,
            truncated: run_out.truncated,
            first_diff,
            max_rss_kb: run_out.max_rss_kb,
        });
    }

    Ok(TestRunResult {
        run_id,
        success: passed_count == total && total > 0,
        total,
        passed: passed_count,
        stage: RunStage::Ran,
        compile_stdout: String::new(),
        compile_stderr: String::new(),
        results,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_default_ignores_trailing_newline() {
        assert_eq!(normalize_output("hello\n", false), "hello");
        assert_eq!(normalize_output("hello\r\n", false), "hello");
        assert_eq!(normalize_output("hello\n\n\n", false), "hello");
        assert_eq!(normalize_output("a\nb\n", false), "a\nb");
        assert_eq!(normalize_output("a\r\nb\r\n", false), "a\nb");
    }

    #[test]
    fn normalize_strict_keeps_trailing_newline() {
        assert_eq!(normalize_output("hello\n", true), "hello\n");
        assert_eq!(normalize_output("hello\r\n", true), "hello\n");
        assert_eq!(normalize_output("hello\n\n\n", true), "hello\n\n\n");
        assert_eq!(normalize_output("a\nb\n", true), "a\nb\n");
    }

    #[test]
    fn first_diff_finds_position() {
        assert_eq!(first_diff_index("abc", "abc"), None);
        assert_eq!(first_diff_index("abc", "axc"), Some(1));
        assert_eq!(first_diff_index("abc", "ab"), Some(2));
        assert_eq!(first_diff_index("ab", "abc"), Some(2));
        assert_eq!(first_diff_index("", ""), None);
        assert_eq!(first_diff_index("", "a"), Some(0));
    }

    #[test]
    fn judge_passed_normal() {
        assert!(judge_case_passed(Some(0), "hello", "hello", 100, 1000, false));
    }

    #[test]
    fn judge_failed_wrong_output() {
        assert!(!judge_case_passed(Some(0), "hello", "world", 100, 1000, false));
    }

    #[test]
    fn judge_failed_nonzero_exit() {
        assert!(!judge_case_passed(Some(1), "hello", "hello", 100, 1000, false));
    }

    #[test]
    fn judge_failed_time_exceeded() {
        // 输出正确但超时 → 失败
        assert!(!judge_case_passed(Some(0), "hello", "hello", 1500, 1000, false));
    }

    #[test]
    fn judge_passed_at_limit_boundary() {
        // duration == limit 不算超时（> 才算）
        assert!(judge_case_passed(Some(0), "hello", "hello", 1000, 1000, false));
    }

    #[test]
    fn judge_passed_strict_mode() {
        // strict 模式：尾部换行敏感
        assert!(!judge_case_passed(Some(0), "hello\n", "hello", 100, 1000, true));
        assert!(judge_case_passed(Some(0), "hello\n", "hello\n", 100, 1000, true));
    }

    #[test]
    fn judge_passed_non_strict_ignores_trailing_newline() {
        // 非 strict 模式：尾部换行不敏感
        assert!(judge_case_passed(Some(0), "hello\n", "hello", 100, 1000, false));
        assert!(judge_case_passed(Some(0), "hello", "hello\n\n\n", 100, 1000, false));
    }
}
