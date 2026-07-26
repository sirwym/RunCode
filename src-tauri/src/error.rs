use serde::Serialize;

/// 执行内核的错误类型。
///
/// 序列化为 `{ code, params }` 结构，供前端 i18n 转换：
/// `{ "code": "compiler_not_found", "params": { "detail": "..." } }`
///
/// 已删除死变体 `CompileFailed` / `RunTimeout`：
/// - 编译失败作为 `RunResult { stage: CompileFailed }` 正常返回，不是错误
/// - 运行超时作为 `KillReason::Timeout` 正常返回，不是错误
#[derive(Debug, Serialize)]
#[serde(tag = "code", content = "params")]
#[serde(rename_all = "snake_case")]
pub enum AppError {
    CompilerNotFound { detail: String },
    Io { detail: String },
    ProcessGroup { detail: String },
    Cancelled,
    Other { detail: String },
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::CompilerNotFound { detail } => write!(f, "找不到编译器: {detail}"),
            AppError::Io { detail } => write!(f, "IO 错误: {detail}"),
            AppError::ProcessGroup { detail } => write!(f, "进程组操作失败: {detail}"),
            AppError::Cancelled => write!(f, "已取消"),
            AppError::Other { detail } => write!(f, "{detail}"),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io {
            detail: e.to_string(),
        }
    }
}

impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}
