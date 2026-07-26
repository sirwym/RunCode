use crate::error::AppError;
use crate::formatter::{FormatResult, Formatter};

/// 格式化 C++ 代码（三级回退：clang-format → 内置 → 原始）
/// style: "LLVM" / "Google" / "Microsoft" / "WebKit" / "GNU"（仅 clang-format 生效）
#[tauri::command]
pub async fn format_code(code: String, style: String) -> Result<FormatResult, AppError> {
    // 格式化是阻塞调用，丢到 blocking 池避免占用 tokio runtime
    let result = tokio::task::spawn_blocking(move || Formatter::format(&code, &style))
        .await
        .map_err(|e| AppError::Other {
            detail: format!("格式化任务失败: {e}"),
        })?;
    Ok(result)
}
