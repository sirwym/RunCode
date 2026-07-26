use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::settings::{self, AppSettings};

/// 获取 app data 目录
fn base_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Other {
            detail: format!("获取数据目录失败: {e}"),
        })
}

/// 读取应用设置（不存在则返回默认值）
#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<AppSettings, AppError> {
    let base = base_dir(&app)?;
    Ok(settings::load(&base))
}

/// 保存应用设置（保存前校验附加参数）
#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    settings: AppSettings,
) -> Result<(), AppError> {
    // 校验附加参数（保存前拦截，避免运行时才发现错误）
    settings::validate_extra_args(&settings.compiler.extra_args)?;

    let base = base_dir(&app)?;
    settings::save(&base, &settings)
}
