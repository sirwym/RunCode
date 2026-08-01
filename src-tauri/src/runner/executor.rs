use serde::Serialize;
use std::path::Path;
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::runner::limits::ResourceLimits;

#[cfg(unix)]
#[path = "unix.rs"]
pub mod unix;
#[cfg(windows)]
#[path = "windows.rs"]
pub mod windows;

#[cfg(unix)]
use unix::run_with_limits as run_with_limits_impl;
#[cfg(windows)]
use windows::run_with_limits as run_with_limits_impl;

/// 进程被杀的原因
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KillReason {
    /// 墙钟超时
    Timeout,
    /// 被信号杀死（含 RLIMIT_CPU/FSIZE 触发的 SIGXCPU/SIGXFSZ；Windows 上 JobObject CPU 超限）
    Signal,
    /// 用户主动取消
    Cancelled,
}

/// 单次运行结果
#[derive(Debug, Clone, Serialize)]
pub struct RunOutput {
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub duration_ms: u64,
    pub killed_by: Option<KillReason>,
    pub truncated: bool,
    /// 子进程内存峰值（KB）
    /// - macOS: proc_pid_rusage 轮询 ri_resident_size 取 max，精确到具体 PID
    /// - Linux: RUSAGE_CHILDREN 差值法（已知不可靠，不在正式支持范围）
    /// - Windows: GetProcessMemoryInfo 的 PeakWorkingSetSize，轮询采集
    /// 超时/取消分支未完成 wait，记为 0
    pub max_rss_kb: u64,
    /// Windows JobObject 降级标志
    /// - true: AssignProcessToJobObject 失败，CPU 时间限制未生效（仅墙钟超时可用）
    /// - false: Unix 平台 / Windows 正常路径
    pub job_object_degraded: bool,
}

/// 带资源限制、超时与取消的执行核心（平台分发）。
///
/// 平台实现：
/// - Unix（macOS/Linux）：`runner/unix.rs`，用 process_group + pre_exec(setrlimit) + getrusage
/// - Windows：`runner/windows.rs`，用 JobObject + CREATE_NEW_PROCESS_GROUP + GetProcessMemoryInfo
///
/// 平台差异：
/// - fsize 限制：Unix 有（RLIMIT_FSIZE），Windows 无（API 不支持）
/// - 内存限制：两平台均不实现（macOS RLIMIT_DATA 只接受 INFINITY）
/// - CPU 限制：Unix 用 RLIMIT_CPU，Windows 用 JobObject LIMIT_JOB_TIME
///
/// `cancel_token` 来自 RunManager：调用 token.cancel() 后所有 clone 副本的 cancelled() future
/// 同时触发，从而触发取消分支。相比 oneshot 一次性 Receiver，CancellationToken 可被
/// 多个执行阶段 clone 复用（编译→运行、批量测试每例）。
/// 传 `None` 表示不可取消（单元测试用）。
pub async fn run_with_limits(
    cmd: Vec<String>,
    cwd: &Path,
    stdin: Option<String>,
    timeout: Duration,
    limits: ResourceLimits,
    cancel_token: Option<CancellationToken>,
) -> Result<RunOutput, AppError> {
    run_with_limits_impl(cmd, cwd, stdin, timeout, limits, cancel_token).await
}
