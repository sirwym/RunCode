use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

use crate::commands::compile_run::{compile_only, load_config, CompileScenario};
use crate::error::AppError;
use crate::pty::{PtyManager, PtySession};
use crate::run_manager::{RunKind, RunManager};

/// PTY 输出累计上限（50MB）。超过此上限视为异常输出（如死循环 printf），
/// 自动 kill 子进程并 emit pty_exit(killed_by="output_limit")，
/// 防止前端 xterm 缓冲无限增长导致 UI 卡死。
const MAX_PTY_OUTPUT_BYTES: u64 = 50 * 1024 * 1024;

/// PTY 输出事件（推送到前端）
#[derive(Serialize, Clone)]
struct PtyOutputEvent {
    run_id: String,
    /// PTY 输出数据（lossy utf8，ANSI 转义序列为 ASCII 不会丢失）
    data: String,
}

/// PTY 退出事件（推送到前端）
#[derive(Serialize, Clone)]
struct PtyExitEvent {
    run_id: String,
    exit_code: Option<i32>,
    /// "cancelled" / "signal" / "output_limit" / null（PTY 无墙钟超时）
    killed_by: Option<&'static str>,
    /// 进程内存峰值（KB），无法获取时为 0
    max_rss_kb: u64,
}

/// 根据输出超限标志与信号状态判定 kill 原因（纯函数，便于单测）
/// - output_limit 优先于 signal：输出超限时读取线程主动 kill，可能附带信号
/// - signal 非空且非空字符串才视为信号终止（如 SIGSEGV/SIGABRT）
fn determine_kill_reason(output_limit: bool, signal: Option<&str>) -> Option<&'static str> {
    if output_limit {
        Some("output_limit")
    } else if signal.filter(|s| !s.is_empty()).is_some() {
        Some("signal")
    } else {
        None
    }
}

/// 从字节切片末尾向前查找最后一个完整 UTF-8 字符的结束位置。
///
/// 返回 split_pos，使得：
/// - `&bytes[..split_pos]` 全部是完整的 UTF-8 字符（可安全 from_utf8_lossy）
/// - `&bytes[split_pos..]` 是末尾可能不完整的 UTF-8 起始字节（最多 4 字节，需保留到下次 read 拼接）
///
/// UTF-8 字符结构：
/// - 0xxxxxxx                   (1 字节, ASCII)
/// - 110xxxxx 10xxxxxx          (2 字节)
/// - 1110xxxx 10xxxxxx 10xxxxxx (3 字节)
/// - 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx (4 字节)
///
/// 起始字节：`(b & 0xC0) != 0x80`；续接字节：`(b & 0xC0) == 0x80`
fn find_valid_utf8_boundary(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        return 0;
    }
    // UTF-8 字符最长 4 字节，从末尾最多向前看 4 字节
    let scan_start = bytes.len().saturating_sub(4);
    for i in (scan_start..bytes.len()).rev() {
        let b = bytes[i];
        // 跳过续接字节，找起始字节
        if (b & 0xC0) == 0x80 {
            continue;
        }
        // 计算该字符预期长度
        let expected_len = if b < 0x80 {
            1
        } else if b < 0xE0 {
            2
        } else if b < 0xF0 {
            3
        } else {
            4
        };
        let remaining = bytes.len() - i;
        if remaining >= expected_len {
            // 该字符完整，全部数据有效
            return bytes.len();
        } else {
            // 该字符不完整，从该字节之前截断（保留该字节及之后作为 pending）
            return i;
        }
    }
    // 扫描范围内全是续接字节（理论上不该发生，防御性返回 0）
    0
}

/// start_pty_run 的返回值。
/// 编译失败时不 emit pty_exit，直接通过结构化结果返回 stderr，
/// 避免前端 invoke 返回前 listen 未注册导致事件丢失。
#[derive(Serialize, Clone)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum StartPtyResult {
    /// 编译成功，PTY 已创建，后续输出/退出通过 pty_output / pty_exit 事件推送。
    /// compile_stderr 可能含编译警告，前端在 PTY 交互输出前显示（不阻止程序启动）。
    Success {
        run_id: String,
        compile_stdout: String,
        compile_stderr: String,
    },
    /// 编译失败，前端直接拿 stderr 显示 + 解析错误行
    CompileFailed { run_id: String, stderr: String },
}

/// 限时等待 PTY 读取线程结束，用于在 emit pty_exit 前排空 master 缓冲区剩余输出。
///
/// 不能用无条件 join()：Windows ConPTY 在子进程退出后不向 master 返回 EOF，
/// 读取线程会阻塞在 read() 上直到 PTY master 被 drop。直接 join 会永久阻塞，
/// 导致 pty_exit 永不发出、前端停止按钮卡在"运行中"。
///
/// 用 is_finished() 轮询 + 超时：
/// - 读取线程在超时内退出（Unix：子进程退出后 read 返回 EOF）→ 返回 true，调用方 join；
/// - 超时未退出（Windows：reader 阻塞在 read）→ 返回 false，调用方跳过 join，继续 emit +
///   清理；清理时 drop master 会让读取线程以错误退出（read 返回 Err → break，不会再 emit）。
fn drain_reader_with_timeout(handle: &std::thread::JoinHandle<()>, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if handle.is_finished() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// 启动 PTY 交互运行。
///
/// 流程：
/// 1. 注册 RunManager（单活动任务互斥）
/// 2. 编译代码（编译阶段可取消）
/// 3. 编译失败 → 返回 CompileFailed（不 emit 事件，避免时序竞态）
/// 4. 编译成功 → 创建 PTY，spawn 子进程
/// 5. 读取线程：循环读 PTY master → emit pty_output，累计 50MB 上限超限触发 kill
/// 6. 等待线程：child.wait() → emit pty_exit + 清理 RunManager/PtyManager
///
/// RAII guard 保证任何 ? 提前返回（包括 load_config 失败）都自动 complete 会话。
#[tauri::command]
pub async fn start_pty_run(
    code: String,
    run_id: String,
    app: AppHandle,
    run_manager: State<'_, RunManager>,
    pty_manager: State<'_, PtyManager>,
) -> Result<StartPtyResult, AppError> {
    // 1. 注册 RunManager（使用前端传入的 run_id，与 compile_run/test_runner 对齐）
    let cancel_token = run_manager
        .register_with_id(run_id.clone(), RunKind::Interactive)
        .map_err(|e| AppError::Other { detail: e })?;

    // 2. RAII guard：任何 ? 提前返回都保证 complete 执行
    //    Success 分支由等待线程负责 complete，guard.active=false 避免重复；
    //    CompileFailed 分支由 inner 内部 complete，guard.active=false；
    //    Err 路径由 guard.Drop 兜底 complete。
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
    let mut guard = RunGuard {
        manager: &run_manager,
        run_id: run_id.clone(),
        active: true,
    };

    let result = start_pty_run_inner(code, run_id.clone(), cancel_token, &app, &pty_manager).await;
    // Success：等待线程负责 complete，禁用 guard
    // CompileFailed：inner 已 complete，禁用 guard
    // Err：guard.Drop 会 complete
    if result.is_ok() {
        guard.active = false;
    }
    drop(guard);
    result
}

/// 生成 Windows chcp 65001 包装命令字符串（纯函数，便于单测）。
///
/// 不对 exe_path 加内层双引号：portable_pty 会为含空格的参数加外层引号，
/// 若内层也有引号则 cmd.exe 的 /c 引号规则会与 \" 转义冲突，导致路径无法识别。
/// 不加内层引号时，portable_pty 加的外层引号被 cmd.exe 规则2剥离，
/// && 恢复为命令分隔符，exe_path 作为无空格的第三条命令直接执行。
/// TempDir 路径在 Windows 上使用 8.3 短名（如 ADMINI~1），不含空格。
#[cfg(windows)]
fn build_chcp_command_str(exe_path: &std::path::Path) -> String {
    format!("chcp 65001 >nul && {}", exe_path.display())
}

/// 构建 PTY 子进程启动命令。
///
/// Windows：用 `cmd /c "chcp 65001 >nul && exe_path"` 包装启动，
/// 确保子进程的 ConPTY 伪控制台使用 UTF-8(65001) 代码页，
/// 解决中文等非 ASCII 字符输出乱码问题。
/// macOS/Unix：直接启动 exe_path，无需代码页设置。
fn build_pty_command(exe_path: &std::path::Path) -> CommandBuilder {
    #[cfg(windows)]
    {
        let mut cmd = CommandBuilder::new("cmd");
        cmd.arg("/c");
        cmd.arg(build_chcp_command_str(exe_path));
        cmd
    }
    #[cfg(not(windows))]
    {
        CommandBuilder::new(exe_path)
    }
}

async fn start_pty_run_inner(
    code: String,
    run_id: String,
    cancel_token: CancellationToken,
    app: &AppHandle,
    pty_manager: &State<'_, PtyManager>,
) -> Result<StartPtyResult, AppError> {
    // 2. 编译（clone token 保留原 token 给读取线程的 50MB 上限触发）
    let (_settings, config, limits) = load_config(app)?;
    let work_dir = TempDir::new()?;

    let (exe_path, compile_stdout, compile_stderr) = match compile_only(
        &code,
        &config,
        CompileScenario::Run,
        work_dir.path(),
        limits,
        Some(cancel_token.clone()),
    )
    .await?
    {
        crate::commands::compile_run::CompileResult::Success { exe_path, stdout, stderr } => (exe_path, stdout, stderr),
        crate::commands::compile_run::CompileResult::Failed {
            stderr, ..
        } => {
            // 编译失败：不 emit pty_exit，直接返回结构化结果。
            // 前端 invoke 返回后即可拿到 stderr，无事件时序竞态。
            if let Some(rm) = app.try_state::<RunManager>() {
                rm.complete(&run_id);
            }
            return Ok(StartPtyResult::CompileFailed { run_id, stderr });
        }
    };

    // 3. 创建 PTY
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Other {
            detail: e.to_string(),
        })?;

    // 4. spawn 子进程
    let mut cmd = build_pty_command(&exe_path);
    cmd.cwd(work_dir.path());
    // 注入 UTF-8 环境变量，确保 Python 等运行时在 Windows 上正确输出 UTF-8。
    // C++ 程序不受影响（字面量编码由编译器决定，与运行时环境变量无关）。
    cmd.env("PYTHONUTF8", "1");
    cmd.env("PYTHONIOENCODING", "utf-8");
    let child = pair.slave.spawn_command(cmd).map_err(|e| AppError::Other {
        detail: e.to_string(),
    })?;
    // 取子进程 PID，用于 Unix 上 kill(-pid) 杀整个进程组（含孙进程）
    let pid = child.process_id();
    drop(pair.slave); // 释放 slave，master 持有唯一读端

    // 5. clone reader / take writer / clone killer
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::Other {
            detail: e.to_string(),
        })?;
    let writer = pair.master.take_writer().map_err(|e| AppError::Other {
        detail: e.to_string(),
    })?;
    let killer = child.clone_killer(); // clone_killer 直接返回，不是 Result

    // 6. 存入 PtyManager
    let session = PtySession::new(pair.master, writer, killer, pid, work_dir);
    pty_manager.insert(&run_id, session);

    // 7. 读取线程：blocking read → emit pty_output，累计 50MB 上限超限触发 kill
    // 跨线程共享"输出超限"标志：读取线程超限时 set，等待线程检测后改 emit killed_by
    let output_limit_triggered = Arc::new(AtomicBool::new(false));
    // 注册 cancelled 标志：stop_pty_run 设置后，等待线程跳过 emit，保证 pty_exit 单次 emit
    let cancelled_flag = pty_manager.register_cancelled_flag(&run_id);
    let app_reader = app.clone();
    let run_id_reader = run_id.clone();
    let output_limit_flag_reader = output_limit_triggered.clone();
    let reader_handle = std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut total_bytes: u64 = 0;
        // 保留上一次 read 末尾可能不完整的 UTF-8 字节（最多 4 字节），
        // 拼接到下次 read 的数据前再解码，避免多字节字符在 read 边界被 from_utf8_lossy 替换为 U+FFFD。
        let mut pending: Vec<u8> = Vec::with_capacity(4);
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    total_bytes += n as u64;
                    if total_bytes > MAX_PTY_OUTPUT_BYTES {
                        // 超限：标记并 kill 子进程，等待线程会 emit pty_exit(killed_by="output_limit")
                        output_limit_flag_reader.store(true, Ordering::Relaxed);
                        if let Some(pm) = app_reader.try_state::<PtyManager>() {
                            pm.kill(&run_id_reader);
                        }
                        break;
                    }

                    // 拼接 pending + 本次读取的数据
                    let mut chunk: Vec<u8> = std::mem::take(&mut pending);
                    chunk.extend_from_slice(&buf[..n]);

                    // 分离末尾不完整的 UTF-8 序列到 pending
                    let split_pos = find_valid_utf8_boundary(&chunk);
                    if split_pos < chunk.len() {
                        pending = chunk[split_pos..].to_vec();
                        chunk.truncate(split_pos);
                    }

                    if !chunk.is_empty() {
                        let data = String::from_utf8_lossy(&chunk).into_owned();
                        let _ = app_reader.emit(
                            "pty_output",
                            PtyOutputEvent {
                                run_id: run_id_reader.clone(),
                                data,
                            },
                        );
                    }
                }
                Err(_) => break,
            }
        }
        // EOF 后处理残留的 pending（无效字节，from_utf8_lossy 替换为 U+FFFD）
        if !pending.is_empty() {
            let data = String::from_utf8_lossy(&pending).into_owned();
            let _ = app_reader.emit(
                "pty_output",
                PtyOutputEvent {
                    run_id: run_id_reader.clone(),
                    data,
                },
            );
        }
    });

    // 8. 等待线程：child.wait() → 限时排空读取线程 → emit pty_exit + 清理
    // 不能无条件 join 读取线程：Windows ConPTY 子进程退出后不向 master 返回 EOF，
    // reader 会一直阻塞在 read()，直到 PtyManager.remove() drop master 才以错误退出。
    // 因此用 drain_reader_with_timeout 限时等待：超时则不再 join，直接 emit + 清理；
    // 清理时 drop master 会让残留读取线程自然退出。Unix 上 read 返回 EOF，读取线程
    // 会快速结束，轮询能立即检测到并 join，行为与原逻辑一致。
    let app_waiter = app.clone();
    let run_id_waiter = run_id.clone();
    let output_limit_flag_waiter = output_limit_triggered.clone();
    let cancelled_flag_waiter = cancelled_flag.clone();
    std::thread::spawn(move || {
        let mut child = child;

        // macOS：轮询 proc_pid_rusage 按 PID 采集内存峰值（与 Windows 模式一致）
        #[cfg(target_os = "macos")]
        let pid_macos = pid.unwrap_or(0) as i32;
        #[cfg(target_os = "macos")]
        let max_rss_arc = std::sync::Arc::new(std::sync::Mutex::new(0u64));
        #[cfg(target_os = "macos")]
        let stop_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        #[cfg(target_os = "macos")]
        {
            let max_rss_clone = max_rss_arc.clone();
            let stop_clone = stop_flag.clone();
            std::thread::spawn(move || {
                while !stop_clone.load(std::sync::atomic::Ordering::Relaxed) {
                    if let Some(rss) = crate::runner::executor::unix::query_proc_pid_rss_kb(pid_macos) {
                        if let Ok(mut m) = max_rss_clone.lock() {
                            if rss > *m {
                                *m = rss;
                            }
                        }
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                // 进程退出后再查一次（zombie 状态仍可查询）
                if let Some(rss) = crate::runner::executor::unix::query_proc_pid_rss_kb(pid_macos) {
                    if let Ok(mut m) = max_rss_clone.lock() {
                        if rss > *m {
                            *m = rss;
                        }
                    }
                }
            });
        }

        // Linux/其他 Unix：记录 baseline，wait 后查 after，差值即本次运行内存峰值
        #[cfg(all(unix, not(target_os = "macos")))]
        let baseline_rss = crate::runner::executor::unix::get_children_rusage_max_rss_kb();

        // Windows：轮询进程内存峰值（进程退出后 OpenProcess 会失败）
        #[cfg(windows)]
        let pid_waiter = pid;

        #[cfg(windows)]
        let max_rss_arc = std::sync::Arc::new(std::sync::Mutex::new(0u64));
        #[cfg(windows)]
        let stop_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        #[cfg(windows)]
        {
            let max_rss_clone = max_rss_arc.clone();
            let stop_clone = stop_flag.clone();
            std::thread::spawn(move || {
                while !stop_clone.load(std::sync::atomic::Ordering::Relaxed) {
                    if let Some(pid) = pid_waiter {
                        if let Some(rss) = crate::runner::executor::windows::query_process_rss_kb(pid) {
                            if let Ok(mut m) = max_rss_clone.lock() {
                                if rss > *m {
                                    *m = rss;
                                }
                            }
                        }
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            });
        }

        let wait_status = child.wait().ok();
        let exit_code = wait_status.as_ref().map(|s| s.exit_code() as i32);

        #[cfg(target_os = "macos")]
        {
            stop_flag.store(true, std::sync::atomic::Ordering::Relaxed);
            // 给轮询线程一点时间完成最后一次查询再读结果
            std::thread::sleep(Duration::from_millis(50));
        }

        #[cfg(windows)]
        {
            stop_flag.store(true, std::sync::atomic::Ordering::Relaxed);
            // 最后查一次（进程可能刚退出但句柄还活着）
            if let Some(pid) = pid_waiter {
                if let Some(rss) = crate::runner::executor::windows::query_process_rss_kb(pid) {
                    if let Ok(mut m) = max_rss_arc.lock() {
                        if rss > *m {
                            *m = rss;
                        }
                    }
                }
            }
        }

        #[cfg(target_os = "macos")]
        let max_rss_kb = max_rss_arc.lock().map(|m| *m).unwrap_or(0);
        #[cfg(all(unix, not(target_os = "macos")))]
        let max_rss_kb = {
            let after = crate::runner::executor::unix::get_children_rusage_max_rss_kb();
            after.saturating_sub(baseline_rss)
        };
        #[cfg(windows)]
        let max_rss_kb = max_rss_arc.lock().map(|m| *m).unwrap_or(0);
        #[cfg(not(any(unix, windows)))]
        let max_rss_kb: u64 = 0;

        // 限时排空读取线程（见 drain_reader_with_timeout 文档）
        if drain_reader_with_timeout(&reader_handle, Duration::from_millis(500)) {
            // reader 已自然退出（Unix EOF 或 ConPTY 已关闭）：join 确保所有 pty_output 已 emit
            let _ = reader_handle.join();
        } else {
            // Windows ConPTY: reader 阻塞在 read()，先 drop master 强制 reader 退出，
            // 再 join 确保 reader 的所有 pty_output 在 pty_exit 之前 emit 完毕。
            if let Some(pm) = app_waiter.try_state::<PtyManager>() {
                pm.remove(&run_id_waiter);
            }
            let _ = reader_handle.join();
        }

        // 检测 kill 原因：输出超限优先，其次信号终止（如 SIGSEGV 越界访问）
        let signal_name = wait_status.as_ref().and_then(|s| s.signal());
        let killed_by = determine_kill_reason(
            output_limit_flag_waiter.load(Ordering::Relaxed),
            signal_name,
        );

        // 若已被 stop_pty_run 取消，跳过 emit（stop_pty_run 已 emit 过 pty_exit）
        // 保证 pty_exit 单次 emit 语义，避免前端 onExit 被调用两次
        if !cancelled_flag_waiter.load(Ordering::Relaxed) {
            let _ = app_waiter.emit(
                "pty_exit",
                PtyExitEvent {
                    run_id: run_id_waiter.clone(),
                    exit_code,
                    killed_by,
                    max_rss_kb,
                },
            );
        }

        // 清理 RunManager + PtyManager（pm.remove 幂等：else 分支可能已 remove）
        if let Some(rm) = app_waiter.try_state::<RunManager>() {
            rm.complete(&run_id_waiter);
        }
        if let Some(pm) = app_waiter.try_state::<PtyManager>() {
            pm.remove(&run_id_waiter);
        }
    });

    Ok(StartPtyResult::Success {
        run_id,
        compile_stdout,
        compile_stderr,
    })
}

/// 向 PTY 写入 stdin（用户在终端中输入）
#[tauri::command]
pub async fn write_pty_stdin(
    run_id: String,
    data: String,
    pty_manager: State<'_, PtyManager>,
    app: AppHandle,
) -> Result<(), AppError> {
    pty_manager
        .write_stdin(&run_id, data.as_bytes())
        .map_err(|e| AppError::Other { detail: e })?;
    // 首次输入时通知前端重置 PTY 计时起点（只 emit 一次）
    if pty_manager.mark_first_input(&run_id) {
        let _ = app.emit("pty_first_input", &run_id);
    }
    Ok(())
}

/// 调整 PTY 大小
#[tauri::command]
pub async fn resize_pty(
    run_id: String,
    cols: u16,
    rows: u16,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), AppError> {
    pty_manager
        .resize(&run_id, cols, rows)
        .map_err(|e| AppError::Other { detail: e })
}

/// 停止 PTY 运行（用户点停止按钮）
#[tauri::command]
pub async fn stop_pty_run(
    run_id: String,
    app: AppHandle,
    run_manager: State<'_, RunManager>,
    pty_manager: State<'_, PtyManager>,
) -> Result<bool, AppError> {
    // 1. kill PTY 子进程
    pty_manager.kill(&run_id);
    // 2. cancel RunManager 会话
    let cancelled = run_manager.cancel(&run_id);
    // 3. 标记 cancelled：等待线程检测到此标志后跳过 emit，保证 pty_exit 单次 emit
    pty_manager.mark_cancelled(&run_id);
    // 4. 清理（等待线程也会清理，但这里是幂等的）
    run_manager.complete(&run_id);
    pty_manager.remove(&run_id);

    // 5. 通知前端 PTY 已退出（用户取消时不查内存，max_rss_kb=0）
    let _ = app.emit(
        "pty_exit",
        PtyExitEvent {
            run_id,
            exit_code: None,
            killed_by: Some("cancelled"),
            max_rss_kb: 0,
        },
    );

    Ok(cancelled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn build_chcp_command_str_simple_path() {
        let exe = std::path::Path::new(r"D:\code\a.exe");
        let cmd_str = build_chcp_command_str(exe);
        assert_eq!(cmd_str, r"chcp 65001 >nul && D:\code\a.exe");
    }

    #[cfg(windows)]
    #[test]
    fn build_chcp_command_str_no_inner_quotes() {
        // 不含内层引号：portable_pty 外层引号被 cmd.exe 剥离后，&& 恢复为分隔符
        let exe = std::path::Path::new(r"C:\Program Files\my app\test.exe");
        let cmd_str = build_chcp_command_str(exe);
        assert!(!cmd_str.contains("\""));
        assert_eq!(cmd_str, r"chcp 65001 >nul && C:\Program Files\my app\test.exe");
    }

    #[cfg(not(windows))]
    #[test]
    fn build_pty_command_unix_direct_launch() {
        let exe = std::path::Path::new("/tmp/program");
        let _cmd = build_pty_command(exe);
    }

    #[test]
    fn find_valid_utf8_boundary_empty() {
        assert_eq!(find_valid_utf8_boundary(&[]), 0);
    }

    #[test]
    fn find_valid_utf8_boundary_all_ascii() {
        assert_eq!(find_valid_utf8_boundary(b"hello"), 5);
    }

    #[test]
    fn find_valid_utf8_boundary_complete_multibyte() {
        // "中文" = E4 B8 AD E6 96 87（6 字节，完整）
        let bytes = [0xE4, 0xB8, 0xAD, 0xE6, 0x96, 0x87];
        assert_eq!(find_valid_utf8_boundary(&bytes), 6);
    }

    #[test]
    fn find_valid_utf8_boundary_truncated_3byte_char() {
        // "中" = E4 B8 AD，只保留前 2 字节 E4 B8
        let bytes = [0xE4, 0xB8];
        assert_eq!(find_valid_utf8_boundary(&bytes), 0);
    }

    #[test]
    fn find_valid_utf8_boundary_mixed_ascii_and_truncated() {
        // "abc" + "中"的前2字节 = 61 62 63 E4 B8
        let bytes = [0x61, 0x62, 0x63, 0xE4, 0xB8];
        assert_eq!(find_valid_utf8_boundary(&bytes), 3);
    }

    #[test]
    fn find_valid_utf8_boundary_truncated_4byte_char() {
        // 4字节字符 F0 90 8C 88，只保留前 2 字节
        let bytes = [0xF0, 0x90];
        assert_eq!(find_valid_utf8_boundary(&bytes), 0);
    }

    #[test]
    fn find_valid_utf8_boundary_complete_then_truncated() {
        // 完整 "中"(E4 B8 AD) + 不完整的 "文"(E6 96)
        let bytes = [0xE4, 0xB8, 0xAD, 0xE6, 0x96];
        assert_eq!(find_valid_utf8_boundary(&bytes), 3);
    }

    #[test]
    fn drain_reader_returns_true_when_thread_finishes_within_timeout() {
        let handle = std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(20));
        });
        assert!(drain_reader_with_timeout(&handle, Duration::from_millis(500)));
        let _ = handle.join();
    }

    #[test]
    fn drain_reader_returns_false_when_thread_outlives_timeout() {
        let handle = std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(500));
        });
        assert!(!drain_reader_with_timeout(&handle, Duration::from_millis(100)));
    }

    #[test]
    fn start_pty_result_success_serializes_with_tag() {
        let r = StartPtyResult::Success {
            run_id: "abc".into(),
            compile_stdout: "out".into(),
            compile_stderr: "warn".into(),
        };
        let json = serde_json::to_string(&r).unwrap();
        assert_eq!(json, r#"{"status":"success","run_id":"abc","compile_stdout":"out","compile_stderr":"warn"}"#);
    }

    #[test]
    fn start_pty_result_compile_failed_serializes_with_tag() {
        let r = StartPtyResult::CompileFailed { run_id: "abc".into(), stderr: "e".into() };
        let json = serde_json::to_string(&r).unwrap();
        assert_eq!(json, r#"{"status":"compile_failed","run_id":"abc","stderr":"e"}"#);
    }

    #[test]
    fn determine_kill_reason_none_when_normal() {
        assert_eq!(determine_kill_reason(false, None), None);
    }

    #[test]
    fn determine_kill_reason_output_limit_takes_priority() {
        // 输出超限优先于信号（读取线程主动 kill 可能附带信号）
        assert_eq!(
            determine_kill_reason(true, Some("Segmentation fault")),
            Some("output_limit")
        );
    }

    #[test]
    fn determine_kill_reason_signal_when_no_output_limit() {
        assert_eq!(
            determine_kill_reason(false, Some("Segmentation fault")),
            Some("signal")
        );
        // 空字符串不算信号
        assert_eq!(determine_kill_reason(false, Some("")), None);
    }
}
