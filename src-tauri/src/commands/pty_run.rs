use std::io::Read;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tempfile::TempDir;

use crate::commands::compile_run::{compile_only, load_config};
use crate::error::AppError;
use crate::pty::{PtyManager, PtySession};
use crate::run_manager::{RunKind, RunManager};

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
    /// "cancelled" / null（PTY 无墙钟超时）
    killed_by: Option<&'static str>,
}

/// start_pty_run 的返回值。
/// 编译失败时不 emit pty_exit，直接通过结构化结果返回 stderr，
/// 避免前端 invoke 返回前 listen 未注册导致事件丢失。
#[derive(Serialize, Clone)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum StartPtyResult {
    /// 编译成功，PTY 已创建，后续输出/退出通过 pty_output / pty_exit 事件推送
    Success { run_id: String },
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
/// 5. 读取线程：循环读 PTY master → emit pty_output
/// 6. 等待线程：child.wait() → emit pty_exit + 清理 RunManager/PtyManager
#[tauri::command]
pub async fn start_pty_run(
    code: String,
    app: AppHandle,
    run_manager: State<'_, RunManager>,
    pty_manager: State<'_, PtyManager>,
) -> Result<StartPtyResult, AppError> {
    // 1. 注册 RunManager
    let (run_id, cancel_rx) = run_manager
        .register(RunKind::Interactive)
        .map_err(|e| AppError::Other { detail: e })?;

    // 2. 编译
    let (_settings, config, limits) = load_config(&app)?;
    let work_dir = TempDir::new()?;

    let exe_path = match compile_only(&code, &config, work_dir.path(), limits, Some(cancel_rx)).await? {
        crate::commands::compile_run::CompileResult::Success(p) => p,
        crate::commands::compile_run::CompileResult::Failed {
            stderr, ..
        } => {
            // 编译失败：不 emit pty_exit，直接返回结构化结果。
            // 前端 invoke 返回后即可拿到 stderr，无事件时序竞态。
            run_manager.complete(&run_id);
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
    let mut cmd = CommandBuilder::new(&exe_path);
    cmd.cwd(work_dir.path());
    let child = pair.slave.spawn_command(cmd).map_err(|e| AppError::Other {
        detail: e.to_string(),
    })?;
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
    let session = PtySession::new(pair.master, writer, killer, work_dir);
    pty_manager.insert(&run_id, session);

    // 7. 读取线程：blocking read → emit pty_output
    let app_reader = app.clone();
    let run_id_reader = run_id.clone();
    let reader_handle = std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app_reader.emit(
                        "pty_output",
                        PtyOutputEvent {
                            run_id: run_id_reader.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
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
    std::thread::spawn(move || {
        let mut child = child;
        let exit_code = child.wait().ok().map(|s| s.exit_code() as i32);

        // 限时排空读取线程（见 drain_reader_with_timeout 文档）
        if drain_reader_with_timeout(&reader_handle, Duration::from_millis(500)) {
            let _ = reader_handle.join();
        }

        let _ = app_waiter.emit(
            "pty_exit",
            PtyExitEvent {
                run_id: run_id_waiter.clone(),
                exit_code,
                killed_by: None,
            },
        );

        // 清理 RunManager + PtyManager（通过 AppHandle 获取 State）
        if let Some(rm) = app_waiter.try_state::<RunManager>() {
            rm.complete(&run_id_waiter);
        }
        if let Some(pm) = app_waiter.try_state::<PtyManager>() {
            pm.remove(&run_id_waiter);
        }
    });

    Ok(StartPtyResult::Success { run_id })
}

/// 向 PTY 写入 stdin（用户在终端中输入）
#[tauri::command]
pub async fn write_pty_stdin(
    run_id: String,
    data: String,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), AppError> {
    pty_manager
        .write_stdin(&run_id, data.as_bytes())
        .map_err(|e| AppError::Other { detail: e })
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
    // 3. 清理（等待线程也会清理，但这里是幂等的）
    run_manager.complete(&run_id);
    pty_manager.remove(&run_id);

    // 4. 通知前端 PTY 已退出
    let _ = app.emit(
        "pty_exit",
        PtyExitEvent {
            run_id,
            exit_code: None,
            killed_by: Some("cancelled"),
        },
    );

    Ok(cancelled)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let r = StartPtyResult::Success { run_id: "abc".into() };
        let json = serde_json::to_string(&r).unwrap();
        assert_eq!(json, r#"{"status":"success","run_id":"abc"}"#);
    }

    #[test]
    fn start_pty_result_compile_failed_serializes_with_tag() {
        let r = StartPtyResult::CompileFailed { run_id: "abc".into(), stderr: "e".into() };
        let json = serde_json::to_string(&r).unwrap();
        assert_eq!(json, r#"{"status":"compile_failed","run_id":"abc","stderr":"e"}"#);
    }
}
