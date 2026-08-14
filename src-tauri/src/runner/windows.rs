use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::runner::executor::{KillReason, RunOutput};
use crate::runner::limits::ResourceLimits;
use crate::runner::output::{read_until_limit_shared, MAX_OUTPUT_BYTES};

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
/// `cancel_token` 来自 RunManager：token.cancel() 后所有 clone 副本的 cancelled() future
/// 同时触发，从而触发取消分支。传 `None` 表示不可取消（单元测试用）。
pub async fn run_with_limits(
    cmd: Vec<String>,
    cwd: &Path,
    stdin: Option<String>,
    timeout: Duration,
    limits: ResourceLimits,
    cancel_token: Option<CancellationToken>,
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
    // CREATE_NO_WINDOW (0x08000000)：Tauri 是 GUI 子系统无控制台，spawn 控制台程序
    // （g++ 等）时若不设此标志，Windows 会自动创建控制台窗口（"小黑框"）。
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut command = Command::new(&cmd[0]);
    command
        .args(&cmd[1..])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);

    let mut child = command.spawn()?;
    let pid = child
        .id()
        .ok_or_else(|| AppError::ProcessGroup {
            detail: "无法获取子进程 PID".into(),
        })?;

    // 创建 JobObject 并设置 CPU 时间限制
    let h_job = create_job_with_limits(limits.cpu_secs)?;

    // 把子进程加入 JobObject（Windows 8+ 允许把已启动的进程加入 JobObject）
    // 返回 true=正常，false=降级（CPU 时间限制未生效，仅墙钟超时可用）
    let job_object_degraded = assign_process_to_job(h_job.0, pid)?;

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
    let stdout = child.stdout.take().expect("stdout 已设为 piped");
    let stderr = child.stderr.take().expect("stderr 已设为 piped");

    // 独立任务读两路输出（共享缓冲区：超时后仍能获取已读数据）
    let stdout_buf = std::sync::Arc::new(std::sync::Mutex::new(Vec::with_capacity(8 * 1024)));
    let stdout_trunc = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stderr_buf = std::sync::Arc::new(std::sync::Mutex::new(Vec::with_capacity(8 * 1024)));
    let stderr_trunc = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    let stdout_task = tokio::spawn(read_until_limit_shared(
        stdout,
        MAX_OUTPUT_BYTES,
        stdout_buf.clone(),
        stdout_trunc.clone(),
    ));
    let stderr_task = tokio::spawn(read_until_limit_shared(
        stderr,
        MAX_OUTPUT_BYTES,
        stderr_buf.clone(),
        stderr_trunc.clone(),
    ));

    // 后台线程轮询内存峰值
    let (mem_tx, mem_rx) = std::sync::mpsc::channel::<u64>();
    let exit_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let exit_flag_clone = exit_flag.clone();

    // Drop guard: future 被 cancel 时设置 exit_flag，避免轮询线程泄漏
    struct ExitFlagGuard(std::sync::Arc<std::sync::atomic::AtomicBool>);
    impl Drop for ExitFlagGuard {
        fn drop(&mut self) {
            self.0.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }
    let _guard = ExitFlagGuard(exit_flag.clone());

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
    let exit_status_result = if let Some(cancel_token) = cancel_token {
        tokio::select! {
            status = child.wait() => {
                Some(status)
            }
            _ = tokio::time::sleep(timeout) => {
                terminate_job(h_job.0);
                let _ = child.start_kill();
                let _ = child.wait().await;
                killed_by = Some(KillReason::Timeout);
                None
            }
            _ = cancel_token.cancelled() => {
                terminate_job(h_job.0);
                let _ = child.start_kill();
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
                let _ = child.start_kill();
                let _ = child.wait().await;
                killed_by = Some(KillReason::Timeout);
                None
            }
        }
    };

    // 通知内存轮询线程退出并收集结果
    exit_flag.store(true, std::sync::atomic::Ordering::Relaxed);
    let max_rss_kb = mem_rx.recv().unwrap_or(0);

    // 等输出读取任务结束
    // 超时保护：进程被杀后其子进程可能仍持有管道句柄，导致 task 无法读到 EOF
    // 超时后从共享缓冲区获取已读数据，而非丢弃
    let _ = tokio::time::timeout(Duration::from_millis(500), stdout_task).await;
    let (stdout_bytes, stdout_trunc_v) = {
        let mut state = stdout_buf.lock().unwrap();
        (
            std::mem::take(&mut *state),
            stdout_trunc.load(std::sync::atomic::Ordering::Relaxed),
        )
    };
    let _ = tokio::time::timeout(Duration::from_millis(500), stderr_task).await;
    let (stderr_bytes, stderr_trunc_v) = {
        let mut state = stderr_buf.lock().unwrap();
        (
            std::mem::take(&mut *state),
            stderr_trunc.load(std::sync::atomic::Ordering::Relaxed),
        )
    };

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

    // 采集 CPU 时间（child 尚未 drop，raw_handle 仍有效）
    let cpu_ms = child
        .raw_handle()
        .map(|h| query_process_cpu_ms(h as isize))
        .unwrap_or(0);

    // h_job 在函数返回时由 SendHandle::Drop 自动关闭（KILL_ON_JOB_CLOSE 确保子进程已被杀）

    Ok(RunOutput {
        exit_code,
        stdout: stdout_bytes,
        stderr: stderr_bytes,
        duration_ms: start.elapsed().as_millis() as u64,
        cpu_ms,
        killed_by,
        truncated: stdout_trunc_v || stderr_trunc_v,
        max_rss_kb,
        job_object_degraded,
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
impl Drop for SendHandle {
    fn drop(&mut self) {
        // KILL_ON_JOB_CLOSE 确保句柄关闭时杀掉 JobObject 内所有子进程
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

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
/// 返回 true 表示成功加入（CPU 时间限制生效）；
/// 返回 false 表示降级（AssignProcessToJobObject 失败，仅墙钟超时可用）。
fn assign_process_to_job(h_job: HANDLE, pid: u32) -> Result<bool, AppError> {
    use windows::Win32::System::Threading::OpenProcess;
    use windows::Win32::System::Threading::PROCESS_SET_QUOTA;

    unsafe {
        let h_process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_QUERY_INFORMATION, false, pid)
            .map_err(|e| AppError::Other {
                detail: format!("OpenProcess({pid}) 失败: {e}"),
            })?;

        // AssignProcessToJobObject 在某些环境（如 GitHub Actions runner 运行在
        // 父 JobObject 中且不允许 breakaway）会返回 ERROR_ACCESS_DENIED。
        // 此时 CPU 时间限制失效，但墙钟超时仍能防死循环，足够教学场景使用。
        // 普通用户机器（不处于 JobObject 中）不受影响，CPU 限制正常。
        let degraded = if let Err(e) = AssignProcessToJobObject(h_job, h_process) {
            eprintln!("警告: AssignProcessToJobObject 失败 ({e}), CPU 限制将不生效");
            true // 降级
        } else {
            false
        };

        let _ = CloseHandle(h_process);
        Ok(degraded)
    }
}

/// 终止 JobObject 内所有进程
fn terminate_job(h_job: HANDLE) {
    unsafe {
        let _ = TerminateJobObject(h_job, 1);
    }
}

/// 查询进程内存峰值（KB）
pub fn query_process_rss_kb(pid: u32) -> Option<u64> {
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

/// 查询指定进程的 CPU 时间（用户态+内核态，ms）。
/// 用 GetProcessTimes 读取。进程已退出但 handle 未关闭时仍可读取。
fn query_process_cpu_ms(handle: isize) -> u64 {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::GetProcessTimes;

    let mut creation: FILETIME = unsafe { std::mem::zeroed() };
    let mut exit: FILETIME = unsafe { std::mem::zeroed() };
    let mut kernel: FILETIME = unsafe { std::mem::zeroed() };
    let mut user: FILETIME = unsafe { std::mem::zeroed() };

    unsafe {
        if GetProcessTimes(
            HANDLE(handle as *mut std::ffi::c_void),
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
        .is_ok()
        {
            // FILETIME 是 100ns 单位，转 ms
            let kernel_100ns = *(std::ptr::addr_of!(kernel).cast::<u64>());
            let user_100ns = *(std::ptr::addr_of!(user).cast::<u64>());
            (kernel_100ns + user_100ns) / 10_000
        } else {
            0
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

    /// 直接调用 ping.exe（避免 cmd /c 中间层的 quoting 问题）
    fn ping_cmd() -> Vec<String> {
        vec!["ping".into(), "-n".into(), "30".into(), "127.0.0.1".into()]
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
            ping_cmd(),
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
        let cancel_token = CancellationToken::new();
        let token_clone = cancel_token.clone();
        let handle = tokio::spawn(async move {
            run_with_limits(
                ping_cmd(),
                PathBuf::from(".").as_path(),
                None,
                Duration::from_secs(30),
                limits(),
                Some(token_clone),
            )
            .await
        });

        // 200ms 后取消
        tokio::time::sleep(Duration::from_millis(200)).await;
        cancel_token.cancel();

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
