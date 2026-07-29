use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::error::AppError;
use crate::settings::{self, AppSettings};

/// 获取自定义主题图片的完整文件路径
/// 前端用 convertFileSrc(path) 转为 asset:// URL，用于 <img> 或 background-image
#[tauri::command]
pub async fn get_custom_theme_image_path(
    image_file: String,
    app: AppHandle,
) -> Result<String, AppError> {
    // 安全校验：禁止路径分隔符（防止路径穿越）
    if image_file.contains('/') || image_file.contains('\\') {
        return Err(AppError::Other {
            detail: "无效的图片文件名".into(),
        });
    }
    let ext = Path::new(&image_file)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let allowed = ["png", "jpg", "jpeg", "webp"];
    if !allowed.contains(&ext.as_str()) {
        return Err(AppError::Other {
            detail: format!("无效的图片扩展名: {ext}"),
        });
    }

    let base = base_dir(&app)?;
    let file_path = base.join("custom_themes").join(&image_file);

    if !file_path.exists() {
        return Err(AppError::Other {
            detail: "图片文件不存在".into(),
        });
    }

    Ok(file_path.to_string_lossy().to_string())
}

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
    settings::validate_opt_level(&settings.compiler.opt_level)?;
    settings::validate_opt_level(&settings.test.opt_level)?;

    let base = base_dir(&app)?;
    settings::save(&base, &settings)
}

/// 读取文件字节（用于前端读取图片做 Canvas 颜色提取）
///
/// 限制：只读图片文件（扩展名白名单），大小上限 10MB
#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<Vec<u8>, AppError> {
    // 扩展名白名单
    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let allowed = ["png", "jpg", "jpeg", "webp"];
    if !allowed.contains(&ext.as_str()) {
        return Err(AppError::Other {
            detail: format!("不支持的图片格式: {ext}（仅支持 png/jpg/jpeg/webp）"),
        });
    }

    // 大小校验（10MB 上限）
    let metadata = fs::metadata(&path)?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Err(AppError::Other {
            detail: "图片大小超过 10MB 上限".into(),
        });
    }

    fs::read(&path).map_err(|e| AppError::Other {
        detail: format!("读取图片失败: {e}"),
    })
}

/// 保存自定义主题图片到 app_data_dir/custom_themes/
///
/// 文件名：`{uuid8}.{ext}`（uuid v4 前 8 位 + 原扩展名）
/// 若同名文件已存在则跳过写入（去重）
///
/// 返回：文件名（不含路径），供前端存入 custom_theme.image_file
#[tauri::command]
pub async fn save_custom_theme_image(
    source_path: String,
    app: AppHandle,
) -> Result<String, AppError> {
    // 校验源文件扩展名
    let src_path = Path::new(&source_path);
    let ext = src_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let allowed = ["png", "jpg", "jpeg", "webp"];
    if !allowed.contains(&ext.as_str()) {
        return Err(AppError::Other {
            detail: format!("不支持的图片格式: {ext}"),
        });
    }

    // 大小校验（10MB 上限）
    let metadata = fs::metadata(&source_path)?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Err(AppError::Other {
            detail: "图片大小超过 10MB 上限".into(),
        });
    }

    let base = base_dir(&app)?;
    let themes_dir = base.join("custom_themes");
    fs::create_dir_all(&themes_dir)?;

    // 生成唯一文件名：uuid v4 前 8 位 + 扩展名
    let uuid_short = Uuid::new_v4().simple().to_string();
    let uuid_short = &uuid_short[..8];
    let image_file = format!("{uuid_short}.{ext}");
    let dest_path = themes_dir.join(&image_file);

    // 若已存在则跳过（理论上 uuid 冲突概率极低）
    if !dest_path.exists() {
        fs::copy(&source_path, &dest_path)?;
    }

    Ok(image_file)
}

/// 删除自定义主题图片
///
/// 安全校验：image_file 必须是纯文件名，不能包含路径分隔符
#[tauri::command]
pub async fn delete_custom_theme_image(
    image_file: String,
    app: AppHandle,
) -> Result<(), AppError> {
    // 安全校验：禁止路径分隔符（防止路径穿越）
    if image_file.contains('/') || image_file.contains('\\') {
        return Err(AppError::Other {
            detail: "无效的图片文件名".into(),
        });
    }
    // 仅允许图片扩展名
    let ext = Path::new(&image_file)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let allowed = ["png", "jpg", "jpeg", "webp"];
    if !allowed.contains(&ext.as_str()) {
        return Err(AppError::Other {
            detail: format!("无效的图片文件扩展名: {ext}"),
        });
    }

    let base = base_dir(&app)?;
    let file_path = base.join("custom_themes").join(&image_file);

    if file_path.exists() {
        fs::remove_file(&file_path)?;
    }
    // 文件不存在视为成功（幂等）
    Ok(())
}
