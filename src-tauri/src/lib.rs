#![allow(dead_code)]
// tauri::command 宏在 Rust 1.94 下触发 never type fallback 兼容性警告
#![allow(dependency_on_unit_never_type_fallback)]

mod build_cache;
mod commands;
mod config;
mod error;
mod formatter;
mod importer;
mod parser;
mod pty;
mod recent_files;
mod run_manager;
mod runner;
mod settings;
mod test_suite;

use commands::{
    add_recent_file, add_test_case, check_syntax, clear_recent_files, compile_and_run, create_test_suite,
    delete_custom_theme_image, delete_test_suite, extract_code_symbols,
    find_or_create_suite_by_doc_path, format_code, generate_cfg, get_all_case_previews,
    get_case_full_expected, get_case_preview, get_custom_theme_image_path, get_recent_files,
    get_settings, import_test_cases, load_test_suite, open_file, read_file_bytes,
    remove_recent_file, remove_test_case, resize_pty, run_tests, save_custom_theme_image,
    save_file, save_settings, start_pty_run, stop_pty_run, stop_run, update_test_case,
    update_view_menu_state, write_pty_stdin,
};
use build_cache::BuildCache;
use pty::PtyManager;
use run_manager::RunManager;
#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewWindow};
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri_plugin_decoration::WebviewWindowExt;

/// 激活自定义标题栏（tauri-plugin-decoration）
/// Windows：创建 HTML 窗口控制按钮（含 Snap Layout）
/// macOS：设置红绿灯按钮位置
#[tauri::command]
fn activate_custom_titlebar(window: WebviewWindow) -> Result<(), String> {
    window
        .create_overlay_titlebar()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    window
        .set_traffic_lights_inset(16.0, 20.0)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 回退到原生标题栏（插件激活超时回退用）
#[tauri::command]
fn show_native_fallback(window: WebviewWindow) -> Result<(), String> {
    window
        .restore_native_titlebar()
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())
}

/// 切换开发人员工具（DevTools）
#[tauri::command]
fn toggle_devtools(window: WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

/// 支持通过"打开方式"打开的文件扩展名（与 tauri.conf.json fileAssociations 对齐）
const LAUNCH_EXTS: &[&str] = &["cpp", "cc", "cxx", "h", "hpp"];

/// 从命令行参数中解析首个匹配关联扩展名的文件路径（纯函数，便于单元测试）
/// 跳过 argv[0]（程序自身路径），返回首个以 LAUNCH_EXTS 结尾的参数
fn parse_launch_path(args: &[String]) -> Option<String> {
    for arg in args.iter().skip(1) {
        if let Some(ext) = std::path::Path::new(arg)
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_lowercase)
        {
            if LAUNCH_EXTS.contains(&ext.as_str()) {
                return Some(arg.clone());
            }
        }
    }
    None
}

/// 启动期/打开方式传入的待打开文件路径（全局静态，drain-once）
/// 用全局静态而非 managed state：macOS 冷启动时 RunEvent::Opened 早于 setup（managed state 尚不存在），
/// 必须用全局静态才能在 Opened 到达时写入。前端 mount 时通过 get_pending_open_file 拉取。
static STARTUP_FILE: Mutex<Option<String>> = Mutex::new(None);

/// 前端 mount 时拉取待打开文件（drain-once：取后清空，避免重复打开）
#[tauri::command]
fn get_pending_open_file() -> Option<String> {
    STARTUP_FILE.lock().ok().and_then(|mut g| g.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_decoration::init())
        .manage(RunManager::new())
        .manage(PtyManager::new())
        .invoke_handler(tauri::generate_handler![
            compile_and_run,
            run_tests,
            stop_run,
            open_file,
            save_file,
            start_pty_run,
            write_pty_stdin,
            resize_pty,
            stop_pty_run,
            create_test_suite,
            load_test_suite,
            add_test_case,
            update_test_case,
            remove_test_case,
            get_case_preview,
            get_all_case_previews,
            get_case_full_expected,
            delete_test_suite,
            find_or_create_suite_by_doc_path,
            import_test_cases,
            get_settings,
            save_settings,
            get_recent_files,
            add_recent_file,
            remove_recent_file,
            clear_recent_files,
            format_code,
            update_view_menu_state,
            extract_code_symbols,
            check_syntax,
            generate_cfg,
            read_file_bytes,
            save_custom_theme_image,
            delete_custom_theme_image,
            get_custom_theme_image_path,
            activate_custom_titlebar,
            show_native_fallback,
            toggle_devtools,
            get_pending_open_file,
        ])
        .setup(|app| {
            // 注册编译产物缓存（需 app_data_dir，所以放 setup 内）
            let cache_dir = app
                .path()
                .app_data_dir()
                .map(|p| p.join("build_cache"))
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())) as Box<dyn std::error::Error>)?;
            app.manage(BuildCache::new(cache_dir));

            // 注册 single-instance 插件：必须第一个，处理热启动时新实例 args 转发
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                    // 热启动（Windows/Linux 已运行实例时双击/打开方式）
                    if let Some(path) = parse_launch_path(&args) {
                        // 写入全局静态（兜底：前端尚未 mount 或事件丢失时仍可拉取）
                        if let Ok(mut g) = STARTUP_FILE.lock() {
                            *g = Some(path.clone());
                        }
                        let _ = app.emit("open-file", path);
                    }
                    // 聚焦主窗口
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_focus();
                    }
                }))?;
            }

            // 冷启动：读 argv（Windows/Linux），macOS 走 RunEvent::Opened（早于 setup，靠全局静态兜底）
            #[cfg(desktop)]
            {
                let args: Vec<String> = std::env::args().collect();
                if let Some(path) = parse_launch_path(&args) {
                    if let Ok(mut g) = STARTUP_FILE.lock() {
                        *g = Some(path);
                    }
                }
            }

            // macOS 保留原生系统菜单栏；Windows 移除原生菜单，用前端菜单栏替代
            #[cfg(target_os = "macos")]
            {
            // 应用菜单（RunCode）
            // macOS 专属菜单项（hide/hide_others/show_all）用 cfg 包裹
            let about = PredefinedMenuItem::about(
                app,
                Some("关于 RunCode"),
                Some(AboutMetadata {
                    version: Some("1.0.2".into()),
                    authors: Some(vec!["YuanMing".into()]),
                    website: Some("https://github.com/YuanMing/RunCode".into()),
                    copyright: Some("© 2026 YuanMing".into()),
                    license: Some("MIT".into()),
                    ..Default::default()
                }),
            )?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let settings_item = MenuItem::with_id(app, "settings", "设置…", true, Some("CmdOrCtrl+,"))?;
            let sep2 = PredefinedMenuItem::separator(app)?;

            #[cfg(target_os = "macos")]
            let macos_only_items = (
                PredefinedMenuItem::hide(app, None)?,
                PredefinedMenuItem::hide_others(app, None)?,
                PredefinedMenuItem::show_all(app, None)?,
                PredefinedMenuItem::separator(app)?,
            );
            #[cfg(target_os = "macos")]
            let quit_item = PredefinedMenuItem::quit(app, None)?;

            #[cfg(target_os = "macos")]
            let app_menu_items: [&dyn tauri::menu::IsMenuItem<tauri::Wry>; 9] = [
                &about, &sep1, &settings_item, &sep2,
                &macos_only_items.0, &macos_only_items.1, &macos_only_items.2, &macos_only_items.3,
                &quit_item,
            ];
            #[cfg(not(target_os = "macos"))]
            let quit_item = PredefinedMenuItem::quit(app, None)?;
            #[cfg(not(target_os = "macos"))]
            let app_menu_items: [&dyn tauri::menu::IsMenuItem<tauri::Wry>; 5] = [
                &about, &sep1, &settings_item, &sep2, &quit_item,
            ];
            let app_menu = Submenu::with_items(app, "RunCode", true, &app_menu_items)?;

            // 文件菜单
            let file_menu = Submenu::with_items(
                app,
                "文件",
                true,
                &[
                    &MenuItem::with_id(app, "file_new", "新建", true, Some("CmdOrCtrl+N"))?,
                    &MenuItem::with_id(app, "file_open", "打开…", true, Some("CmdOrCtrl+O"))?,
                    &MenuItem::with_id(app, "file_save", "保存", true, Some("CmdOrCtrl+S"))?,
                    &MenuItem::with_id(app, "file_save_as", "另存为…", true, Some("CmdOrCtrl+Shift+S"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "file_recent", "最近文件…", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "file_close", "关闭", true, Some("CmdOrCtrl+W"))?,
                    &MenuItem::with_id(app, "file_close_all", "关闭所有", true, Some("CmdOrCtrl+Shift+W"))?,
                ],
            )?;

            // 编辑菜单（含查找项，原"查找"顶级菜单已并入）
            // PredefinedMenuItem 保留原生行为和快捷键，仅显式传入中文标签
            let edit_menu = Submenu::with_items(
                app,
                "编辑",
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some("撤销"))?,
                    &PredefinedMenuItem::redo(app, Some("重做"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some("剪切"))?,
                    &PredefinedMenuItem::copy(app, Some("复制"))?,
                    &PredefinedMenuItem::paste(app, Some("粘贴"))?,
                    &PredefinedMenuItem::select_all(app, Some("全选"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "edit_format", "格式化", true, Some("Shift+Alt+F"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "find", "查找…", true, Some("CmdOrCtrl+F"))?,
                    &MenuItem::with_id(app, "find_next", "查找下一个", true, Some("CmdOrCtrl+G"))?,
                    &MenuItem::with_id(app, "find_prev", "查找上一个", true, Some("CmdOrCtrl+Shift+G"))?,
                    &MenuItem::with_id(app, "replace", "替换…", true, Some("CmdOrCtrl+Alt+F"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "goto_line", "跳转行…", true, Some("Ctrl+G"))?,
                ],
            )?;

            // 视图菜单
            let layout_horizontal = MenuItem::with_id(
                app,
                "layout_horizontal",
                "✓ 左右分栏",
                true,
                None::<&str>,
            )?;
            let layout_vertical = MenuItem::with_id(
                app,
                "layout_vertical",
                "  上下分栏",
                true,
                None::<&str>,
            )?;
            let auto_hide = CheckMenuItem::with_id(
                app,
                "auto_hide",
                "自动隐藏输出面板",
                true,
                false,
                None::<&str>,
            )?;
            // 给 layout_submenu 设置固定 ID，便于从 view_menu 中按 ID 查找
            let layout_submenu = Submenu::with_id_and_items(
                app,
                "layout_submenu",
                "布局方向",
                true,
                &[&layout_horizontal, &layout_vertical],
            )?;
            // 给 view_menu 设置固定 ID，便于从顶层 menu 中按 ID 查找
            let view_menu = Submenu::with_id_and_items(
                app,
                "view_menu",
                "视图",
                true,
                &[
                    &layout_submenu,
                    &PredefinedMenuItem::separator(app)?,
                    &auto_hide,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "font_inc", "放大字号", true, Some("CmdOrCtrl+="))?,
                    &MenuItem::with_id(app, "font_dec", "缩小字号", true, Some("CmdOrCtrl+-"))?,
                    &MenuItem::with_id(app, "font_reset", "重置字号", true, Some("CmdOrCtrl+0"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "toggle_panel", "隐藏/显示输出面板", true, Some("CmdOrCtrl+\\"))?,
                ],
            )?;

            // 窗口菜单
            let window_menu = Submenu::with_items(
                app,
                "窗口",
                true,
                &[&PredefinedMenuItem::minimize(app, None)?],
            )?;

            // 帮助菜单
            let help_menu = Submenu::with_items(
                app,
                "帮助",
                true,
                &[
                    &MenuItem::with_id(app, "help", "C++ 速查表", true, Some("CmdOrCtrl+Shift+H"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "toggle_devtools", "切换开发人员工具", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::about(
                        app,
                        Some("关于 RunCode"),
                        Some(AboutMetadata {
                            version: Some("1.0.2".into()),
                            authors: Some(vec!["YuanMing".into()]),
                            website: Some("https://github.com/YuanMing/RunCode".into()),
                            copyright: Some("© 2026 YuanMing".into()),
                            license: Some("MIT".into()),
                            ..Default::default()
                        }),
                    )?,
                ],
            )?;

            let menu = Menu::with_items(
                app,
                &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu],
            )?;
            app.set_menu(menu)?;
            } // end cfg(target_os = "macos")

            // 清理 custom_themes/ 目录下未被 settings.json 引用的孤儿图片文件
            // （处理"用户点应用主题但未保存就关闭面板"产生的孤儿文件）
            // cleanup 失败不应阻塞应用启动，用 if let Ok 静默处理
            if let Ok(base) = app.path().app_data_dir() {
                let loaded = settings::load(&base);
                settings::cleanup_orphan_themes(&base, &loaded);
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "settings" => {
                    let _ = app.emit("menu-settings", ());
                }
                "file_new" => {
                    let _ = app.emit("menu-file-new", ());
                }
                "file_open" => {
                    let _ = app.emit("menu-file-open", ());
                }
                "file_save" => {
                    let _ = app.emit("menu-file-save", ());
                }
                "file_save_as" => {
                    let _ = app.emit("menu-file-save-as", ());
                }
                "file_recent" => {
                    let _ = app.emit("menu-file-recent", ());
                }
                "file_close" => {
                    let _ = app.emit("menu-file-close", ());
                }
                "file_close_all" => {
                    let _ = app.emit("menu-file-close-all", ());
                }
                "edit_format" => {
                    let _ = app.emit("menu-edit-format", ());
                }
                "find" => {
                    let _ = app.emit("menu-find", ());
                }
                "find_next" => {
                    let _ = app.emit("menu-find-next", ());
                }
                "find_prev" => {
                    let _ = app.emit("menu-find-prev", ());
                }
                "replace" => {
                    let _ = app.emit("menu-replace", ());
                }
                "goto_line" => {
                    let _ = app.emit("menu-goto-line", ());
                }
                "layout_horizontal" => {
                    // 强制同步单选状态（覆盖 Tauri 的自动 toggle）
                    let _ = update_view_menu_state_inner(app, "horizontal", None);
                    let _ = app.emit("menu-layout", "horizontal");
                }
                "layout_vertical" => {
                    let _ = update_view_menu_state_inner(app, "vertical", None);
                    let _ = app.emit("menu-layout", "vertical");
                }
                "auto_hide" => {
                    let _ = app.emit("menu-toggle-auto-hide", ());
                }
                "font_inc" => {
                    let _ = app.emit("menu-font-inc", ());
                }
                "font_dec" => {
                    let _ = app.emit("menu-font-dec", ());
                }
                "font_reset" => {
                    let _ = app.emit("menu-font-reset", ());
                }
                "toggle_panel" => {
                    let _ = app.emit("menu-toggle-panel", ());
                }
                "toggle_devtools" => {
                    let _ = app.emit("menu-toggle-devtools", ());
                }
                "help" => {
                    // 帮助内容暂时留空
                    let _ = app.emit("menu-help", ());
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            // macOS：通过"打开方式"派发 RunEvent::Opened（Apple open-files event，非 argv）
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => {
                if let Some(path) = urls.iter().find_map(|u| {
                    if u.scheme() == "file" {
                        u.to_file_path().ok()
                    } else {
                        None
                    }
                }) {
                    let path_str = path.to_string_lossy().to_string();
                    // 全局静态：macOS 冷启动时 Opened 早于 setup，managed state 尚不存在，
                    // 必须用全局静态才能在此处写入；前端 mount 时通过 get_pending_open_file 拉取
                    if let Ok(mut g) = STARTUP_FILE.lock() {
                        *g = Some(path_str.clone());
                    }
                    let _ = app_handle.emit("open-file", path_str);
                }
            }
            // 应用退出时清理所有 PTY 子进程和运行会话，防止残留
            tauri::RunEvent::Exit => {
                if let Some(pm) = app_handle.try_state::<PtyManager>() {
                    pm.kill_all();
                }
                if let Some(rm) = app_handle.try_state::<RunManager>() {
                    rm.cancel_all();
                }
            }
            _ => {}
        });
}

/// 更新布局菜单项的文本前缀（✓ / 空格）
///
/// 逐层查找：顶层 menu → view_menu (submenu) → layout_submenu (submenu) →
/// layout_horizontal / layout_vertical (menuitem)
///
/// 任意一层查找失败或类型不匹配都返回 Err，不静默忽略。
fn update_layout_menu_text(app: &tauri::AppHandle, layout: &str) -> Result<(), String> {
    let menu = app
        .menu()
        .ok_or_else(|| "应用菜单未设置".to_string())?;

    // 第一层：顶层 menu → view_menu
    let view_kind = menu
        .get("view_menu")
        .ok_or_else(|| "未找到 view_menu 菜单项".to_string())?;
    let view_submenu = view_kind
        .as_submenu()
        .ok_or_else(|| "view_menu 不是 Submenu 类型".to_string())?;

    // 第二层：view_menu → layout_submenu
    let layout_kind = view_submenu
        .get("layout_submenu")
        .ok_or_else(|| "未找到 layout_submenu 菜单项".to_string())?;
    let layout_submenu = layout_kind
        .as_submenu()
        .ok_or_else(|| "layout_submenu 不是 Submenu 类型".to_string())?;

    // 第三层：layout_submenu → layout_horizontal / layout_vertical
    let h_kind = layout_submenu
        .get("layout_horizontal")
        .ok_or_else(|| "未找到 layout_horizontal 菜单项".to_string())?;
    let h_item = h_kind
        .as_menuitem()
        .ok_or_else(|| "layout_horizontal 不是 MenuItem 类型".to_string())?;
    let h_text = if layout == "horizontal" {
        "✓ 左右分栏"
    } else {
        "  左右分栏"
    };
    h_item
        .set_text(h_text)
        .map_err(|e| format!("set_text(layout_horizontal) 失败: {e}"))?;

    let v_kind = layout_submenu
        .get("layout_vertical")
        .ok_or_else(|| "未找到 layout_vertical 菜单项".to_string())?;
    let v_item = v_kind
        .as_menuitem()
        .ok_or_else(|| "layout_vertical 不是 MenuItem 类型".to_string())?;
    let v_text = if layout == "vertical" {
        "✓ 上下分栏"
    } else {
        "  上下分栏"
    };
    v_item
        .set_text(v_text)
        .map_err(|e| format!("set_text(layout_vertical) 失败: {e}"))?;

    Ok(())
}

/// 更新 auto_hide CheckMenuItem 的勾选状态
///
/// 从 view_menu 子菜单中查找 auto_hide。
fn update_auto_hide_state(app: &tauri::AppHandle, auto_hide: bool) -> Result<(), String> {
    let menu = app
        .menu()
        .ok_or_else(|| "应用菜单未设置".to_string())?;
    let view_kind = menu
        .get("view_menu")
        .ok_or_else(|| "未找到 view_menu 菜单项".to_string())?;
    let view_submenu = view_kind
        .as_submenu()
        .ok_or_else(|| "view_menu 不是 Submenu 类型".to_string())?;
    let kind = view_submenu
        .get("auto_hide")
        .ok_or_else(|| "未找到 auto_hide 菜单项".to_string())?;
    let check = kind
        .as_check_menuitem()
        .ok_or_else(|| "auto_hide 不是 CheckMenuItem 类型".to_string())?;
    check
        .set_checked(auto_hide)
        .map_err(|e| format!("set_checked(auto_hide) 失败: {e}"))?;
    Ok(())
}

/// 更新视图菜单 CheckMenuItem 的勾选状态（内部辅助函数）
pub fn update_view_menu_state_inner(
    app: &tauri::AppHandle,
    layout: &str,
    auto_hide: Option<bool>,
) -> Result<(), String> {
    update_layout_menu_text(app, layout)?;

    if let Some(auto_hide_val) = auto_hide {
        update_auto_hide_state(app, auto_hide_val)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_launch_path_empty_args() {
        assert_eq!(parse_launch_path(&[]), None);
    }

    #[test]
    fn parse_launch_path_only_program() {
        // argv[0] 是程序自身路径，应被跳过
        assert_eq!(parse_launch_path(&["/usr/bin/runcode".to_string()]), None);
    }

    #[test]
    fn parse_launch_path_no_match() {
        // 无关联扩展名
        assert_eq!(
            parse_launch_path(&["prog".to_string(), "/x/readme.txt".to_string()]),
            None
        );
        assert_eq!(
            parse_launch_path(&["prog".to_string(), "--flag".to_string()]),
            None
        );
    }

    #[test]
    fn parse_launch_path_cpp() {
        assert_eq!(
            parse_launch_path(&[
                "prog".to_string(),
                "/Users/a/solution.cpp".to_string()
            ]),
            Some("/Users/a/solution.cpp".to_string())
        );
    }

    #[test]
    fn parse_launch_path_case_insensitive() {
        // Windows 文件系统大小写不敏感，扩展名匹配应大小写无关
        assert_eq!(
            parse_launch_path(&["prog".to_string(), "C:\\x\\A.CPP".to_string()]),
            Some("C:\\x\\A.CPP".to_string())
        );
    }

    #[test]
    fn parse_launch_path_multiple_exts() {
        // 关联的所有扩展名都应匹配
        assert_eq!(
            parse_launch_path(&["prog".to_string(), "/x/header.hpp".to_string()]),
            Some("/x/header.hpp".to_string())
        );
        assert_eq!(
            parse_launch_path(&["prog".to_string(), "/x/main.cxx".to_string()]),
            Some("/x/main.cxx".to_string())
        );
    }

    #[test]
    fn parse_launch_path_first_match_wins() {
        // 多个匹配取首个
        assert_eq!(
            parse_launch_path(&[
                "prog".to_string(),
                "/x/a.cpp".to_string(),
                "/x/b.cpp".to_string()
            ]),
            Some("/x/a.cpp".to_string())
        );
    }

    #[test]
    fn parse_launch_path_skip_flags_before_file() {
        // 跳过非文件参数（如 --flag），仍能找到后续文件
        assert_eq!(
            parse_launch_path(&[
                "prog".to_string(),
                "--verbose".to_string(),
                "/x/a.cpp".to_string()
            ]),
            Some("/x/a.cpp".to_string())
        );
    }

    #[test]
    fn startup_file_drain_once() {
        // 清空可能残留的全局状态（cargo test 多线程，避免上次残留干扰）
        *STARTUP_FILE.lock().unwrap() = None;
        // 全局静态：首次取出 Some，二次取出 None（drain-once 语义）
        *STARTUP_FILE.lock().unwrap() = Some("x.cpp".to_string());
        assert_eq!(
            STARTUP_FILE.lock().unwrap().take(),
            Some("x.cpp".to_string())
        );
        assert_eq!(STARTUP_FILE.lock().unwrap().take(), None);
        // 测试后清空，避免影响其他测试
        *STARTUP_FILE.lock().unwrap() = None;
    }
}
