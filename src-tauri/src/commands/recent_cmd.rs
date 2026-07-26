use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::recent_files::{RecentEntry, RecentFiles};

/// 获取 app data 目录作为最近文件存储根目录
fn base_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Other {
            detail: format!("获取数据目录失败: {e}"),
        })
}

/// 读取最近文件列表
#[tauri::command]
pub async fn get_recent_files(app: AppHandle) -> Result<Vec<RecentEntry>, AppError> {
    let base = base_dir(&app)?;
    RecentFiles::load(&base)
}

/// 新增一条最近文件记录
#[tauri::command]
pub async fn add_recent_file(
    app: AppHandle,
    path: String,
    name: String,
) -> Result<(), AppError> {
    let base = base_dir(&app)?;
    RecentFiles::add(&base, path, name)
}

/// 移除指定路径的最近文件记录
#[tauri::command]
pub async fn remove_recent_file(app: AppHandle, path: String) -> Result<(), AppError> {
    let base = base_dir(&app)?;
    RecentFiles::remove(&base, &path)
}

/// 清空最近文件列表
#[tauri::command]
pub async fn clear_recent_files(app: AppHandle) -> Result<(), AppError> {
    let base = base_dir(&app)?;
    RecentFiles::clear(&base)
}
