use std::fs;
use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

use crate::error::AppError;
use crate::recent_files::RecentFiles;

/// 读取到的文件内容
#[derive(Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
}

/// 取文件 basename 作为最近文件展示名
fn basename(p: &str) -> String {
    let normalized = p.replace('\\', "/");
    let parts: Vec<&str> = normalized.split('/').collect();
    match parts.last() {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => p.to_string(),
    }
}

/// 打开并读取文件，并写入最近文件列表。
///
/// 前端通过 plugin-dialog 获取路径后调用本命令读取。
/// 不开放宽泛 fs 权限给前端 webview，所有文件 IO 走 Rust 命令。
#[tauri::command]
pub async fn open_file(app: AppHandle, path: String) -> Result<FileContent, AppError> {
    let content = fs::read_to_string(&path)?;
    // 写入最近文件（失败不影响打开）
    if let Ok(base) = app.path().app_data_dir() {
        let name = basename(&path);
        let _ = RecentFiles::add(&base, path.clone(), name);
    }
    Ok(FileContent { path, content })
}

/// 原子写入文件（先写临时文件再 rename，避免崩溃损坏）。
#[tauri::command]
pub async fn save_file(path: String, content: String) -> Result<(), AppError> {
    let p = Path::new(&path);
    let parent = p
        .parent()
        .ok_or_else(|| AppError::Other { detail: "无效路径".into() })?;
    // 同目录临时文件 + persist(rename)，保证原子性
    let tmp = NamedTempFile::new_in(parent)?;
    fs::write(tmp.path(), &content)?;
    tmp.persist(p)
        .map_err(|e| AppError::Other { detail: format!("持久化失败: {e}") })?;
    Ok(())
}
