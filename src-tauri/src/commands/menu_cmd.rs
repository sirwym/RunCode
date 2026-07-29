#[cfg(target_os = "macos")]
use crate::update_view_menu_state_inner;

/// 前端调用：同步视图菜单勾选状态
/// macOS：同步原生菜单的勾选标记；Windows：无原生菜单，空操作
#[tauri::command]
pub fn update_view_menu_state(
    app: tauri::AppHandle,
    layout: String,
    auto_hide: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        update_view_menu_state_inner(&app, &layout, Some(auto_hide))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, layout, auto_hide);
        Ok(())
    }
}
