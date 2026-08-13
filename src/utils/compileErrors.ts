import type { CompileError } from "../types";

// g++ 错误行格式：文件名:行号:列号: error: 描述
// 示例：main.cpp:3:5: error: 'cout' was not declared in this scope
// note / warning 行不匹配（仅定位 error / fatal error）
const GCC_ERROR_RE = /^(.+):(\d+):(\d+):\s*(?:fatal error|error):\s*(.+)$/;

// 教学化翻译规则表（按匹配优先级排序，首个命中即用）
interface TranslationRule {
  pattern: RegExp;
  translation: string;
}

const TRANSLATION_RULES: TranslationRule[] = [
  { pattern: /expected ';'/, translation: "缺少分号 ';'" },
  { pattern: /expected '\)'/, translation: "缺少右括号 ')'" },
  { pattern: /expected '\}'/, translation: "缺少右花括号 '}'" },
  { pattern: /expected '\]'/, translation: "缺少右方括号 ']'" },
  { pattern: /expected '\('/, translation: "缺少左括号 '('" },
  { pattern: /undeclared identifier/, translation: "使用了未声明的标识符（变量/函数名未定义或拼写错误）" },
  { pattern: /was not declared in this scope/, translation: "标识符未在当前作用域内声明（变量/函数未定义或作用域不对）" },
  { pattern: /no matching function for call/, translation: "没有匹配的函数重载（参数类型或数量不匹配）" },
  { pattern: /invalid conversion from/, translation: "类型转换错误（隐式转换不合法，检查变量类型）" },
  { pattern: /expected primary-expression/, translation: "缺少表达式（可能是括号不匹配或运算符误用）" },
  { pattern: /redefinition of/, translation: "重复定义（同一名称定义了多次）" },
  { pattern: /conflicting declaration/, translation: "声明冲突（同名变量/函数声明类型不一致）" },
  { pattern: /no return statement/, translation: "函数缺少 return 语句（非 void 函数必须返回值）" },
  { pattern: /expected initializer/, translation: "缺少初始化值（可能是赋值语法错误）" },
  { pattern: /expected type-specifier/, translation: "缺少类型说明符（如 int/char 等关键字缺失或拼写错误）" },
];

/**
 * 根据错误信息匹配翻译规则，返回中文解释（未匹配返回 null）
 * 纯函数，便于单元测试。
 */
export function translateGccError(message: string): string | null {
  for (const rule of TRANSLATION_RULES) {
    if (rule.pattern.test(message)) {
      return rule.translation;
    }
  }
  return null;
}

/**
 * 解析 g++ stderr，提取 error / fatal error 行，附带中文翻译。
 * 纯函数，无副作用，便于单元测试。
 */
export function parseGccErrors(stderr: string): CompileError[] {
  const errors: CompileError[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const m = GCC_ERROR_RE.exec(line);
    if (m) {
      const message = m[4];
      errors.push({
        line: parseInt(m[2], 10),
        column: parseInt(m[3], 10),
        message,
        translated: translateGccError(message),
      });
    }
  }
  return errors;
}
