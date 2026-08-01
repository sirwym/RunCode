use std::fs;
use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

use crate::error::AppError;
use crate::recent_files::RecentFiles;

/// 文件大小上限：10MB（与 read_file_bytes 对齐）
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

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

/// 校验文件大小不超过 10MB 上限
fn check_file_size(path: &str) -> Result<(), AppError> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(AppError::Other {
            detail: format!("文件大小 {} 字节超过 10MB 上限", metadata.len()),
        });
    }
    Ok(())
}

/// 打开并读取文件，并写入最近文件列表。
///
/// 前端通过 plugin-dialog 获取路径后调用本命令读取。
/// 不开放宽泛 fs 权限给前端 webview，所有文件 IO 走 Rust 命令。
#[tauri::command]
pub async fn open_file(app: AppHandle, path: String) -> Result<FileContent, AppError> {
    check_file_size(&path)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn check_file_size_rejects_oversize() {
        let tmp = TempDir::new().unwrap();
        let big_path = tmp.path().join("big.txt");
        // 写 10MB + 1 字节
        let content = "a".repeat((10 * 1024 * 1024) + 1);
        std::fs::write(&big_path, &content).unwrap();
        let err = check_file_size(big_path.to_str().unwrap()).unwrap_err();
        match err {
            AppError::Other { detail } => {
                assert!(detail.contains("超过 10MB 上限"), "实际: {detail}");
            }
            other => panic!("预期 AppError::Other，实际: {other:?}"),
        }
    }

    #[test]
    fn check_file_size_accepts_within_limit() {
        let tmp = TempDir::new().unwrap();
        let small_path = tmp.path().join("small.txt");
        std::fs::write(&small_path, "hello").unwrap();
        check_file_size(small_path.to_str().unwrap()).expect("小文件应通过校验");
    }

    #[test]
    fn check_file_size_accepts_exact_limit() {
        let tmp = TempDir::new().unwrap();
        let boundary_path = tmp.path().join("boundary.txt");
        // 恰好 10MB（边界值，不应拒绝）
        let content = "a".repeat(10 * 1024 * 1024);
        std::fs::write(&boundary_path, &content).unwrap();
        check_file_size(boundary_path.to_str().unwrap()).expect("边界值 10MB 应通过校验");
    }

    #[test]
    fn check_file_size_rejects_nonexistent() {
        let err = check_file_size("/nonexistent/path/file.txt").unwrap_err();
        match err {
            AppError::Io { .. } => {}
            other => panic!("预期 AppError::Io，实际: {other:?}"),
        }
    }
}
