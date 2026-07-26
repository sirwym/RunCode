pub mod compile_run;
pub mod documents;
pub mod format_cmd;
pub mod import_cmd;
pub mod menu_cmd;
pub mod pty_run;
pub mod recent_cmd;
pub mod settings_cmd;
pub mod test_runner;
pub mod test_suite_cmd;

use crate::error::AppError;
use crate::run_manager::RunManager;
use tauri::State;

/// 停止当前运行中的任务。
///
/// 通过 RunManager.cancel() drop 取消信号 Sender，
/// 执行内核的 oneshot::Receiver 收到 Err 后触发取消分支，杀整个进程组。
#[tauri::command]
pub async fn stop_run(run_id: String, manager: State<'_, RunManager>) -> Result<bool, AppError> {
    Ok(manager.cancel(&run_id))
}

pub use compile_run::compile_and_run;
pub use documents::{open_file, save_file};
pub use format_cmd::format_code;
pub use import_cmd::import_test_cases;
pub use menu_cmd::update_view_menu_state;
pub use pty_run::{resize_pty, start_pty_run, stop_pty_run, write_pty_stdin};
pub use recent_cmd::{add_recent_file, clear_recent_files, get_recent_files, remove_recent_file};
pub use settings_cmd::{get_settings, save_settings};
pub use test_runner::run_tests;
pub use test_suite_cmd::{
    add_test_case, create_test_suite, delete_test_suite, find_or_create_suite_by_doc_path,
    get_all_case_previews, get_case_preview, load_test_suite, remove_test_case, update_test_case,
};
