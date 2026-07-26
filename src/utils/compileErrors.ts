import type { CompileError } from "../types";

// g++ 错误行格式：文件名:行号:列号: error: 描述
// 示例：main.cpp:3:5: error: 'cout' was not declared in this scope
// note / warning 行不匹配（仅定位 error / fatal error）
const GCC_ERROR_RE = /^(.+):(\d+):(\d+):\s*(?:fatal error|error):\s*(.+)$/;

/**
 * 解析 g++ stderr，提取 error / fatal error 行。
 * 纯函数，无副作用，便于单元测试。
 */
export function parseGccErrors(stderr: string): CompileError[] {
  const errors: CompileError[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const m = GCC_ERROR_RE.exec(line);
    if (m) {
      errors.push({
        line: parseInt(m[2], 10),
        column: parseInt(m[3], 10),
        message: m[4],
      });
    }
  }
  return errors;
}
