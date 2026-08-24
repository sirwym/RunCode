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
    /// 流程图：源码中未找到函数定义（引导用户检查代码）
    CfgNoFunction,
    /// 文件不是 UTF-8 编码（可能为 GBK/ANSI），明确报错而非静默乱码
    InvalidEncoding,
    /// 文件超过大小上限（size 字节 / max_mb MB）
    FileTooLarge { size: u64, max_mb: u64 },
    Cancelled,
    Other { detail: String },
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::CompilerNotFound { detail } => write!(f, "找不到编译器: {detail}"),
            AppError::Io { detail } => write!(f, "IO 错误: {detail}"),
            AppError::ProcessGroup { detail } => write!(f, "进程组操作失败: {detail}"),
            AppError::CfgNoFunction => write!(f, "未找到函数定义"),
            AppError::InvalidEncoding => write!(f, "文件不是 UTF-8 编码"),
            AppError::FileTooLarge { size, max_mb } => {
                write!(f, "文件大小 {size} 字节超过 {max_mb}MB 上限")
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 前后端错误码契约：序列化形状必须与前端 errors.* i18n 键对齐。
    /// unit variant 不含 params 字段（前端须用可选链读取）
    #[test]
    fn serialize_contract() {
        assert_eq!(
            serde_json::to_string(&AppError::CfgNoFunction).unwrap(),
            r#"{"code":"cfg_no_function"}"#
        );
        assert_eq!(
            serde_json::to_string(&AppError::InvalidEncoding).unwrap(),
            r#"{"code":"invalid_encoding"}"#
        );
        assert_eq!(
            serde_json::to_string(&AppError::FileTooLarge { size: 123, max_mb: 10 }).unwrap(),
            r#"{"code":"file_too_large","params":{"size":123,"max_mb":10}}"#
        );
    }
}
