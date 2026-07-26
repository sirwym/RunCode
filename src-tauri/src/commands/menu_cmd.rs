use crate::update_view_menu_state_inner;

/// 前端调用：同步视图菜单勾选状态
#[tauri::command]
pub fn update_view_menu_state(
    app: tauri::AppHandle,
    layout: String,
    auto_hide: bool,
) -> Result<(), String> {
    update_view_menu_state_inner(&app, &layout, Some(auto_hide))
}
