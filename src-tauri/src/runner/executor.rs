use std::io;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use libc::{kill, rlimit, setrlimit};
use serde::Serialize;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::oneshot;

use crate::error::AppError;
use crate::runner::limits::ResourceLimits;
use crate::runner::output::{read_until_limit, MAX_OUTPUT_BYTES};

/// 进程被杀的原因
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KillReason {
    /// 墙钟超时
    Timeout,
    /// 被信号杀死（含 RLIMIT_CPU/FSIZE 触发的 SIGXCPU/SIGXFSZ）
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
    /// macOS: ru_maxrss 单位是字节，运行时转 KB；Linux: 已是 KB
    /// 超时/取消分支未完成 wait，记为 0
    pub max_rus_kb: u64,
}

/// 杀整个进程组（负号 PGID）
fn kill_process_group(pgid: i32) {
    // 信号量为 0 表示无信号，仅检查；这里用 SIGKILL
    unsafe { kill(-pgid, libc::SIGKILL) };
}

/// 读取 RUSAGE_CHILDREN 的 ru_maxrss（累计值），统一返回 KB。
/// macOS ru_maxrss 单位是字节，需 / 1024；Linux 已是 KB。
fn get_children_rusage_max_rss_kb() -> u64 {
    unsafe {
        let mut ru: libc::rusage = std::mem::zeroed();
        if libc::getrusage(libc::RUSAGE_CHILDREN, &mut ru) == 0 {
            #[cfg(target_os = "macos")]
            { (ru.ru_maxrss as u64) / 1024 }
            #[cfg(target_os = "linux")]
            { ru.ru_maxrss as u64 }
            #[cfg(not(any(target_os = "macos", target_os = "linux")))]
            { 0 }
        } else {
            0
        }
    }
}

/// 等待子进程退出并采集 ru_maxrss（前后差值，单活动任务互斥下准确）。
/// 返回 (exit_status_result, max_rss_kb)。
async fn wait_with_rusage(
    child: &mut tokio::process::Child,
) -> (io::Result<std::process::ExitStatus>, u64) {
    let baseline = get_children_rusage_max_rss_kb();
    let status = child.wait().await;
    let after = get_children_rusage_max_rss_kb();
    let max_rss_kb = if after > baseline { after - baseline } else { 0 };
    (status, max_rss_kb)
}

/// 在 pre_exec（fork 后、exec 前）中设置资源限制。
/// 此函数必须 async-signal-safe：不能分配内存、不能持锁、不能 panic。
///
/// macOS 上仅 RLIMIT_CPU 和 RLIMIT_FSIZE 有效：
/// - RLIMIT_NPROC 限制用户总进程数，不能用于单进程 fork 控制
/// - RLIMIT_DATA/AS/RSS 只接受 INFINITY
fn apply_limits_in_pre_exec(limits: ResourceLimits) -> io::Result<()> {
    let set = |res: libc::c_int, cur: u64, max: u64| -> io::Result<()> {
        let rl = rlimit {
            rlim_cur: cur,
            rlim_max: max,
        };
        // SAFETY: setrlimit 是 POSIX async-signal-safe 函数
        if unsafe { setrlimit(res, &rl) } != 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    };

    set(libc::RLIMIT_CPU, limits.cpu_secs, limits.cpu_secs)?;
    let fsize_bytes = limits.fsize_mb.checked_mul(1024 * 1024).unwrap_or(u64::MAX);
    set(libc::RLIMIT_FSIZE, fsize_bytes, fsize_bytes)?;
    Ok(())
}

/// 带资源限制、超时与取消的执行核心。
///
/// - 用 `process_group(0)` 让子进程成为独立进程组组长
/// - 在 `pre_exec` 中调 `setrlimit` 设置 CPU/文件大小限制
/// - `tokio::select!` 三路竞速：子进程结束 / 墙钟超时 / 外部取消
/// - 超时或取消后用 `kill(-PGID, SIGKILL)` 杀整个进程组，杜绝残留
/// - stdout/stderr 各按 8KB 块读取，累计 1MB 截断
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
    if cmd.is_empty() {
        return Err(AppError::Other { detail: "命令为空".into() });
    }

    let start = Instant::now();

    let mut command = Command::new(&cmd[0]);
    command
        .args(&cmd[1..])
        .current_dir(cwd)
        .process_group(0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // SAFETY: pre_exec 闭包只调 async-signal-safe 的 setrlimit
    unsafe {
        command.pre_exec(move || apply_limits_in_pre_exec(limits));
    }

    let mut child = command.spawn()?;
    let pid = child
        .id()
        .ok_or_else(|| AppError::ProcessGroup { detail: "无法获取子进程 PID".into() })?;
    // process_group(0) 使子进程自己成为组长，故 PGID == PID
    let pgid = pid as i32;

    // 写 stdin（独立任务，避免阻塞 select）
    if let Some(input) = stdin {
        if let Some(mut stdin_handle) = child.stdin.take() {
            tokio::spawn(async move {
                let _ = stdin_handle.write_all(input.as_bytes()).await;
                let _ = stdin_handle.shutdown().await;
            });
        }
    }

    // 取出 stdout/stderr 句柄，让 child.wait() 不被管道阻塞
    let mut stdout = child.stdout.take().expect("stdout 已设为 piped");
    let mut stderr = child.stderr.take().expect("stderr 已设为 piped");

    // 独立任务读两路输出
    let stdout_task =
        tokio::spawn(async move { read_until_limit(&mut stdout, MAX_OUTPUT_BYTES).await });
    let stderr_task =
        tokio::spawn(async move { read_until_limit(&mut stderr, MAX_OUTPUT_BYTES).await });

    // 三路竞速：子进程结束 / 墙钟超时 / 外部取消
    let mut killed_by: Option<KillReason> = None;
    let mut max_rus_kb: u64 = 0;
    let exit_status_result = if let Some(mut cancel_rx) = cancel_rx {
        tokio::select! {
            (status, rss) = wait_with_rusage(&mut child) => {
                max_rus_kb = rss;
                Some(status)
            }
            _ = tokio::time::sleep(timeout) => {
                kill_process_group(pgid);
                let _ = child.wait().await;
                killed_by = Some(KillReason::Timeout);
                None
            }
            _ = &mut cancel_rx => {
                kill_process_group(pgid);
                let _ = child.wait().await;
                killed_by = Some(KillReason::Cancelled);
                None
            }
        }
    } else {
        // 无取消信号（单元测试路径）
        tokio::select! {
            (status, rss) = wait_with_rusage(&mut child) => {
                max_rus_kb = rss;
                Some(status)
            }
            _ = tokio::time::sleep(timeout) => {
                kill_process_group(pgid);
                let _ = child.wait().await;
                killed_by = Some(KillReason::Timeout);
                None
            }
        }
    };

    // 等输出读取任务结束
    let (stdout_bytes, stdout_trunc) = stdout_task
        .await
        .map_err(|e| AppError::Other { detail: format!("stdout 读取任务失败: {e}") })??;
    let (stderr_bytes, stderr_trunc) = stderr_task
        .await
        .map_err(|e| AppError::Other { detail: format!("stderr 读取任务失败: {e}") })??;

    // 解析退出码与被信号杀死的情况
    let exit_code = match exit_status_result {
        Some(Ok(status)) => status.code(),
        Some(Err(_)) => None,
        None => None,
    };

    // 如果尚未标记原因，但进程被信号杀死，标记为 Signal
    if killed_by.is_none() {
        if let Some(Ok(status)) = exit_status_result {
            #[cfg(unix)]
            {
                use std::os::unix::process::ExitStatusExt;
                if status.signal().is_some() {
                    killed_by = Some(KillReason::Signal);
                }
            }
        }
    }

    Ok(RunOutput {
        exit_code,
        stdout: stdout_bytes,
        stderr: stderr_bytes,
        duration_ms: start.elapsed().as_millis() as u64,
        killed_by,
        truncated: stdout_trunc || stderr_trunc,
        max_rus_kb,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn bash_cmd(script: &str) -> Vec<String> {
        vec!["/bin/bash".into(), "-c".into(), script.into()]
    }

    fn limits() -> ResourceLimits {
        ResourceLimits {
            cpu_secs: 10,
            fsize_mb: 50,
        }
    }

    #[tokio::test]
    async fn hello_world() {
        let out = run_with_limits(
            bash_cmd("echo hi"),
            PathBuf::from("/tmp").as_path(),
            None,
            Duration::from_secs(2),
            limits(),
            None,
        )
        .await
        .unwrap();

        assert_eq!(out.exit_code, Some(0));
        assert_eq!(String::from_utf8_lossy(&out.stdout), "hi\n");
        assert!(out.killed_by.is_none());
    }

    #[tokio::test]
    async fn captures_max_rss() {
        // 运行一个稍微吃内存的命令，确保 ru_maxrss > 0
        // bash + sleep 会占用几百 KB
        let out = run_with_limits(
            bash_cmd("echo hello; sleep 0.05"),
            PathBuf::from("/tmp").as_path(),
            None,
            Duration::from_secs(2),
            limits(),
            None,
        )
        .await
        .unwrap();

        assert_eq!(out.exit_code, Some(0));
        assert!(
            out.max_rus_kb > 0,
            "max_rss_kb 应大于 0，实际 {}",
            out.max_rus_kb
        );
    }

    #[tokio::test]
    async fn timeout_kills_process_group() {
        let out = run_with_limits(
            bash_cmd("sleep 30"),
            PathBuf::from("/tmp").as_path(),
            None,
            Duration::from_millis(500),
            limits(),
            None,
        )
        .await
        .unwrap();

        assert!(matches!(out.killed_by, Some(KillReason::Timeout)), "实际 {:?}", out.killed_by);
        assert!(out.duration_ms < 2000, "应在 2s 内返回，实际 {}ms", out.duration_ms);

        let ps = std::process::Command::new("pgrep")
            .arg("-l")
            .arg("sleep")
            .output()
            .unwrap();
        let ps_out = String::from_utf8_lossy(&ps.stdout);
        let foreign = ps_out.lines().filter(|l| !l.contains("pgrep")).count();
        assert_eq!(foreign, 0, "发现残留 sleep 进程:\n{ps_out}");
    }

    #[tokio::test]
    async fn timeout_kills_child_processes() {
        let out = run_with_limits(
            bash_cmd("sleep 30 & sleep 30 & wait"),
            PathBuf::from("/tmp").as_path(),
            None,
            Duration::from_millis(500),
            limits(),
            None,
        )
        .await
        .unwrap();

        assert!(out.duration_ms < 2000, "应在 2s 内返回，实际 {}ms", out.duration_ms);

        // 等待被 kill 的进程完全退出被 OS 回收，避免 pgrep 偶现捕获到退出中的进程
        tokio::time::sleep(Duration::from_millis(800)).await;

        let ps = std::process::Command::new("pgrep")
            .arg("-l")
            .arg("sleep")
            .output()
            .unwrap();
        let ps_out = String::from_utf8_lossy(&ps.stdout);
        let foreign = ps_out.lines().filter(|l| !l.contains("pgrep")).count();
        assert_eq!(foreign, 0, "发现残留 sleep 子进程:\n{ps_out}");
    }

    #[tokio::test]
    async fn output_truncated_at_1mb() {
        let out = run_with_limits(
            bash_cmd("yes hello | head -c 5242880"),
            PathBuf::from("/tmp").as_path(),
            None,
            Duration::from_secs(5),
            limits(),
            None,
        )
        .await
        .unwrap();

        assert!(out.truncated, "应被截断");
        assert_eq!(out.stdout.len(), MAX_OUTPUT_BYTES, "应恰好 1MB");
    }

    #[tokio::test]
    async fn cpu_limit_kills_infinite_loop() {
        let out = run_with_limits(
            bash_cmd("while true; do :; done"),
            PathBuf::from("/tmp").as_path(),
            None,
            Duration::from_secs(10),
            ResourceLimits {
                cpu_secs: 1,
                fsize_mb: 10,
            },
            None,
        )
        .await
        .unwrap();

        assert!(out.duration_ms < 3000, "应在 3s 内被 CPU 限制杀死，实际 {}ms", out.duration_ms);
        assert!(
            matches!(out.killed_by, Some(KillReason::Signal)),
            "应被信号杀死，实际 {:?}",
            out.killed_by
        );
    }

    #[tokio::test]
    async fn cancel_kills_process() {
        let (tx, rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            run_with_limits(
                bash_cmd("sleep 30"),
                PathBuf::from("/tmp").as_path(),
                None,
                Duration::from_secs(30),
                limits(),
                Some(rx),
            )
            .await
        });

        // 200ms 后取消
        tokio::time::sleep(Duration::from_millis(200)).await;
        drop(tx); // drop Sender → Receiver 收到 Err → 取消分支

        let out = handle.await.unwrap().unwrap();
        assert!(
            matches!(out.killed_by, Some(KillReason::Cancelled)),
            "应被取消，实际 {:?}",
            out.killed_by
        );
        assert!(out.duration_ms < 2000, "应在 2s 内返回，实际 {}ms", out.duration_ms);

        // 等待被 kill 的进程完全退出被 OS 回收，避免 pgrep 偶现捕获到退出中的进程
        tokio::time::sleep(Duration::from_millis(800)).await;

        // 验证无残留
        let ps = std::process::Command::new("pgrep")
            .arg("-l")
            .arg("sleep")
            .output()
            .unwrap();
        let ps_out = String::from_utf8_lossy(&ps.stdout);
        let foreign = ps_out.lines().filter(|l| !l.contains("pgrep")).count();
        assert_eq!(foreign, 0, "发现残留 sleep 进程:\n{ps_out}");
    }
}
