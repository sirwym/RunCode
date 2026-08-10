use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;

use crate::commands::compile_run::{compile_only, load_config, CompileScenario, RunStage};
use crate::error::AppError;
use crate::run_manager::{RunKind, RunManager};
use crate::runner::{run_with_limits, KillReason, ResourceLimits};
use crate::test_suite::{CaseMeta, TestSuite};

/// 过滤用例清单（纯函数，便于单测）。
/// - `case_ids = None`：返回全部用例引用
/// - `case_ids = Some(ids)`：只保留 ids 中命中的用例，保持 manifest 原顺序
fn filter_cases<'a>(cases: &'a [CaseMeta], case_ids: Option<&[String]>) -> Vec<&'a CaseMeta> {
    cases
        .iter()
        .filter(|c| case_ids.map_or(true, |ids| ids.iter().any(|id| id == &c.id)))
        .collect()
}

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
    /// 本次测试编译实际使用的优化级别（运行开始时快照）
    pub used_opt_level: String,
    pub results: Vec<TestCaseResult>,
    /// 本次测试是否发生 JobObject 降级（任意一例降级则为 true）
    pub job_object_degraded: bool,
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
        // 非严格模式：去掉每行行尾空白（空格/tab）+ 整串末尾换行
        // 教学场景：行末空白和换行不应影响判定，对齐主流 OJ 行为
        s.split('\n')
            .map(|line| line.trim_end())
            .collect::<Vec<_>>()
            .join("\n")
            .trim_end_matches('\n')
            .to_string()
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
/// - 编译和每例运行都 clone 同一 CancellationToken，支持编译期/用例间/用例中取消
/// - 每个用例运行前 emit `test_progress` (Running)
/// - 每个用例运行后 emit `test_progress` (Passed/Failed)
/// - 取消时 emit `test_progress` (Cancelled)
///
/// RAII guard 保证任何 ? 提前返回（包括 load_config 失败）都自动 complete 会话。
#[tauri::command]
pub async fn run_tests(
    code: String,
    suite_id: String,
    strict: Option<bool>,
    case_ids: Option<Vec<String>>,
    run_id: String,
    app: AppHandle,
    manager: State<'_, RunManager>,
) -> Result<TestRunResult, AppError> {
    let strict = strict.unwrap_or(false);

    // 接受前端传入的 run_id，让停止按钮在 invoke 前就可用
    let cancel_token = manager
        .register_with_id(run_id.clone(), RunKind::TestRun)
        .map_err(|e| AppError::Other { detail: e })?;

    // RAII guard：任何 ? 提前返回（包括 base_dir/load_config 失败）都保证 complete 执行
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

    let base = base_dir(&app)?;
    let (_settings, config, limits) = load_config(&app)?;
    let result = run_tests_inner(
        &code,
        &suite_id,
        strict,
        case_ids.as_deref(),
        &base,
        run_id.clone(),
        cancel_token,
        &app,
        &config,
        limits,
    )
    .await;
    // guard 自然 drop 时调用 complete，释放 RunManager 会话。
    // 不主动设 active=false（之前的写法导致 Drop 不调用 complete，session 永久残留）。
    drop(guard);
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
    case_ids: Option<&[String]>,
    base: &Path,
    run_id: String,
    cancel_token: CancellationToken,
    app: &AppHandle,
    config: &crate::config::CompilerConfig,
    limits: ResourceLimits,
) -> Result<TestRunResult, AppError> {
    // 临时工作目录
    let work_dir = tempfile::TempDir::new()?;
    let work_path = work_dir.path().to_path_buf();

    // 编译（复用 compile_only，测试场景用 test.opt_level）
    // clone token 保留原 token 给每例运行
    let exe_path = match compile_only(
        code,
        config,
        CompileScenario::Test,
        &work_path,
        limits,
        Some(cancel_token.clone()),
    )
    .await?
    {
        crate::commands::compile_run::CompileResult::Success { exe_path, .. } => exe_path,
        crate::commands::compile_run::CompileResult::Failed {
            stdout,
            stderr,
            exit_code: _,
        } => {
            // 加载套件清单并按 case_ids 过滤，保证 total 与运行分支一致
            let manifest = TestSuite::load(base, suite_id).unwrap_or_else(|_| {
                // 加载失败也返回编译错误结果
                crate::test_suite::TestSuiteManifest {
                    suite_id: suite_id.into(),
                    doc_path: None,
                    cases: vec![],
                    updated_at: 0,
                    schema_version: 2,
                }
            });
            let filtered = filter_cases(&manifest.cases, case_ids);
            return Ok(TestRunResult {
                run_id,
                success: false,
                total: filtered.len(),
                passed: 0,
                stage: RunStage::CompileFailed,
                compile_stdout: stdout,
                compile_stderr: stderr,
                used_opt_level: config.test_opt_level.clone(),
                results: vec![],
                job_object_degraded: false,
            });
        }
    };

    // 加载套件清单并按 case_ids 过滤
    let manifest = TestSuite::load(base, suite_id)?;
    let filtered = filter_cases(&manifest.cases, case_ids);
    let total = filtered.len();

    let mut results = Vec::with_capacity(total);
    let mut passed_count = 0;
    let mut job_object_degraded = false;

    for (index, case) in filtered.iter().enumerate() {
        // 每个用例运行前检查是否已取消（用例间取消）
        if cancel_token.is_cancelled() {
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

        // 运行：每例 clone token，cancel 立即触发 select! 取消分支
        // （之前每例传 None，用例运行中无法取消）
        let run_cmd: Vec<String> = vec![exe_path.to_string_lossy().into_owned()];
        let run_out = run_with_limits(
            run_cmd,
            &work_path,
            Some(stdin),
            config.run_timeout,
            limits,
            Some(cancel_token.clone()),
        )
        .await?;

        // 被取消的用例不应判失败，直接 emit Cancelled 并退出循环。
        // 修复前：judge_case_passed 看到 exit_code=None 判 Failed，最后一个用例连 Cancelled 都不发。
        if matches!(run_out.killed_by, Some(KillReason::Cancelled)) {
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

        // 聚合 JobObject 降级标志（任意一例降级则为 true）
        if run_out.job_object_degraded {
            job_object_degraded = true;
        }
    }

    Ok(TestRunResult {
        run_id,
        success: passed_count == total && total > 0,
        total,
        passed: passed_count,
        stage: RunStage::Ran,
        compile_stdout: String::new(),
        compile_stderr: String::new(),
        used_opt_level: config.test_opt_level.clone(),
        results,
        job_object_degraded,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_case(id: &str) -> CaseMeta {
        CaseMeta {
            id: id.to_string(),
            name: format!("case-{id}"),
            input_size: 0,
            expected_size: 0,
            strict: false,
        }
    }

    #[test]
    fn filter_cases_none_returns_all() {
        let cases = vec![make_case("a"), make_case("b")];
        let filtered = filter_cases(&cases, None);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].id, "a");
        assert_eq!(filtered[1].id, "b");
    }

    #[test]
    fn filter_cases_some_returns_matched_in_original_order() {
        let cases = vec![make_case("a"), make_case("b"), make_case("c")];
        // 传入逆序，结果应保持 manifest 原顺序
        let ids = vec!["c".to_string(), "a".to_string()];
        let filtered = filter_cases(&cases, Some(&ids));
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].id, "a");
        assert_eq!(filtered[1].id, "c");
    }

    #[test]
    fn filter_cases_empty_ids_returns_empty() {
        let cases = vec![make_case("a")];
        let filtered = filter_cases(&cases, Some(&[]));
        assert!(filtered.is_empty());
    }

    #[test]
    fn filter_cases_unmatched_ids_returns_empty() {
        let cases = vec![make_case("a")];
        let ids = vec!["nonexistent".to_string()];
        let filtered = filter_cases(&cases, Some(&ids));
        assert!(filtered.is_empty());
    }

    #[test]
    fn filter_cases_duplicates_in_ids_dont_duplicate_results() {
        let cases = vec![make_case("a"), make_case("b")];
        let ids = vec!["a".to_string(), "a".to_string()];
        let filtered = filter_cases(&cases, Some(&ids));
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "a");
    }

    #[test]
    fn normalize_default_ignores_trailing_newline() {
        assert_eq!(normalize_output("hello\n", false), "hello");
        assert_eq!(normalize_output("hello\r\n", false), "hello");
        assert_eq!(normalize_output("hello\n\n\n", false), "hello");
        assert_eq!(normalize_output("a\nb\n", false), "a\nb");
        assert_eq!(normalize_output("a\r\nb\r\n", false), "a\nb");
        // 末尾换行 + 末尾空格/tab 混合
        assert_eq!(normalize_output("hello   \n", false), "hello");
        assert_eq!(normalize_output("hello\t\n", false), "hello");
    }

    #[test]
    fn normalize_default_trims_trailing_whitespace_per_line() {
        // 每行行尾空格被去除，行内空格保留
        assert_eq!(normalize_output("a   \nb   \n", false), "a\nb");
        assert_eq!(normalize_output("a   b   \n", false), "a   b");
        assert_eq!(normalize_output("  \n  \n", false), "");
        // 无末尾换行时每行行尾空格同样去除
        assert_eq!(normalize_output("a   \nb   ", false), "a\nb");
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

    /// 回归测试：取消时不应调用 judge_case_passed。
    /// judge_case_passed 在 exit_code=None 时返回 false（这是正确行为），
    /// 修复点是在调用 judge 前先检查 killed_by == Cancelled 并 break。
    #[test]
    fn judge_returns_false_for_cancelled_process() {
        // 被取消的进程 exit_code 为 None，judge 必须判 false
        // （修复后不会走到 judge，但 judge 的契约仍需保证）
        assert!(!judge_case_passed(None, "hello", "hello", 100, 1000, false));
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
            .register_with_id(run_id.clone(), RunKind::TestRun)
            .unwrap();
        assert!(manager.is_busy());

        // 复刻 run_tests 中修复后的 guard 模式
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
        assert!(manager.register(RunKind::TestRun).is_ok());
    }
}
