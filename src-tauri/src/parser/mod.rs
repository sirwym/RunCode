// tree-sitter 解析基础设施
// 提供 C++ 代码解析能力，当前用于格式化，未来可扩展高亮/折叠/跳转等

use std::sync::Mutex;

use tree_sitter::{Parser, Tree};

use crate::error::AppError;

pub mod formatter;

// Parser 不是 Send，需要 Mutex 保护
// Tree 是 Send 的，可以跨线程传递
static CPP_PARSER: Mutex<Option<Parser>> = Mutex::new(None);

/// 获取 C++ parser（懒加载，首次调用时初始化）
fn get_parser() -> Result<std::sync::MutexGuard<'static, Option<Parser>>, AppError> {
    let mut guard = CPP_PARSER.lock().map_err(|e| AppError::Other {
        detail: format!("parser 锁失败: {e}"),
    })?;
    if guard.is_none() {
        let mut parser = Parser::new();
        parser
            .set_language(&tree_sitter_cpp::language())
            .map_err(|e| AppError::Other {
                detail: format!("tree-sitter 语言加载失败: {e}"),
            })?;
        *guard = Some(parser);
    }
    Ok(guard)
}

/// 解析 C++ 代码，返回 AST
/// 失败时返回 None（调用方回退到纯文本处理）
pub fn parse_cpp(code: &str) -> Option<Tree> {
    let mut guard = get_parser().ok()?;
    let parser = guard.as_mut()?;
    parser.parse(code, None)
}
