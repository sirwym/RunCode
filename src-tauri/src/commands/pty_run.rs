use std::io::Read;

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
    /// 编译失败时携带 stderr
    compile_stderr: Option<String>,
}

/// 启动 PTY 交互运行。
///
/// 流程：
/// 1. 注册 RunManager（单活动任务互斥）
/// 2. 编译代码（编译阶段可取消）
/// 3. 编译失败 → emit pty_exit + 清理
/// 4. 编译成功 → 创建 PTY，spawn 子进程
/// 5. 读取线程：循环读 PTY master → emit pty_output
/// 6. 等待线程：child.wait() → emit pty_exit + 清理 RunManager/PtyManager
#[tauri::command]
pub async fn start_pty_run(
    code: String,
    app: AppHandle,
    run_manager: State<'_, RunManager>,
    pty_manager: State<'_, PtyManager>,
) -> Result<String, AppError> {
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
            // 编译失败：通知前端 + 清理
            let _ = app.emit(
                "pty_exit",
                PtyExitEvent {
                    run_id: run_id.clone(),
                    exit_code: None,
                    killed_by: None,
                    compile_stderr: Some(stderr),
                },
            );
            run_manager.complete(&run_id);
            return Ok(run_id);
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
    std::thread::spawn(move || {
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

    // 8. 等待线程：child.wait() → emit pty_exit + 清理
    let app_waiter = app.clone();
    let run_id_waiter = run_id.clone();
    std::thread::spawn(move || {
        let mut child = child;
        let exit_code = child.wait().ok().map(|s| s.exit_code() as i32);

        let _ = app_waiter.emit(
            "pty_exit",
            PtyExitEvent {
                run_id: run_id_waiter.clone(),
                exit_code,
                killed_by: None,
                compile_stderr: None,
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

    Ok(run_id)
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
            compile_stderr: None,
        },
    );

    Ok(cancelled)
}
