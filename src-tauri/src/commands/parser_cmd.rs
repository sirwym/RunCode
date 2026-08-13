use crate::error::AppError;
use crate::parser::cfg::{generate_cfg as generate_cfg_impl, CfgResult};
use crate::parser::{check_syntax as check_syntax_impl, extract_symbols, Symbol, SyntaxIssue};

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

/// 检查 C++ 代码语法，返回 tree-sitter ERROR/MISSING 节点
/// 用于前端实时语法提示（黄色 squiggly）
#[tauri::command]
pub async fn check_syntax(code: String) -> Result<Vec<SyntaxIssue>, AppError> {
    let issues = tokio::task::spawn_blocking(move || check_syntax_impl(&code))
        .await
        .map_err(|e| AppError::Other {
            detail: format!("语法检查任务失败: {e}"),
        })?;
    Ok(issues)
}

/// 生成 C++ 函数控制流图
/// 输入：C++ 源码字符串
/// 输出：CfgResult（Mermaid 文本 + 节点元数据 + 警告）
#[tauri::command]
pub async fn generate_cfg(code: String) -> Result<CfgResult, AppError> {
    let result = tokio::task::spawn_blocking(move || generate_cfg_impl(&code))
        .await
        .map_err(|e| AppError::Other {
            detail: format!("CFG 生成任务失败: {e}"),
        })?
        .map_err(|e| AppError::Other { detail: e })?;
    Ok(result)
}
