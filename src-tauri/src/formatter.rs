use std::io::Write;
use std::process::{Command, Stdio};

use which::which;

use crate::error::AppError;
use crate::parser::formatter::TreeSitterFormatter;

/// 格式化结果（带 backend 标记）
#[derive(Debug, Clone, serde::Serialize)]
pub struct FormatResult {
    pub code: String,
    /// 实际使用的格式化引擎：clang-format | builtin
    pub backend: String,
}

/// 格式化集成：三级回退
/// 1. 系统 clang-format 优先（最准确）
/// 2. 回退到 tree-sitter 内置格式化（覆盖 80% 场景）
/// 3. 格式化失败返回原始代码（保证不丢失）
pub struct Formatter;

impl Formatter {
    /// 探测系统 clang-format 路径，未安装返回 None
    fn detect_clang_format() -> Option<std::path::PathBuf> {
        which("clang-format").ok()
    }

    /// 格式化代码（三级回退）
    /// style: "LLVM" / "Google" / "Microsoft" / "WebKit" / "GNU"（仅 clang-format 生效）
    pub fn format(code: &str, style: &str) -> FormatResult {
        // 1. 系统 clang-format 优先
        if let Some(bin) = Self::detect_clang_format() {
            match Self::format_with_clang(&bin, code, style) {
                Ok(formatted) => {
                    return FormatResult {
                        code: formatted,
                        backend: "clang-format".into(),
                    };
                }
                Err(e) => {
                    // clang-format 失败，回退到内置
                    eprintln!("clang-format 失败，回退到内置格式化: {e}");
                }
            }
        }

        // 2. 内置 tree-sitter 格式化
        let formatted = TreeSitterFormatter::format(code);
        FormatResult {
            code: formatted,
            backend: "builtin".into(),
        }
    }

    /// 调用系统 clang-format
    fn format_with_clang(
        bin: &std::path::Path,
        code: &str,
        style: &str,
    ) -> Result<String, AppError> {
        let mut child = Command::new(bin)
            .arg(format!("--style={{{style}}}"))
            .arg("--assume-filename=main.cpp")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(code.as_bytes())?;
        }

        let output = child.wait_with_output()?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Other {
                detail: format!("clang-format 失败: {stderr}"),
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_returns_backend() {
        let result = Formatter::format("int main(){return 0;}", "LLVM");
        // 无论用哪个引擎，都应返回 backend 字段
        assert!(result.backend == "clang-format" || result.backend == "builtin");
        assert!(!result.code.is_empty());
    }

    #[test]
    fn format_builtin_fixes_indentation() {
        let result = Formatter::format("int main(){\nreturn 0;\n}", "LLVM");
        if result.backend == "builtin" {
            assert!(
                result.code.contains("    return 0;"),
                "内置格式化应修复缩进，实际: {}",
                result.code
            );
        }
    }

    #[test]
    fn format_never_loses_code() {
        // 即使输入奇怪的代码，格式化结果也不应为空
        let code = "int main(){return 0;}";
        let result = Formatter::format(code, "LLVM");
        assert!(!result.code.is_empty(), "格式化结果不应为空");
    }
}
