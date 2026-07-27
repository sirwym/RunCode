use crate::error::AppError;
use crate::parser::{extract_symbols, Symbol};

/// 提取当前文件中的顶层符号（函数/全局变量/结构体/宏定义）
/// 用于代码补全 L2：在编辑器中补全已定义的符号
#[tauri::command]
pub async fn extract_code_symbols(code: String) -> Result<Vec<Symbol>, AppError> {
    // tree-sitter 解析是 CPU 密集型，丢到 blocking 池
    let symbols = tokio::task::spawn_blocking(move || extract_symbols(&code))
        .await
        .map_err(|e| AppError::Other {
            detail: format!("符号提取任务失败: {e}"),
        })?;
    Ok(symbols)
}
