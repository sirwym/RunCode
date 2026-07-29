use serde::Serialize;
use std::path::Path;
use std::time::Duration;

use tokio::sync::oneshot;

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
/// `cancel_rx` 来自 RunManager：drop Sender 端时 Receiver 返回 Err → 触发取消分支。
/// 传 `None` 表示不可取消（单元测试用）。
pub async fn run_with_limits(
    cmd: Vec<String>,
    cwd: &Path,
    stdin: Option<String>,
    timeout: Duration,
    limits: ResourceLimits,
    cancel_rx: Option<oneshot::Receiver<()>>,
) -> Result<RunOutput, AppError> {
    run_with_limits_impl(cmd, cwd, stdin, timeout, limits, cancel_rx).await
}
