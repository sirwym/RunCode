use std::path::Path;

use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::importer::{self, ImportResult};

/// 获取 app data 目录
fn base_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Other {
            detail: format!("获取数据目录失败: {e}"),
        })
}

/// 导入测试用例。
///
/// `source` 可以是文件夹路径或 .zip 文件路径。
/// 根据路径类型自动选择导入方式。
#[tauri::command]
pub async fn import_test_cases(
    app: AppHandle,
    suite_id: String,
    source: String,
    strict: Option<bool>,
) -> Result<ImportResult, AppError> {
    let base = base_dir(&app)?;
    let strict = strict.unwrap_or(false);
    let source_path = Path::new(&source);

    if !source_path.exists() {
        return Err(AppError::Other {
            detail: "路径不存在".into(),
        });
    }

    if source_path.is_dir() {
        importer::import_from_directory(&base, &suite_id, source_path, strict)
    } else if source_path.is_file() {
        let ext = source_path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if ext == "zip" {
            importer::import_from_zip(&base, &suite_id, source_path, strict)
        } else {
            Err(AppError::Other {
                detail: "不支持的文件格式，仅支持 .zip 文件".into(),
            })
        }
    } else {
        Err(AppError::Other {
            detail: "不支持的路径类型".into(),
        })
    }
}
