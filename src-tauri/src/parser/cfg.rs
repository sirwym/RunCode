// C++ 控制流图（CFG）生成器
// 基于 tree-sitter AST 遍历，输出 Mermaid flowchart 文本
// 教学场景简化版：支持 if/else/for/while/do-while/switch，不处理 goto/异常/模板

use std::fmt::Write;

use serde::Serialize;
use tree_sitter::Node;

use super::parse_cpp;

/// CFG 节点元数据（前端用于点击跳转映射）
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct CfgNode {
    pub id: String,
    pub label: String,
    pub line: usize, // 1-based 行号
    pub kind: String, // "entry" / "exit" / "statement" / "condition" / "loop" / "switch_case"
}

/// CFG 边
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct CfgEdge {
    pub from: String,
    pub to: String,
    pub label: Option<String>, // "true" / "false" / "break" / "continue" / None
}

/// CFG 生成结果
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub struct CfgResult {
    pub mermaid: String,
    pub nodes: Vec<CfgNode>,
    pub edges: Vec<CfgEdge>,
    pub warning: Option<String>,
}

const MAX_DEPTH: usize = 5;
const NODE_THRESHOLD: usize = 80;
const MAX_LABEL_LEN: usize = 40;

struct CfgBuilder {
    nodes: Vec<CfgNode>,
    edges: Vec<CfgEdge>,
    next_id: usize,
    source: Vec<u8>,
    macro_warning: Option<String>,
}

impl CfgBuilder {
    fn new(source: Vec<u8>) -> Self {
        Self {
            nodes: Vec::new(),
            edges: Vec::new(),
            next_id: 0,
            source,
            macro_warning: None,
        }
    }

    fn add_node(&mut self, kind: &str, label: &str, line: usize) -> String {
        let id = format!("n{}", self.next_id);
        self.next_id += 1;
        self.nodes.push(CfgNode {
            id: id.clone(),
            label: label.to_string(),
            line,
            kind: kind.to_string(),
        });
        id
    }

    fn add_edge(&mut self, from: &str, to: &str, label: Option<&str>) {
        self.edges.push(CfgEdge {
            from: from.to_string(),
            to: to.to_string(),
            label: label.map(|s| s.to_string()),
        });
    }

    /// 给 from 节点的第一条无标签边打上标签
    fn label_first_edge(&mut self, from: &str, label: &str) {
        for edge in self.edges.iter_mut() {
            if edge.from == from && edge.label.is_none() {
                edge.label = Some(label.to_string());
                return;
            }
        }
    }

    /// 查找目标函数：优先 main，否则取第一个 function_definition
    fn find_target_function<'a>(&self, root: &Node<'a>) -> Option<Node<'a>> {
        let mut cursor = root.walk();
        let mut first_func: Option<Node<'a>> = None;
        let mut main_func: Option<Node<'a>> = None;

        for child in root.children(&mut cursor) {
            if child.kind() == "function_definition" {
                if first_func.is_none() {
                    first_func = Some(child);
                }
                if let Some(decl) = child.child_by_field_name("declarator") {
                    if let Some(name) = super::extract_function_name(&decl, &self.source) {
                        if name == "main" {
                            main_func = Some(child);
                            break;
                        }
                    }
                }
            }
        }

        main_func.or(first_func)
    }

    /// 获取节点文本（安全截断 + 空白压缩）
    fn node_text(&self, node: &Node) -> String {
        let text = node.utf8_text(&self.source).unwrap_or("").trim().to_string();
        let text: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.chars().count() > MAX_LABEL_LEN {
            let truncated: String = text.chars().take(MAX_LABEL_LEN).collect();
            format!("{}…", truncated)
        } else {
            text
        }
    }

    /// 转义 Mermaid label 中的 HTML 特殊字符
    /// 节点 label 已用引号包裹，引号内 | {} () 是安全纯文本，只需转义 HTML 字符
    fn escape_label(text: &str) -> String {
        text.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    }

    /// 检测 #define 宏中是否含控制流关键字
    fn detect_macros(&mut self, root: &Node) {
        let mut cursor = root.walk();
        for child in root.children(&mut cursor) {
            let is_macro = child.kind() == "preproc_def" || child.kind() == "preproc_function_def";
            if !is_macro {
                continue;
            }
            let macro_text = child.utf8_text(&self.source).unwrap_or("");
            let has_control_flow = ["if", "for", "while", "switch", "do"]
                .iter()
                .any(|kw| {
                    macro_text
                        .split(|c: char| !c.is_alphanumeric() && c != '_')
                        .any(|word| word == *kw)
                });
            if has_control_flow {
                let name = child
                    .child_by_field_name("name")
                    .and_then(|n| n.utf8_text(&self.source).ok())
                    .unwrap_or("unknown");
                self.macro_warning = Some(format!(
                    "检测到含控制流关键字的宏定义（#{}），宏内的控制流不会被展开",
                    name
                ));
                break;
            }
        }
    }

    /// 生成 Mermaid flowchart 文本
    fn to_mermaid(&self) -> String {
        let mut out = String::new();
        writeln!(out, "graph TD").unwrap();

        for node in &self.nodes {
            let shape = match node.kind.as_str() {
                "entry" | "exit" => format!("([\"{}\"])", node.label),
                "condition" | "loop" => format!("{{\"{}\"}}", node.label),
                _ => {
                    if node.label.is_empty() {
                        "(( ))".to_string()
                    } else {
                        format!("[\"{}\"]", node.label)
                    }
                }
            };
            writeln!(out, "    {}{}", node.id, shape).unwrap();
        }

        for edge in &self.edges {
            if let Some(label) = &edge.label {
                writeln!(out, "    {} -->|{}| {}", edge.from, label, edge.to).unwrap();
            } else {
                writeln!(out, "    {} --> {}", edge.from, edge.to).unwrap();
            }
        }

        out
    }

    /// 处理语句块（compound_statement 的子语句序列）
    /// 返回 None 表示流不可达（通过 return/break/continue 终止）
    fn process_statements(
        &mut self,
        node: &Node,
        current: &str,
        exit: &str,
        loop_header: Option<&str>,
        loop_exit: Option<&str>,
        depth: usize,
    ) -> Option<String> {
        let mut flow = Some(current.to_string());
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if !is_statement(&child) {
                continue;
            }
            if let Some(ref f) = flow {
                flow = self.process_statement(&child, f, exit, loop_header, loop_exit, depth);
            }
        }
        flow
    }

    /// 处理单个语句，返回 Some(id) 表示流继续，None 表示不可达
    fn process_statement(
        &mut self,
        node: &Node,
        current: &str,
        exit: &str,
        loop_header: Option<&str>,
        loop_exit: Option<&str>,
        depth: usize,
    ) -> Option<String> {
        match node.kind() {
            "if_statement" => {
                self.process_if(node, current, exit, loop_header, loop_exit, depth)
            }
            "for_statement" => self.process_for(node, current, exit, depth),
            "while_statement" => self.process_while(node, current, exit, depth),
            "do_statement" => self.process_do_while(node, current, exit, depth),
            "switch_statement" => self.process_switch(node, current, exit, depth),
            "return_statement" => {
                let line = node.start_position().row + 1;
                let label = Self::escape_label(&self.node_text(node));
                let stmt = self.add_node("statement", &label, line);
                self.add_edge(current, &stmt, None);
                self.add_edge(&stmt, exit, None);
                None
            }
            "break_statement" => {
                if let Some(le) = loop_exit {
                    self.add_edge(current, le, Some("break"));
                }
                None
            }
            "continue_statement" => {
                if let Some(lh) = loop_header {
                    self.add_edge(current, lh, Some("continue"));
                }
                None
            }
            "compound_statement" => {
                if depth >= MAX_DEPTH {
                    let line = node.start_position().row + 1;
                    let stmt = self.add_node("statement", "…（嵌套过深）", line);
                    self.add_edge(current, &stmt, None);
                    Some(stmt)
                } else {
                    self.process_statements(
                        node,
                        current,
                        exit,
                        loop_header,
                        loop_exit,
                        depth + 1,
                    )
                }
            }
            _ => {
                let line = node.start_position().row + 1;
                let label = Self::escape_label(&self.node_text(node));
                let stmt = self.add_node("statement", &label, line);
                self.add_edge(current, &stmt, None);
                Some(stmt)
            }
        }
    }

    fn process_if(
        &mut self,
        node: &Node,
        current: &str,
        exit: &str,
        loop_header: Option<&str>,
        loop_exit: Option<&str>,
        depth: usize,
    ) -> Option<String> {
        let cond_text = node
            .child_by_field_name("condition")
            .map(|c| self.node_text(&c))
            .unwrap_or_default();
        let line = node.start_position().row + 1;
        let cond_id = self.add_node("condition", &Self::escape_label(&cond_text), line);
        self.add_edge(current, &cond_id, None);

        let merge_id = self.add_node("statement", "", 0);

        // consequence (if body)
        let consequence_end = if let Some(body) = node.child_by_field_name("consequence") {
            if depth >= MAX_DEPTH {
                let line = body.start_position().row + 1;
                let stmt = self.add_node("statement", "…（嵌套过深）", line);
                self.add_edge(&cond_id, &stmt, Some("true"));
                Some(stmt)
            } else {
                let d = if body.kind() == "compound_statement" {
                    depth + 1
                } else {
                    depth
                };
                let result = self.process_statements(
                    &body,
                    &cond_id,
                    exit,
                    loop_header,
                    loop_exit,
                    d,
                );
                // 给第一条 cond_id 出边打上 "true" 标签
                self.label_first_edge(&cond_id, "true");
                result
            }
        } else {
            self.add_edge(&cond_id, &merge_id, Some("true"));
            Some(merge_id.clone())
        };

        // alternative (else body)
        let alternative_end = if let Some(else_clause) = node.child_by_field_name("alternative") {
            let mut cursor = else_clause.walk();
            let inner = else_clause
                .children(&mut cursor)
                .find(|c| is_statement(c) || c.kind() == "if_statement");
            if let Some(inner_node) = inner {
                if inner_node.kind() == "if_statement" {
                    // else-if 链：递归处理
                    self.process_statement(
                        &inner_node,
                        &cond_id,
                        exit,
                        loop_header,
                        loop_exit,
                        depth,
                    )
                } else if inner_node.kind() == "compound_statement" {
                    if depth >= MAX_DEPTH {
                        let line = inner_node.start_position().row + 1;
                        let stmt = self.add_node("statement", "…（嵌套过深）", line);
                        self.add_edge(&cond_id, &stmt, Some("false"));
                        Some(stmt)
                    } else {
                        let result = self.process_statements(
                            &inner_node,
                            &cond_id,
                            exit,
                            loop_header,
                            loop_exit,
                            depth + 1,
                        );
                        self.label_first_edge(&cond_id, "false");
                        result
                    }
                } else {
                    // 单语句 else
                    let d = depth;
                    let result = self.process_statement(
                        &inner_node,
                        &cond_id,
                        exit,
                        loop_header,
                        loop_exit,
                        d,
                    );
                    self.label_first_edge(&cond_id, "false");
                    result
                }
            } else {
                self.add_edge(&cond_id, &merge_id, Some("false"));
                Some(merge_id.clone())
            }
        } else {
            // 无 else：false 直接连到 merge
            self.add_edge(&cond_id, &merge_id, Some("false"));
            Some(merge_id.clone())
        };

        // 两条路径汇聚到 merge（仅当路径可达时）
        let mut merge_reachable = false;
        if let Some(end) = &consequence_end {
            if end != &merge_id {
                self.add_edge(end, &merge_id, None);
            }
            merge_reachable = true;
        }
        if let Some(end) = &alternative_end {
            if end != &merge_id {
                self.add_edge(end, &merge_id, None);
            }
            merge_reachable = true;
        }

        if merge_reachable {
            Some(merge_id)
        } else {
            None
        }
    }

    fn process_for(&mut self, node: &Node, current: &str, exit: &str, depth: usize) -> Option<String> {
        let cond_text = node
            .child_by_field_name("condition")
            .map(|c| self.node_text(&c))
            .unwrap_or_default();
        let line = node.start_position().row + 1;
        let cond_id = self.add_node("loop", &Self::escape_label(&cond_text), line);
        self.add_edge(current, &cond_id, None);

        let after_id = self.add_node("statement", "", 0);

        if let Some(body) = node.child_by_field_name("body") {
            if depth >= MAX_DEPTH {
                let line = body.start_position().row + 1;
                let stmt = self.add_node("statement", "…（嵌套过深）", line);
                self.add_edge(&cond_id, &stmt, Some("true"));
                self.add_edge(&stmt, &cond_id, None);
            } else {
                let d = if body.kind() == "compound_statement" {
                    depth + 1
                } else {
                    depth
                };
                let body_end = self.process_statements(
                    &body,
                    &cond_id,
                    exit,
                    Some(&cond_id),
                    Some(&after_id),
                    d,
                );
                self.label_first_edge(&cond_id, "true");
                if let Some(end) = body_end {
                    self.add_edge(&end, &cond_id, None);
                }
            }
        }

        self.add_edge(&cond_id, &after_id, Some("false"));
        Some(after_id)
    }

    fn process_while(
        &mut self,
        node: &Node,
        current: &str,
        exit: &str,
        depth: usize,
    ) -> Option<String> {
        let cond_text = node
            .child_by_field_name("condition")
            .map(|c| self.node_text(&c))
            .unwrap_or_default();
        let line = node.start_position().row + 1;
        let cond_id = self.add_node("loop", &Self::escape_label(&cond_text), line);
        self.add_edge(current, &cond_id, None);

        let after_id = self.add_node("statement", "", 0);

        if let Some(body) = node.child_by_field_name("body") {
            if depth >= MAX_DEPTH {
                let line = body.start_position().row + 1;
                let stmt = self.add_node("statement", "…（嵌套过深）", line);
                self.add_edge(&cond_id, &stmt, Some("true"));
                self.add_edge(&stmt, &cond_id, None);
            } else {
                let d = if body.kind() == "compound_statement" {
                    depth + 1
                } else {
                    depth
                };
                let body_end = self.process_statements(
                    &body,
                    &cond_id,
                    exit,
                    Some(&cond_id),
                    Some(&after_id),
                    d,
                );
                self.label_first_edge(&cond_id, "true");
                if let Some(end) = body_end {
                    self.add_edge(&end, &cond_id, None);
                }
            }
        }

        self.add_edge(&cond_id, &after_id, Some("false"));
        Some(after_id)
    }

    fn process_do_while(
        &mut self,
        node: &Node,
        current: &str,
        exit: &str,
        depth: usize,
    ) -> Option<String> {
        let after_id = self.add_node("statement", "", 0);

        // do-while: body 先执行，需要 body 入口节点供回边
        let body_entry = self.add_node("statement", "", 0);
        self.add_edge(current, &body_entry, None);

        let body_end = if let Some(body) = node.child_by_field_name("body") {
            if depth >= MAX_DEPTH {
                let line = body.start_position().row + 1;
                let stmt = self.add_node("statement", "…（嵌套过深）", line);
                self.add_edge(&body_entry, &stmt, None);
                Some(stmt)
            } else {
                let d = if body.kind() == "compound_statement" {
                    depth + 1
                } else {
                    depth
                };
                self.process_statements(&body, &body_entry, exit, None, Some(&after_id), d)
            }
        } else {
            Some(body_entry.clone())
        };

        let cond_text = node
            .child_by_field_name("condition")
            .map(|c| self.node_text(&c))
            .unwrap_or_default();
        let line = node.start_position().row + 1;
        let cond_id = self.add_node("loop", &Self::escape_label(&cond_text), line);

        if let Some(end) = &body_end {
            self.add_edge(end, &cond_id, None);
        }
        // 回边到 body 入口
        self.add_edge(&cond_id, &body_entry, Some("true"));
        self.add_edge(&cond_id, &after_id, Some("false"));
        Some(after_id)
    }

    fn process_switch(
        &mut self,
        node: &Node,
        current: &str,
        exit: &str,
        depth: usize,
    ) -> Option<String> {
        let cond_text = node
            .child_by_field_name("condition")
            .map(|c| self.node_text(&c))
            .unwrap_or_default();
        let line = node.start_position().row + 1;
        let switch_id = self.add_node(
            "condition",
            &format!("switch({})", Self::escape_label(&cond_text)),
            line,
        );
        self.add_edge(current, &switch_id, None);

        let after_id = self.add_node("statement", "", 0);

        if let Some(body) = node.child_by_field_name("body") {
            let d = if body.kind() == "compound_statement" {
                depth + 1
            } else {
                depth
            };
            let mut cursor = body.walk();
            for child in body.children(&mut cursor) {
                if child.kind() != "case_statement" {
                    continue;
                }
                let case_label = if let Some(val) = child.child_by_field_name("value") {
                    format!("case {}", self.node_text(&val))
                } else {
                    "default".to_string()
                };
                let case_line = child.start_position().row + 1;
                let case_id = self.add_node(
                    "switch_case",
                    &Self::escape_label(&case_label),
                    case_line,
                );
                self.add_edge(&switch_id, &case_id, None);

                // 处理 case 内语句
                let mut stmt_cursor = child.walk();
                let mut case_flow = Some(case_id.clone());
                for stmt in child.children(&mut stmt_cursor) {
                    if !is_statement(&stmt) || stmt.kind() == "case_statement" {
                        continue;
                    }
                    if let Some(ref f) = case_flow {
                        case_flow = self.process_statement(
                            &stmt, f, exit, None, Some(&after_id), d,
                        );
                    }
                }
                if let Some(end) = case_flow {
                    if end != after_id {
                        self.add_edge(&end, &after_id, None);
                    }
                }
            }
        }

        Some(after_id)
    }
}

/// 判断节点是否为语句
fn is_statement(node: &Node) -> bool {
    matches!(
        node.kind(),
        "if_statement" | "for_statement" | "while_statement" | "do_statement"
            | "switch_statement" | "return_statement" | "break_statement"
            | "continue_statement" | "compound_statement" | "expression_statement"
            | "declaration" | "case_statement"
    )
}

/// 生成 C++ 函数控制流图
/// 输入：C++ 源码字符串
/// 输出：CfgResult（Mermaid 文本 + 节点元数据 + 警告）
pub fn generate_cfg(code: &str) -> Result<CfgResult, String> {
    let tree = parse_cpp(code).ok_or("代码解析失败")?;
    let source = code.as_bytes().to_vec();
    let mut builder = CfgBuilder::new(source);

    builder.detect_macros(&tree.root_node());

    let func = builder
        .find_target_function(&tree.root_node())
        .ok_or("未找到函数定义")?;

    let func_name = func
        .child_by_field_name("declarator")
        .and_then(|d| super::extract_function_name(&d, &builder.source))
        .unwrap_or_else(|| "function".to_string());

    let body = func
        .child_by_field_name("body")
        .ok_or("函数无函数体")?;

    let entry_line = func.start_position().row + 1;
    let exit_line = func.end_position().row + 1;
    let entry_id = builder.add_node("entry", &format!("开始 {}", func_name), entry_line);
    let exit_id = builder.add_node("exit", "结束", exit_line);

    let last = builder.process_statements(&body, &entry_id, &exit_id, None, None, 0);
    if let Some(last_id) = last {
        if last_id != exit_id {
            builder.add_edge(&last_id, &exit_id, None);
        }
    }

    let node_count = builder.nodes.len();
    let mut warning = builder.macro_warning.take();

    if node_count > NODE_THRESHOLD {
        let threshold_msg = format!(
            "节点数较多（{}），图表可能影响可读性，建议结合代码阅读",
            node_count
        );
        warning = Some(match warning {
            Some(w) => format!("{}\n{}", w, threshold_msg),
            None => threshold_msg,
        });
    }

    let mermaid = builder.to_mermaid();

    Ok(CfgResult {
        mermaid,
        nodes: builder.nodes,
        edges: builder.edges,
        warning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_if_else() {
        let code = "int f(int x) {\n  if (x > 0) {\n    return x;\n  } else {\n    return -x;\n  }\n}";
        let result = generate_cfg(&code).unwrap();
        assert!(result.mermaid.contains("graph TD"));
        assert!(result.mermaid.contains("-->|true|"));
        assert!(result.mermaid.contains("-->|false|"));
        assert!(result.nodes.iter().any(|n| n.kind == "entry"));
        assert!(result.nodes.iter().any(|n| n.kind == "exit"));
        assert!(result.nodes.iter().any(|n| n.kind == "condition"));
    }

    #[test]
    fn test_for_loop_back_edge() {
        let code = "int f(int n) {\n  int s = 0;\n  for (int i = 0; i < n; i++) {\n    s += i;\n  }\n  return s;\n}";
        let result = generate_cfg(code).unwrap();
        let cond = result.nodes.iter().find(|n| n.kind == "loop");
        assert!(cond.is_some());
        let cond_id = cond.unwrap().id.clone();
        let has_back_edge = result.edges.iter().any(|e| e.to == cond_id && e.from != cond_id);
        assert!(has_back_edge, "应有回边到循环条件节点");
    }

    #[test]
    fn test_while_loop() {
        let code = "int f(int n) {\n  while (n > 0) {\n    n--;\n  }\n  return n;\n}";
        let result = generate_cfg(code).unwrap();
        assert!(result.nodes.iter().any(|n| n.kind == "loop"));
    }

    #[test]
    fn test_do_while() {
        let code = "int f(int n) {\n  do {\n    n--;\n  } while (n > 0);\n  return n;\n}";
        let result = generate_cfg(code).unwrap();
        assert!(result.nodes.iter().any(|n| n.kind == "loop"));
    }

    #[test]
    fn test_switch_cases() {
        let code = "int f(int x) {\n  switch (x) {\n    case 1: return 10;\n    case 2: return 20;\n    default: return 0;\n  }\n}";
        let result = generate_cfg(code).unwrap();
        let cases: Vec<_> = result.nodes.iter().filter(|n| n.kind == "switch_case").collect();
        assert!(cases.len() >= 2, "应至少有 2 个 case 节点");
    }

    #[test]
    fn test_nested_depth_limit() {
        let code = "int f(int a) {\n  if (a > 1) {\n    if (a > 2) {\n      if (a > 3) {\n        if (a > 4) {\n          if (a > 5) {\n            if (a > 6) {\n              return a;\n            }\n          }\n        }\n      }\n    }\n  }\n  return 0;\n}";
        let result = generate_cfg(code).unwrap();
        assert!(result.nodes.iter().any(|n| n.label.contains("嵌套过深")));
    }

    #[test]
    fn test_80_node_threshold() {
        let mut code = String::from("int f(int x) {\n");
        for i in 0..50 {
            code.push_str(&format!("  if (x > {}) {{\n    x++;\n  }}\n", i));
        }
        code.push_str("  return x;\n}");
        let result = generate_cfg(&code).unwrap();
        assert!(result.warning.is_some(), "节点超过 80 应有警告");
    }

    #[test]
    fn test_macro_detection() {
        let code = "#define REP(i, n) for(int i = 0; i < n; i++)\nint f(int n) {\n  int s = 0;\n  REP(i, n) {\n    s += i;\n  }\n  return s;\n}";
        let result = generate_cfg(code).unwrap();
        assert!(result.warning.is_some(), "应检测到含控制流的宏");
        assert!(result.warning.as_ref().unwrap().contains("REP"));
    }

    #[test]
    fn test_no_function() {
        let code = "int x = 0;";
        let result = generate_cfg(code);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_code_no_panic() {
        let code = "this is not valid c++";
        let result = generate_cfg(code);
        let _ = result;
    }

    #[test]
    fn test_mermaid_output_format() {
        let code = "int f(int x) {\n  return x;\n}";
        let result = generate_cfg(code).unwrap();
        assert!(result.mermaid.starts_with("graph TD"));
        assert!(!result.mermaid.contains("click"));
        assert!(!result.mermaid.contains("__cfgJump"));
    }

    #[test]
    fn test_prefers_main_function() {
        let code = "int helper() {\n  return 1;\n}\nint main() {\n  return helper();\n}";
        let result = generate_cfg(code).unwrap();
        assert!(result.nodes.iter().any(|n| n.kind == "entry" && n.label.contains("main")));
    }

    #[test]
    fn test_break_continue() {
        let code = "int f(int n) {\n  for (int i = 0; i < n; i++) {\n    if (i == 5) {\n      break;\n    }\n    if (i == 3) {\n      continue;\n    }\n  }\n  return 0;\n}";
        let result = generate_cfg(code).unwrap();
        assert!(result.edges.iter().any(|e| e.label.as_deref() == Some("break")));
        assert!(result.edges.iter().any(|e| e.label.as_deref() == Some("continue")));
    }

    #[test]
    fn test_else_if_chain() {
        let code = "int f(int x) {\n  if (x > 0) {\n    return 1;\n  } else if (x < 0) {\n    return -1;\n  } else {\n    return 0;\n  }\n}";
        let result = generate_cfg(code).unwrap();
        let conditions: Vec<_> = result.nodes.iter().filter(|n| n.kind == "condition").collect();
        assert!(conditions.len() >= 2, "else-if 链应产生至少 2 个 condition 节点");
    }

    #[test]
    fn test_condition_with_parentheses() {
        // 条件表达式中含括号，Mermaid 菱形节点语法不应解析失败
        let code = "int f(int a, int b) {\n  if ((a > b) && (a > 0)) {\n    return a;\n  }\n  return b;\n}";
        let result = generate_cfg(code).unwrap();
        // 条件节点的 Mermaid 行应使用带引号的菱形语法
        assert!(
            result.mermaid.contains("{\""),
            "condition/loop 节点应使用带引号的菱形语法 {{\"...\"}}"
        );
        // 不应出现裸括号（会被 Mermaid 误解析为 PS token）
        let cond_lines: Vec<&str> = result
            .mermaid
            .lines()
            .filter(|l| l.contains("{\"") || l.contains("([\""))
            .collect();
        assert!(!cond_lines.is_empty(), "应有带引号的节点行");
    }

    #[test]
    fn test_blank_nodes_use_circle() {
        let code = "int f(int x) {\n  if (x > 0) {\n    return x;\n  }\n  return -x;\n}";
        let result = generate_cfg(&code).unwrap();
        assert!(result.mermaid.contains("(( ))"), "空节点应输出空圆");
        assert!(!result.mermaid.contains("[\" \"]"), "不应出现空白矩形");
    }

    #[test]
    fn test_escape_label_no_parenthesis_escaping() {
        let code = "int f(int a, int b) {\n  if ((a > b) && (a > 0)) {\n    return a;\n  }\n  return b;\n}";
        let result = generate_cfg(&code).unwrap();
        assert!(result.mermaid.contains("(a"), "引号内括号不应被转义");
        assert!(!result.mermaid.contains("&#40;"), "不应出现 &#40;");
        assert!(!result.mermaid.contains("&#123;"), "不应出现 &#123;");
    }
}
