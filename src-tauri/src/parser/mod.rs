// tree-sitter 解析基础设施
// 提供 C++ 代码解析能力，当前用于格式化与符号提取

use std::sync::Mutex;

use serde::Serialize;
use tree_sitter::{Node, Parser, Tree};

use crate::error::AppError;

pub mod cfg;
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

/// 语法问题（tree-sitter ERROR/MISSING 节点）
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct SyntaxIssue {
    pub line: usize,       // 1-based
    pub column: usize,     // 1-based
    pub end_line: usize,
    pub end_column: usize,
    pub message: String,
    pub kind: String, // "error" / "missing"
}

/// 收集 tree-sitter ERROR/MISSING 节点
/// 失败时返回空 Vec（不报错，语法检查降级为无提示）
pub fn check_syntax(code: &str) -> Vec<SyntaxIssue> {
    let tree = match parse_cpp(code) {
        Some(t) => t,
        None => return Vec::new(),
    };
    let mut issues = Vec::new();
    let root = tree.root_node();
    collect_syntax_issues(&root, &mut issues, code.as_bytes());
    issues
}

fn collect_syntax_issues(node: &Node, issues: &mut Vec<SyntaxIssue>, source: &[u8]) {
    if node.is_error() {
        let start = node.start_position();
        let end = node.end_position();
        issues.push(SyntaxIssue {
            line: start.row + 1,
            column: start.column + 1,
            end_line: end.row + 1,
            end_column: end.column + 1,
            message: "此处可能存在语法错误".to_string(),
            kind: "error".to_string(),
        });
    }
    if node.is_missing() {
        let pos = node.start_position();
        let text = node.kind();
        issues.push(SyntaxIssue {
            line: pos.row + 1,
            column: pos.column + 1,
            end_line: pos.row + 1,
            end_column: pos.column + 2,
            message: format!("缺少 '{}'", text),
            kind: "missing".to_string(),
        });
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_syntax_issues(&child, issues, source);
    }
}

/// 提取出的代码符号
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct Symbol {
    pub name: String,
    pub kind: String, // "function" / "variable" / "struct" / "macro"
    pub line: usize,
}

/// 从 C++ 代码中提取顶层符号（函数/全局变量/结构体/宏定义）
/// 不收集函数体内的局部变量。
/// 失败时返回空 Vec（不报错，符号补全降级为只有 snippet）
pub fn extract_symbols(code: &str) -> Vec<Symbol> {
    let tree = match parse_cpp(code) {
        Some(t) => t,
        None => return Vec::new(),
    };
    let mut symbols = Vec::new();
    let root = tree.root_node();
    walk(&root, &mut symbols, code.as_bytes());
    symbols
}

fn walk(node: &Node, symbols: &mut Vec<Symbol>, source: &[u8]) {
    match node.kind() {
        "function_definition" => {
            if let Some(decl) = node.child_by_field_name("declarator") {
                if let Some(name) = extract_function_name(&decl, source) {
                    symbols.push(Symbol {
                        name,
                        kind: "function".into(),
                        line: node.start_position().row + 1,
                    });
                }
            }
        }
        "declaration" => {
            // 顶层变量声明：int x = 0; int a, b; vector<int> v;
            collect_declarators(node, symbols, "variable", source);
        }
        "struct_specifier" | "class_specifier" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                if let Ok(name) = name_node.utf8_text(source) {
                    symbols.push(Symbol {
                        name: name.to_string(),
                        kind: "struct".into(),
                        line: node.start_position().row + 1,
                    });
                }
            }
        }
        "preproc_function_def" => {
            // #define MAX(a, b) ...
            if let Some(name_node) = node.child_by_field_name("name") {
                if let Ok(name) = name_node.utf8_text(source) {
                    symbols.push(Symbol {
                        name: name.to_string(),
                        kind: "macro".into(),
                        line: node.start_position().row + 1,
                    });
                }
            }
        }
        _ => {}
    }

    // 递归子节点（但跳过函数体内部，避免收集局部变量）
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        // 不进入 function_definition 的 body，避免局部变量污染
        if node.kind() == "function_definition" && child.kind() == "compound_statement" {
            continue;
        }
        walk(&child, symbols, source);
    }
}

/// 从 declarator 节点中提取函数名
/// declarator 可能是 function_declarator / pointer_declarator / parenthesized_declarator 等嵌套结构
pub(crate) fn extract_function_name(decl: &Node, source: &[u8]) -> Option<String> {
    let mut current = *decl;
    loop {
        match current.kind() {
            "function_declarator" => {
                if let Some(name) = current.child_by_field_name("declarator") {
                    return extract_identifier_text(&name, source);
                }
                return None;
            }
            "identifier" => {
                return current.utf8_text(source).ok().map(|s| s.to_string());
            }
            "scoped_identifier" | "qualified_identifier" => {
                return current.utf8_text(source).ok().map(|s| s.to_string());
            }
            _ => {
                current = current.child_by_field_name("declarator")?;
            }
        }
    }
}

/// 递归查找 identifier 节点的文本
fn extract_identifier_text(node: &Node, source: &[u8]) -> Option<String> {
    if node.kind() == "identifier" || node.kind() == "scoped_identifier" || node.kind() == "qualified_identifier" {
        return node.utf8_text(source).ok().map(|s| s.to_string());
    }
    // 尝试子节点
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(text) = extract_identifier_text(&child, source) {
            return Some(text);
        }
    }
    None
}

/// 处理 int a, b, c; 多声明情况，收集所有 declarator
fn collect_declarators(node: &Node, symbols: &mut Vec<Symbol>, kind: &str, source: &[u8]) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        // init_declarator: int a = 0;
        // declarator: int a;（无初始化）
        if child.kind() == "init_declarator" {
            if let Some(name_node) = child.child_by_field_name("declarator") {
                if let Some(name) = extract_identifier_text(&name_node, source) {
                    symbols.push(Symbol {
                        name,
                        kind: kind.into(),
                        line: child.start_position().row + 1,
                    });
                }
            }
        } else if child.kind() == "declarator" {
            if let Some(name) = extract_identifier_text(&child, source) {
                symbols.push(Symbol {
                    name,
                    kind: kind.into(),
                    line: child.start_position().row + 1,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_symbols_finds_function() {
        let code = "int add(int a, int b) {\n\treturn a + b;\n}\n";
        let symbols = extract_symbols(code);
        assert!(symbols.iter().any(|s| s.name == "add" && s.kind == "function"));
    }

    #[test]
    fn extract_symbols_skips_local_variables() {
        let code = "int main() {\n\tint a = 1;\n\tint b = 2;\n\treturn a + b;\n}\n";
        let symbols = extract_symbols(code);
        // a/b 在函数体内，不收集
        assert!(!symbols.iter().any(|s| s.name == "a"));
        assert!(!symbols.iter().any(|s| s.name == "b"));
        assert!(symbols.iter().any(|s| s.name == "main" && s.kind == "function"));
    }

    #[test]
    fn extract_symbols_finds_global_variable() {
        let code = "int g_count = 0;\nint main() { return 0; }\n";
        let symbols = extract_symbols(code);
        assert!(symbols.iter().any(|s| s.name == "g_count" && s.kind == "variable"));
    }

    #[test]
    fn extract_symbols_finds_struct() {
        let code = "struct Node {\n\tint x, y;\n};\nint main() { return 0; }\n";
        let symbols = extract_symbols(code);
        assert!(symbols.iter().any(|s| s.name == "Node" && s.kind == "struct"));
    }

    #[test]
    fn extract_symbols_finds_macro() {
        let code = "#define MAX(a, b) ((a) > (b) ? (a) : (b))\nint main() { return 0; }\n";
        let symbols = extract_symbols(code);
        assert!(symbols.iter().any(|s| s.name == "MAX" && s.kind == "macro"));
    }

    #[test]
    fn extract_symbols_handles_invalid_code() {
        let code = "this is not valid c++";
        let symbols = extract_symbols(code);
        // 不 panic 即可
        let _ = symbols.len();
    }

    #[test]
    fn extract_symbols_finds_multiple_functions() {
        let code = "int add(int a, int b) { return a + b; }\nint sub(int a, int b) { return a - b; }\n";
        let symbols = extract_symbols(code);
        let functions: Vec<_> = symbols.iter().filter(|s| s.kind == "function").collect();
        assert!(functions.iter().any(|s| s.name == "add"));
        assert!(functions.iter().any(|s| s.name == "sub"));
    }

    #[test]
    fn extract_symbols_line_number_is_one_based() {
        let code = "\n\nint main() { return 0; }\n";
        let symbols = extract_symbols(code);
        let main_sym = symbols.iter().find(|s| s.name == "main").unwrap();
        assert_eq!(main_sym.line, 3);
    }

    // ============ check_syntax 测试（功能3d） ============

    #[test]
    fn check_syntax_valid_code_returns_empty() {
        let code = "int main() { return 0; }";
        let issues = check_syntax(code);
        assert!(issues.is_empty(), "合法代码不应有语法问题: {:?}", issues);
    }

    #[test]
    fn check_syntax_missing_semicolon_detects_missing() {
        let code = "int x";
        let issues = check_syntax(code);
        assert!(issues.iter().any(|i| i.kind == "missing"), "应检测到 missing 节点: {:?}", issues);
    }

    #[test]
    fn check_syntax_unmatched_brace_detects_missing() {
        let code = "int main() {";
        let issues = check_syntax(code);
        // tree-sitter 对缺少闭合括号插入 missing 节点（缺少 '}'）
        assert!(issues.iter().any(|i| i.kind == "missing"), "应检测到 missing 节点: {:?}", issues);
    }

    #[test]
    fn check_syntax_invalid_code_detects_error() {
        let code = "this is not c++";
        let issues = check_syntax(code);
        assert!(issues.iter().any(|i| i.kind == "error"), "无效代码应检测到 error 节点: {:?}", issues);
    }

    #[test]
    fn check_syntax_line_number_is_one_based() {
        let code = "\n\nint x";
        let issues = check_syntax(code);
        let issue = issues.iter().find(|i| i.kind == "missing").expect("应检测到 missing 节点");
        assert!(issue.line >= 3, "行号应为 1-based 且 >= 3: {}", issue.line);
    }

    #[test]
    fn check_syntax_nested_error_detected() {
        let code = "int main() { int x }";
        let issues = check_syntax(code);
        // 函数体内缺少分号也应被检测到
        assert!(!issues.is_empty(), "嵌套错误应被检测到: {:?}", issues);
    }

    #[test]
    fn check_syntax_empty_string_returns_empty() {
        let issues = check_syntax("");
        assert!(issues.is_empty(), "空字符串不应有语法问题");
    }
}
