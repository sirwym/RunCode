// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
fn setup_console_utf8() {
    use windows::Win32::System::Console::{SetConsoleCP, SetConsoleOutputCP, CP_UTF8};
    // 设置进程控制台代码页为 UTF-8，使后续 ConPTY 创建的伪控制台使用 UTF-8。
    // GUI 子系统下可能无附加控制台（返回错误），但进程级代码页设置仍会被
    // ConPTY 的 CreatePseudoConsole 继承。忽略错误，不影响主流程。
    unsafe {
        let _ = SetConsoleOutputCP(CP_UTF8);
        let _ = SetConsoleCP(CP_UTF8);
    }
}

#[cfg(not(windows))]
fn setup_console_utf8() {}

fn main() {
    setup_console_utf8();
    tauri_app_lib::run()
}
