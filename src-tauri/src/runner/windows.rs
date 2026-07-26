use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::oneshot;

use crate::error::AppError;
use crate::runner::executor::{KillReason, RunOutput};
use crate::runner::limits::ResourceLimits;
use crate::runner::output::{read_until_limit, MAX_OUTPUT_BYTES};

/// 带资源限制、超时与取消的执行核心（Windows 实现）。
///
/// Windows 与 Unix 的差异：
/// - 用 `CREATE_NEW_PROCESS_GROUP` 替代 `process_group(0)`
/// - 用 JobObject + `JOB_OBJECT_LIMIT_JOB_TIME` 替代 `RLIMIT_CPU`
/// - **不实现 fsize 限制**（Windows 无 RLIMIT_FSIZE 等价 API）
/// - **不实现内存限制**（RLIMIT_DATA/AS/RSS 在 macOS 已无效，Windows 同样不实现）
/// - 内存采集用 `GetProcessMemoryInfo` 轮询（每 100ms），取峰值
/// - 进程组 kill 用 `TerminateJobObject`（一次杀所有）
/// - `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 确保 JobObject 句柄关闭时杀子进程
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
        return Err(AppError::Other {
            detail: "命令为空".into(),
        });
    }

    let start = Instant::now();

    // Windows 用 tokio::process::Command（内部用 CreateProcess）
    // process_group(0) 在 Windows 上是 no-op，需要用 creation_flags(0x00000200)
    // 即 CREATE_NEW_PROCESS_GROUP。tokio Command 在 Windows 上原生支持 creation_flags。
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    let mut command = Command::new(&cmd[0]);
    command
        .args(&cmd[1..])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command.creation_flags(CREATE_NEW_PROCESS_GROUP);

    let mut child = command.spawn()?;
    let pid = child
        .id()
        .ok_or_else(|| AppError::ProcessGroup {
            detail: "无法获取子进程 PID".into(),
        })?;

    // 创建 JobObject 并设置 CPU 时间限制
    let h_job = create_job_with_limits(limits.cpu_secs)?;

    // 把子进程加入 JobObject（Windows 8+ 允许把已启动的进程加入 JobObject）
    assign_process_to_job(h_job.0, pid)?;

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

    // 后台线程轮询内存峰值
    let (mem_tx, mem_rx) = std::sync::mpsc::channel::<u64>();
    let exit_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let exit_flag_clone = exit_flag.clone();
    std::thread::spawn(move || {
        let mut max_rss = 0u64;
        while !exit_flag_clone.load(std::sync::atomic::Ordering::Relaxed) {
            if let Some(rss) = query_process_rss_kb(pid) {
                if rss > max_rss {
                    max_rss = rss;
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        // 进程退出后再查一次最终峰值
        if let Some(rss) = query_process_rss_kb(pid) {
            if rss > max_rss {
                max_rss = rss;
            }
        }
        let _ = mem_tx.send(max_rss);
    });

    // 三路竞速：子进程结束 / 墙钟超时 / 外部取消
    let mut killed_by: Option<KillReason> = None;
    let exit_status_result = if let Some(mut cancel_rx) = cancel_rx {
        tokio::select! {
            status = child.wait() => {
                Some(status)
            }
            _ = tokio::time::sleep(timeout) => {
                terminate_job(h_job.0);
                let _ = child.wait().await;
                killed_by = Some(KillReason::Timeout);
                None
            }
            _ = &mut cancel_rx => {
                terminate_job(h_job.0);
                let _ = child.wait().await;
                killed_by = Some(KillReason::Cancelled);
                None
            }
        }
    } else {
        // 无取消信号（单元测试路径）
        tokio::select! {
            status = child.wait() => {
                Some(status)
            }
            _ = tokio::time::sleep(timeout) => {
                terminate_job(h_job.0);
                let _ = child.wait().await;
                killed_by = Some(KillReason::Timeout);
                None
            }
        }
    };

    // 通知内存轮询线程退出并收集结果
    exit_flag.store(true, std::sync::atomic::Ordering::Relaxed);
    let max_rus_kb = mem_rx.recv().unwrap_or(0);

    // 等输出读取任务结束
    let (stdout_bytes, stdout_trunc) = stdout_task
        .await
        .map_err(|e| AppError::Other {
            detail: format!("stdout 读取任务失败: {e}"),
        })??;
    let (stderr_bytes, stderr_trunc) = stderr_task
        .await
        .map_err(|e| AppError::Other {
            detail: format!("stderr 读取任务失败: {e}"),
        })??;

    // 解析退出码
    let exit_code = match exit_status_result {
        Some(Ok(status)) => status.code(),
        Some(Err(_)) => None,
        None => None,
    };

    // Windows 上无 signal 概念，超时/取消已标记 killed_by
    // JobObject 的 CPU 时间超限会触发进程被杀，exit_code 为 None，需补充 Signal 标记
    if killed_by.is_none() && exit_code.is_none() {
        killed_by = Some(KillReason::Signal);
    }

    // 关闭 JobObject 句柄（KILL_ON_JOB_CLOSE 会确保子进程已被杀）
    close_handle(h_job.0);

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

// ============== Windows API 封装 ==============

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject, TerminateJobObject,
    JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_JOB_TIME, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows::Win32::System::Threading::PROCESS_QUERY_INFORMATION;

/// 包装 Windows HANDLE 使其实现 Send。
/// HANDLE 是 *mut c_void 的别名，裸指针不实现 Send，无法跨 await 点持有。
/// JobObject 句柄在单线程内使用，仅用于让 async future 满足 Send 约束。
struct SendHandle(HANDLE);
unsafe impl Send for SendHandle {}

/// 创建 JobObject 并设置 CPU 时间限制
fn create_job_with_limits(cpu_secs: u64) -> Result<SendHandle, AppError> {
    unsafe {
        let h_job = CreateJobObjectW(None, None)
            .map_err(|e| AppError::Other {
                detail: format!("CreateJobObjectW 失败: {e}"),
            })?;

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        // PerJobUserTimeLimit 单位是 100ns
        info.BasicLimitInformation.PerJobUserTimeLimit = (cpu_secs * 10_000_000) as i64;
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_JOB_TIME | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        SetInformationJobObject(
            h_job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|e| AppError::Other {
            detail: format!("SetInformationJobObject 失败: {e}"),
        })?;

        Ok(SendHandle(h_job))
    }
}

/// 把进程加入 JobObject
fn assign_process_to_job(h_job: HANDLE, pid: u32) -> Result<(), AppError> {
    use windows::Win32::System::Threading::OpenProcess;
    use windows::Win32::System::Threading::PROCESS_SET_QUOTA;

    unsafe {
        let h_process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION, false, pid)
            .map_err(|e| AppError::Other {
                detail: format!("OpenProcess({pid}) 失败: {e}"),
            })?;

        AssignProcessToJobObject(h_job, h_process).map_err(|e| AppError::Other {
            detail: format!("AssignProcessToJobObject 失败: {e}"),
        })?;

        let _ = CloseHandle(h_process);
        Ok(())
    }
}

/// 终止 JobObject 内所有进程
fn terminate_job(h_job: HANDLE) {
    unsafe {
        let _ = TerminateJobObject(h_job, 1);
    }
}

/// 关闭句柄
fn close_handle(h: HANDLE) {
    unsafe {
        let _ = CloseHandle(h);
    }
}

/// 查询进程内存峰值（KB）
fn query_process_rss_kb(pid: u32) -> Option<u64> {
    use windows::Win32::System::Threading::OpenProcess;

    unsafe {
        let h_process = OpenProcess(PROCESS_QUERY_INFORMATION, false, pid).ok()?;
        let mut counters = PROCESS_MEMORY_COUNTERS::default();
        let ok = GetProcessMemoryInfo(
            h_process,
            &mut counters,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        );
        let _ = CloseHandle(h_process);
        if ok.is_ok() {
            // PeakWorkingSetSize 单位是字节，转 KB
            Some(counters.PeakWorkingSetSize as u64 / 1024)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn cmd_cmd(script: &str) -> Vec<String> {
        vec!["cmd".into(), "/c".into(), script.into()]
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
            cmd_cmd("echo hi"),
            PathBuf::from(".").as_path(),
            None,
            Duration::from_secs(2),
            limits(),
            None,
        )
        .await
        .unwrap();

        assert_eq!(out.exit_code, Some(0));
        assert_eq!(String::from_utf8_lossy(&out.stdout), "hi\r\n");
        assert!(out.killed_by.is_none());
    }

    #[tokio::test]
    async fn timeout_kills_process() {
        let out = run_with_limits(
            cmd_cmd("ping -n 30 127.0.0.1 > nul"),
            PathBuf::from(".").as_path(),
            None,
            Duration::from_millis(500),
            limits(),
            None,
        )
        .await
        .unwrap();

        assert!(
            matches!(out.killed_by, Some(KillReason::Timeout)),
            "实际 {:?}",
            out.killed_by
        );
        assert!(
            out.duration_ms < 2000,
            "应在 2s 内返回，实际 {}ms",
            out.duration_ms
        );
    }

    #[tokio::test]
    async fn cancel_kills_process() {
        let (tx, rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            run_with_limits(
                cmd_cmd("ping -n 30 127.0.0.1 > nul"),
                PathBuf::from(".").as_path(),
                None,
                Duration::from_secs(30),
                limits(),
                Some(rx),
            )
            .await
        });

        // 200ms 后取消
        tokio::time::sleep(Duration::from_millis(200)).await;
        drop(tx);

        let out = handle.await.unwrap().unwrap();
        assert!(
            matches!(out.killed_by, Some(KillReason::Cancelled)),
            "应被取消，实际 {:?}",
            out.killed_by
        );
        assert!(
            out.duration_ms < 2000,
            "应在 2s 内返回，实际 {}ms",
            out.duration_ms
        );
    }
}
