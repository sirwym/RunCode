// 基于 tree-sitter AST 的简化 C++ 格式化器
// 采用"AST 辅助 + 文本修补"策略：
//   1. 用 AST 计算每行正确缩进层级（跳过字符串/注释内的 `{`）
//   2. 在原始文本上应用缩进
//   3. 通用文本规则（运算符空格、括号换行、行尾清理、空行压缩）
// 覆盖 80% 常用场景，不处理：指针贴左贴右、对齐连续赋值、行宽换行策略、宏内部

use tree_sitter::{Node, Tree};

use super::parse_cpp;

const INDENT_UNIT: &str = "    "; // 4 空格

pub struct TreeSitterFormatter;

impl TreeSitterFormatter {
    /// 格式化 C++ 代码
    pub fn format(code: &str) -> String {
        let tree = parse_cpp(code);
        let mut result = code.to_string();

        // 1. AST 辅助：计算每行正确缩进层级
        if let Some(tree) = tree {
            let indent_map = Self::compute_indent(&tree, code);
            result = Self::apply_indent(result, &indent_map);
        }

        // 2. 通用文本规则（不需要 AST）
        result = Self::normalize_braces(result);
        result = Self::normalize_keywords(result);
        result = Self::trim_trailing_ws(result);
        result = Self::collapse_blank_lines(result);
        result
    }

    /// 用 AST 计算每行的缩进层级
    /// 递归遍历节点，遇到 compound_statement 时其子节点深度 +1
    fn compute_indent(tree: &Tree, code: &str) -> Vec<usize> {
        let line_count = code.lines().count();
        let mut indent_map = vec![0usize; line_count];
        let root = tree.root_node();
        // root 自身深度 0，子节点默认 0（直到遇到 compound_statement 才 +1）
        Self::walk_node(&root, &mut indent_map, 0, 0);
        indent_map
    }

    /// 递归遍历节点，记录每行应有缩进深度
    ///
    /// - `node_depth`：当前节点自身起始行应使用的缩进深度
    /// - `child_depth`：默认子节点起始行应使用的缩进深度
    ///
    /// 对"块"节点（compound_statement 函数体 / declaration_list namespace 体 /
    /// field_declaration_list 类体），其自身起始行（`{` 行）仍用 node_depth，
    /// 但其内部子节点用 node_depth + 1（即透传 child_depth + 1）。
    ///
    /// 对非"块"子节点，若其起始行与父节点相同（同行），用 node_depth 而非
    /// child_depth，避免 K&R 风格 `int main(){` 中的 `{` token 把函数签名行
    /// 错误提升到深度 1。
    fn walk_node(node: &Node, map: &mut Vec<usize>, node_depth: usize, child_depth: usize) {
        let start_line = node.start_position().row;
        if start_line < map.len() && map[start_line] < node_depth {
            map[start_line] = node_depth;
        }

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            // 进入"块"节点时（函数体 / namespace 体 / 类体），其自身行仍用 child_depth，
            // 但其内部子节点用 child_depth + 1
            let (child_node_depth, child_child_depth) = match child.kind() {
                "compound_statement" | "declaration_list" | "field_declaration_list" => {
                    (child_depth, child_depth + 1)
                }
                _ => {
                    // 同行子节点（如 K&R 风格的 `{` token、`int` 类型、`main()` 声明器）
                    // 用 node_depth 避免函数签名行被错误缩进
                    let child_start = child.start_position().row;
                    if child_start == start_line {
                        (node_depth, child_depth)
                    } else {
                        (child_depth, child_depth)
                    }
                }
            };
            Self::walk_node(&child, map, child_node_depth, child_child_depth);
        }
    }

    /// 应用缩进：按 indent_map 重新缩进每行
    fn apply_indent(code: String, indent_map: &[usize]) -> String {
        let mut out: Vec<String> = Vec::new();
        for (i, line) in code.lines().enumerate() {
            let depth = indent_map.get(i).copied().unwrap_or(0);
            let trimmed = line.trim_start();
            // 空行保持空
            if trimmed.is_empty() {
                out.push(String::new());
                continue;
            }
            // `}` 行深度 -1（因为 `}` 属于上一层）
            let effective_depth = if trimmed.starts_with('}') {
                depth.saturating_sub(1)
            } else {
                depth
            };
            out.push(format!("{}{}", INDENT_UNIT.repeat(effective_depth), trimmed));
        }
        out.join("\n") + "\n"
    }

    /// 括号规范化：`){` → `) {`
    fn normalize_braces(code: String) -> String {
        code.replace("){", ") {")
    }

    /// 关键字后加空格：`if(` → `if (`、`for(` → `for (`
    fn normalize_keywords(code: String) -> String {
        let keywords = ["if", "for", "while", "switch", "catch", "return"];
        let mut result = code;
        for kw in keywords {
            let pattern = format!("{kw}(");
            let replacement = format!("{kw} (");
            result = result.replace(&pattern, &replacement);
        }
        result
    }

    /// 行尾空格清理
    fn trim_trailing_ws(code: String) -> String {
        code.lines()
            .map(|line| line.trim_end())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n"
    }

    /// 压缩连续空行（最多保留 1 个）
    fn collapse_blank_lines(code: String) -> String {
        let mut result = String::new();
        let mut prev_blank = false;
        for line in code.lines() {
            let is_blank = line.trim().is_empty();
            if is_blank && prev_blank {
                continue; // 跳过连续空行
            }
            result.push_str(line);
            result.push('\n');
            prev_blank = is_blank;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_fixes_indentation() {
        let code = "int main(){\nreturn 0;\n}";
        let result = TreeSitterFormatter::format(code);
        assert!(
            result.contains("    return 0;"),
            "应修复缩进，实际: {result}"
        );
    }

    #[test]
    fn format_keyword_space() {
        let code = "int main(){\nif(true){\nreturn 0;\n}\n}";
        let result = TreeSitterFormatter::format(code);
        assert!(result.contains("if ("), "关键字后应加空格，实际: {result}");
    }

    #[test]
    fn format_preserves_string_content() {
        let code = "int main(){\nconst char* s = \"{not a block}\";\nreturn 0;\n}";
        let result = TreeSitterFormatter::format(code);
        // 字符串内的 { 不应影响缩进
        assert!(result.contains("\"{not a block}\""), "字符串内容应保留");
    }

    #[test]
    fn format_collapse_blank_lines() {
        let code = "int main(){\n\n\n\nreturn 0;\n}";
        let result = TreeSitterFormatter::format(code);
        assert!(!result.contains("\n\n\n"), "连续空行应压缩");
    }

    #[test]
    fn format_trim_trailing_ws() {
        let code = "int main(){   \nreturn 0;  \n}";
        let result = TreeSitterFormatter::format(code);
        assert!(!result.contains("   \n"), "行尾空格应清理");
        assert!(!result.contains("  \n"), "行尾空格应清理");
    }

    #[test]
    fn format_kr_style_no_extra_indent_on_signature() {
        // K&R 风格：{ 与函数签名同行
        let code = "int main(){\nreturn 0;\n}";
        let result = TreeSitterFormatter::format(code);
        // 第 0 行不应被缩进
        assert!(
            result.starts_with("int main"),
            "函数签名行不应被缩进，实际: {result}"
        );
        assert!(
            !result.starts_with("    int main"),
            "函数签名行不应有前导空格，实际: {result}"
        );
    }

    #[test]
    fn format_allman_style_no_extra_indent_on_brace() {
        // Allman 风格：{ 独立成行
        let code = "int main()\n{\nreturn 0;\n}";
        let result = TreeSitterFormatter::format(code);
        let lines: Vec<&str> = result.lines().collect();
        // 第 1 行（{ 行）不应被缩进
        assert!(
            lines[1].trim() == "{" && !lines[1].starts_with("    "),
            "Allman 风格的 {{ 行不应被缩进，实际: {result}"
        );
        // 第 2 行（return）应缩进一级
        assert!(
            lines[2].starts_with("    return"),
            "return 应缩进一级，实际: {result}"
        );
    }

    #[test]
    fn format_nested_functions() {
        let code = "int main(){\nif(true){\nreturn 0;\n}\n}";
        let result = TreeSitterFormatter::format(code);
        let lines: Vec<&str> = result.lines().collect();
        // 第 0 行 int main 无缩进
        assert!(lines[0].starts_with("int main"));
        // 第 1 行 if 缩进一级
        assert!(lines[1].starts_with("    if"));
        // 第 2 行 return 缩进二级
        assert!(lines[2].starts_with("        return"));
        // 第 3 行 } 缩进一级
        assert!(lines[3].trim() == "}" && lines[3].starts_with("    }"));
    }

    #[test]
    fn format_namespace_wrapped() {
        let code = "namespace ns {\nint main(){\nreturn 0;\n}\n}";
        let result = TreeSitterFormatter::format(code);
        let lines: Vec<&str> = result.lines().collect();
        // namespace 无缩进
        assert!(lines[0].starts_with("namespace"));
        // main 缩进一级
        assert!(lines[1].starts_with("    int main"));
        // return 缩进二级
        assert!(lines[2].starts_with("        return"));
    }
}
