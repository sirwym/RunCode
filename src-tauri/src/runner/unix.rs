use std::io;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use libc::{kill, rlimit, setrlimit};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::runner::executor::{KillReason, RunOutput};
use crate::runner::limits::ResourceLimits;
use crate::runner::output::{read_until_limit, MAX_OUTPUT_BYTES};

// macOS: proc_pid_rusage FFI 声明（libproc）
// RUSAGE_INFO_0 = 0，返回 rusage_info_v0 结构，含 ri_resident_size（当前常驻字节数）
// proc_pid_rusage 返回当前快照非峰值，需轮询取 max
#[cfg(target_os = "macos")]
mod proc_rusage {
    // rusage_info_v0 完整布局（来自 macOS SDK <sys/resource.h>）：
    // 总大小 96 字节 = 16 (uuid) + 10 * 8 (u64 字段)
    #[repr(C)]
    pub struct RusageInfoV0 {
        ri_uuid: [u8; 16],
        ri_user_time: u64,
        ri_system_time: u64,
        ri_pkg_idle_wkups: u64,
        ri_interrupt_wkups: u64,
        ri_pageins: u64,
        ri_wired_size: u64,
        pub ri_resident_size: u64, // 当前常驻内存（字节），偏移 64
        ri_phys_footprint: u64,
        ri_proc_start_abstime: u64,
        ri_proc_exit_abstime: u64,
    }

    extern "C" {
        fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut RusageInfoV0) -> i32;
    }

    pub const RUSAGE_INFO_0: i32 = 0;

    /// 查询指定 PID 的当前常驻内存（字节），失败返回 None
    pub fn query_pid_resident_bytes(pid: i32) -> Option<u64> {
        unsafe {
            let mut info: RusageInfoV0 = std::mem::zeroed();
            if proc_pid_rusage(pid, RUSAGE_INFO_0, &mut info) == 0 {
                Some(info.ri_resident_size)
            } else {
                None
            }
        }
    }
}

/// 杀整个进程组（负号 PGID）
fn kill_process_group(pgid: i32) {
    // 信号量为 0 表示无信号，仅检查；这里用 SIGKILL
    unsafe { kill(-pgid, libc::SIGKILL) };
}

/// 读取 RUSAGE_CHILDREN 的 ru_maxrss（累计值），统一返回 KB。
/// macOS ru_maxrss 单位是字节，需 / 1024；Linux 已是 KB。
pub fn get_children_rusage_max_rss_kb() -> u64 {
    unsafe {
        let mut ru: libc::rusage = std::mem::zeroed();
        if libc::getrusage(libc::RUSAGE_CHILDREN, &mut ru) == 0 {
            #[cfg(target_os = "macos")]
            {
                (ru.ru_maxrss as u64) / 1024
            }
            #[cfg(target_os = "linux")]
            {
                ru.ru_maxrss as u64
            }
            #[cfg(not(any(target_os = "macos", target_os = "linux")))]
            {
                0
            }
        } else {
            0
        }
    }
}

/// 查询指定 PID 的当前 RSS（KB）。
/// macOS 用 proc_pid_rusage（精确到具体 PID）；
/// Linux 无此 API，返回 None（由现有 RUSAGE_CHILDREN 差值法兜底）。
#[cfg(target_os = "macos")]
pub fn query_proc_pid_rss_kb(pid: i32) -> Option<u64> {
    proc_rusage::query_pid_resident_bytes(pid).map(|b| b / 1024)
}

/// 等待子进程退出并采集 max_rss_kb。
/// - macOS: 轮询 proc_pid_rusage 取 ri_resident_size 的最大值（精确到具体 PID）
/// - Linux/其他 Unix: 保留 RUSAGE_CHILDREN 差值法（已知不可靠，Linux 不在正式支持范围）
/// 返回 (exit_status_result, max_rss_kb)
async fn wait_with_rusage(
    child: &mut tokio::process::Child,
) -> (io::Result<std::process::ExitStatus>, u64) {
    #[cfg(target_os = "macos")]
    {
        wait_with_rusage_macos(child).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let baseline = get_children_rusage_max_rss_kb();
        let status = child.wait().await;
        let after = get_children_rusage_max_rss_kb();
        let max_rss_kb = if after > baseline {
            after - baseline
        } else {
            0
        };
        (status, max_rss_kb)
    }
}

/// macOS 轮询实现：仿 windows.rs 的 channel + AtomicBool 模式。
/// 100ms 轮询 proc_pid_rusage，wait 后再查一次（趁 zombie 还在）。
/// Drop guard 确保 future 被 cancel（超时/取消分支触发）时轮询线程不会泄漏。
#[cfg(target_os = "macos")]
async fn wait_with_rusage_macos(
    child: &mut tokio::process::Child,
) -> (io::Result<std::process::ExitStatus>, u64) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;

    // child.id() 在 run_with_limits 调用前已确保 Some（见 spawn 后 pid 获取与检查）
    let pid = child.id().unwrap_or(0) as i32;
    let (mem_tx, mem_rx) = mpsc::channel::<u64>();
    let exit_flag = std::sync::Arc::new(AtomicBool::new(false));
    let exit_flag_clone = exit_flag.clone();

    // Drop guard: future 被 cancel 时设置 exit_flag，避免轮询线程泄漏
    struct ExitFlagGuard(std::sync::Arc<AtomicBool>);
    impl Drop for ExitFlagGuard {
        fn drop(&mut self) {
            self.0.store(true, Ordering::Relaxed);
        }
    }
    let _guard = ExitFlagGuard(exit_flag.clone());

    std::thread::spawn(move || {
        let mut max_rss = 0u64;
        while !exit_flag_clone.load(Ordering::Relaxed) {
            if let Some(rss) = query_proc_pid_rss_kb(pid) {
                if rss > max_rss {
                    max_rss = rss;
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        // 进程退出后（zombie 状态）再查一次最终峰值
        if let Some(rss) = query_proc_pid_rss_kb(pid) {
            if rss > max_rss {
                max_rss = rss;
            }
        }
        let _ = mem_tx.send(max_rss);
    });

    let status = child.wait().await;
    exit_flag.store(true, Ordering::Relaxed);
    let max_rss_kb = mem_rx.recv().unwrap_or(0);
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
    let fsize_bytes = limits
        .fsize_mb
        .checked_mul(1024 * 1024)
        .unwrap_or(u64::MAX);
    set(libc::RLIMIT_FSIZE, fsize_bytes, fsize_bytes)?;
    Ok(())
}

/// 带资源限制、超时与取消的执行核心（Unix 实现）。
///
/// - 用 `process_group(0)` 让子进程成为独立进程组组长
/// - 在 `pre_exec` 中调 `setrlimit` 设置 CPU/文件大小限制
/// - `tokio::select!` 三路竞速：子进程结束 / 墙钟超时 / 外部取消
/// - 超时或取消后用 `kill(-PGID, SIGKILL)` 杀整个进程组，杜绝残留
/// - stdout/stderr 各按 8KB 块读取，累计 1MB 截断
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
        .ok_or_else(|| AppError::ProcessGroup {
            detail: "无法获取子进程 PID".into(),
        })?;
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
    let mut max_rss_kb: u64 = 0;
    let exit_status_result = if let Some(cancel_token) = cancel_token {
        tokio::select! {
            (status, rss) = wait_with_rusage(&mut child) => {
                max_rss_kb = rss;
                Some(status)
            }
            _ = tokio::time::sleep(timeout) => {
                // macOS: 杀进程前单次查询内存快照（近似峰值，轮询线程由 Drop guard 清理）
                #[cfg(target_os = "macos")]
                {
                    if let Some(rss) = query_proc_pid_rss_kb(pgid) {
                        max_rss_kb = rss;
                    }
                }
                kill_process_group(pgid);
                let _ = child.wait().await;
                killed_by = Some(KillReason::Timeout);
                None
            }
            _ = cancel_token.cancelled() => {
                #[cfg(target_os = "macos")]
                {
                    if let Some(rss) = query_proc_pid_rss_kb(pgid) {
                        max_rss_kb = rss;
                    }
                }
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
                max_rss_kb = rss;
                Some(status)
            }
            _ = tokio::time::sleep(timeout) => {
                #[cfg(target_os = "macos")]
                {
                    if let Some(rss) = query_proc_pid_rss_kb(pgid) {
                        max_rss_kb = rss;
                    }
                }
                kill_process_group(pgid);
                let _ = child.wait().await;
                killed_by = Some(KillReason::Timeout);
                None
            }
        }
    };

    // 等输出读取任务结束
    // 超时保护：进程被杀后其子进程可能仍持有管道句柄，导致 task 无法读到 EOF，
    // 对齐 Windows 实现的 500ms 超时
    let (stdout_bytes, stdout_trunc) = match tokio::time::timeout(
        Duration::from_millis(500),
        stdout_task,
    )
    .await
    {
        Ok(Ok(r)) => r?,
        _ => (Vec::new(), false),
    };
    let (stderr_bytes, stderr_trunc) = match tokio::time::timeout(
        Duration::from_millis(500),
        stderr_task,
    )
    .await
    {
        Ok(Ok(r)) => r?,
        _ => (Vec::new(), false),
    };

    // 解析退出码与被信号杀死的情况
    let exit_code = match exit_status_result {
        Some(Ok(status)) => status.code(),
        Some(Err(_)) => None,
        None => None,
    };

    // 如果尚未标记原因，但进程被信号杀死，标记为 Signal
    if killed_by.is_none() {
        if let Some(Ok(status)) = exit_status_result {
            use std::os::unix::process::ExitStatusExt;
            if status.signal().is_some() {
                killed_by = Some(KillReason::Signal);
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
        max_rss_kb,
        job_object_degraded: false,
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

    #[cfg(target_os = "macos")]
    #[test]
    fn debug_proc_pid_rusage() {
        // 调试: 验证 proc_pid_rusage 对当前进程能返回非零 RSS
        let pid = std::process::id() as i32;

        // 用 getrusage(RUSAGE_SELF) 对比
        let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
        unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut ru); }
        eprintln!("RUSAGE_SELF ru_maxrss={} (bytes)", ru.ru_maxrss);

        // 用 proc_rusage 模块的封装查询
        let bytes = proc_rusage::query_pid_resident_bytes(pid);
        eprintln!("proc_rusage::query_pid_resident_bytes: {:?} bytes", bytes);

        let result = query_proc_pid_rss_kb(pid);
        eprintln!("query_proc_pid_rss_kb: {:?} KB", result);
        assert!(result.unwrap_or(0) > 0, "proc_pid_rusage 应返回非零 RSS");
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
        // macOS: 直接运行 perl 分配 100MB（perl 是单进程，内存不被 bash 子进程隔离），
        // proc_pid_rusage 按 PID 轮询可可靠采集到峰值。
        // 其他平台: 用 bash_cmd 验证基本完成。
        #[cfg(target_os = "macos")]
    let cmd: Vec<String> = vec![
            "/usr/bin/perl".into(),
            "-e".into(),
            // perl 的 sleep 只接受整数秒，sleep 0.2 会被截断为 0 立即返回。
            // 用 select(undef,undef,undef,0.5) 实现 0.5 秒 fractional sleep，
            // 给轮询线程（100ms 间隔）足够时间采集到峰值。
            "my $x = 'x' x 104857600; select(undef,undef,undef,0.5)".into(),
        ];
        #[cfg(not(target_os = "macos"))]
        let cmd: Vec<String> = bash_cmd("echo hello; sleep 0.05");

        let out = run_with_limits(
            cmd,
            PathBuf::from("/tmp").as_path(),
            None,
            Duration::from_secs(5),
            limits(),
            None,
        )
        .await
        .unwrap();

        assert_eq!(out.exit_code, Some(0));
        assert!(out.killed_by.is_none());
        // macOS: proc_pid_rusage 按 PID 轮询，可可靠采集到峰值
        #[cfg(target_os = "macos")]
        assert!(
            out.max_rss_kb > 50_000,
            "macOS 应采集到 >50MB,实际 {}KB",
            out.max_rss_kb
        );
    }

    #[tokio::test]
    async fn timeout_captures_max_rss() {
        // macOS: perl 分配 100MB 后死循环，超时被杀前单次查询采集到内存快照。
        // 验证超时分支的 macOS 单次查询能采集到内存（覆盖超时杀进程时序）。
        #[cfg(target_os = "macos")]
        let cmd: Vec<String> = vec![
            "/usr/bin/perl".into(),
            "-e".into(),
            "my $x = 'x' x 104857600; while(1) {}".into(),
        ];
        #[cfg(not(target_os = "macos"))]
        let cmd: Vec<String> = bash_cmd("sleep 30");

        let out = run_with_limits(
            cmd,
            PathBuf::from("/tmp").as_path(),
            None,
            Duration::from_millis(800),
            ResourceLimits {
                cpu_secs: 10,
                fsize_mb: 50,
            },
            None,
        )
        .await
        .unwrap();

        assert!(
            matches!(out.killed_by, Some(KillReason::Timeout)),
            "应被超时杀死，实际 {:?}",
            out.killed_by
        );
        #[cfg(target_os = "macos")]
        assert!(
            out.max_rss_kb > 50_000,
            "macOS 超时杀进程也应采集到 >50MB,实际 {}KB",
            out.max_rss_kb
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

        assert!(
            out.duration_ms < 2000,
            "应在 2s 内返回，实际 {}ms",
            out.duration_ms
        );
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

        assert!(
            out.duration_ms < 3000,
            "应在 3s 内被 CPU 限制杀死，实际 {}ms",
            out.duration_ms
        );
        assert!(
            matches!(out.killed_by, Some(KillReason::Signal)),
            "应被信号杀死，实际 {:?}",
            out.killed_by
        );
    }

    #[tokio::test]
    async fn cancel_kills_process() {
        let cancel_token = CancellationToken::new();
        let token_clone = cancel_token.clone();
        let handle = tokio::spawn(async move {
            run_with_limits(
                bash_cmd("sleep 30"),
                PathBuf::from("/tmp").as_path(),
                None,
                Duration::from_secs(30),
                limits(),
                Some(token_clone),
            )
            .await
        });

        // 200ms 后取消
        tokio::time::sleep(Duration::from_millis(200)).await;
        cancel_token.cancel(); // 触发 cancelled() → 取消分支

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
