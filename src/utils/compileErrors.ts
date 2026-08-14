import type { CompileError } from "../types";

// g++ 错误行格式：文件名:行号:列号: error: 描述
// 示例：main.cpp:3:5: error: 'cout' was not declared in this scope
// note / warning 行不匹配（仅定位 error / fatal error）
const GCC_ERROR_RE = /^(.+):(\d+):(\d+):\s*(?:fatal error|error):\s*(.+)$/;

// g++ warning 行格式：文件名:行号:列号: warning: 描述 [-W选项]
// 示例：main.cpp:3:5: warning: unused variable 'x' [-Wunused-variable]
const GCC_WARNING_RE = /^(.+):(\d+):(\d+):\s*warning:\s*(.+)$/;

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
  { pattern: /expected expression/, translation: "缺少表达式（可能是括号不匹配、运算符误用或中文符号干扰）" },
  { pattern: /redefinition of/, translation: "重复定义（同一名称定义了多次）" },
  { pattern: /conflicting declaration/, translation: "声明冲突（同名变量/函数声明类型不一致）" },
  { pattern: /no return statement/, translation: "函数缺少 return 语句（非 void 函数必须返回值）" },
  { pattern: /expected initializer/, translation: "缺少初始化值（可能是赋值语法错误）" },
  { pattern: /expected type-specifier/, translation: "缺少类型说明符（如 int/char 等关键字缺失或拼写错误）" },
  // 中文全角符号（OI 头号杀手）：clang 报 unexpected character <U+XXXX>，GCC 报 invalid character / stray '\XXX'
  { pattern: /unexpected character/, translation: "代码中混入了中文全角符号（如 ，；（）《〈等），请检查附近代码，用英文符号替换" },
  { pattern: /invalid character/, translation: "代码中混入了中文全角符号或非法字符（如 ，；（）《〈等），请检查附近代码，用英文符号替换" },
  { pattern: /stray '\\[x0-9a-fA-F]+' in program/, translation: "代码中混入了中文全角符号或非法字符（如 ，；（）《〈等），请检查附近代码，用英文符号替换" },
  { pattern: /'main' must return 'int'/, translation: "main 函数必须返回 int（老式 main(){} 写法不合法，应写 int main()）" },
  { pattern: /variable-length array/, translation: "使用了变长数组 VLA（数组大小用变量，非标准 C++，本地能跑但 OJ 可能报错，建议用 vector 或开大静态数组）" },
  { pattern: /No such file or directory/, translation: "头文件不存在（检查文件名拼写，标准 C++ 头文件不带 .h，如 #include<iostream>）" },
  { pattern: /expected constructor, destructor, or type conversion/, translation: "缺少构造/析构/类型转换（可能是函数外写了执行语句，全局域只能初始化不能执行语句）" },
];

// warning 教学化翻译规则（按匹配优先级排序，首个命中即用）
// 描述部分已去掉 [-W...] 选项标记
const TRANSLATION_WARNING_RULES: TranslationRule[] = [
  { pattern: /unused variable/, translation: "变量已声明但未使用（如不需要可删除，或用 (void)变量名; 显式忽略）" },
  { pattern: /unused parameter/, translation: "函数参数未使用（如不需要可删除参数，或用 (void)参数名; 忽略）" },
  { pattern: /unused but set variable/, translation: "变量已赋值但从未使用（可能是中间变量多余，或忘记读取）" },
  { pattern: /control reaches end of non-void function/, translation: "非 void 函数可能有路径没有返回值（检查所有分支是否都有 return）" },
  { pattern: /comparison between signed and unsigned/, translation: "有符号数与无符号数比较（建议统一类型，避免逻辑错误）" },
  { pattern: /format .* expects type/, translation: "printf/scanf 格式符与参数类型不匹配（如 %d 对应 int，%lf 对应 double）" },
  { pattern: /implicit conversion/, translation: "隐式类型转换可能丢失精度（建议显式转换）" },
  { pattern: /suggest parentheses around/, translation: "建议加括号明确运算优先级（避免歧义）" },
  { pattern: /deprecated/, translation: "使用了已弃用的语法（建议改用现代写法）" },
  { pattern: /multi-line comment/, translation: "多行注释可能有问题（/* */ 嵌套或未闭合）" },
  { pattern: /integer overflow in expression/, translation: "整数运算可能溢出（结果超出 int 范围）" },
  { pattern: /variable set but not used/, translation: "变量已赋值但未使用" },
  // 字符串/字符常量缺结束引号（少符号高频场景）
  { pattern: /missing terminating " character/, translation: "字符串缺少结束的双引号 \"（检查本行是否有未闭合的 \"）" },
  { pattern: /missing terminating ' character/, translation: "字符常量缺少结束的单引号 '（检查本行是否有未闭合的 '）" },
  // 表达式结果未使用（如误用中文符号导致整条 cout 表达式未被识别）
  { pattern: /expression result unused/, translation: "表达式结果未使用（可能是误用了中文符号导致语句结构异常，检查附近符号）" },
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

/// 从 warning 描述中去除末尾的 [-W...] 选项标记，返回纯描述。
/// 示例："unused variable 'x' [-Wunused-variable]" → "unused variable 'x'"
function stripWarningOption(message: string): string {
    return message.replace(/\s*\[-W[^\]]*\]\s*$/, "");
}

/**
 * 根据 warning 信息匹配翻译规则，返回中文解释（未匹配返回 null）
 * 输入应为去除 [-W...] 选项标记后的纯描述。
 * 纯函数，便于单元测试。
 */
export function translateGccWarning(message: string): string | null {
  const stripped = stripWarningOption(message);
  for (const rule of TRANSLATION_WARNING_RULES) {
    if (rule.pattern.test(stripped)) {
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

/// 译文行的前缀（2 空格 + 树状箭头 + 空格），与原文行视觉区分
const TRANSLATION_PREFIX = "  \u21B3 ";

/**
 * 格式化 g++ stderr，对 error 行和 warning 行追加中文译文（方案 A：原文下方独立行）。
 *
 * - error 行：匹配 GCC_ERROR_RE → 译文行追加在原文下方（translateGccError 命中时）
 * - warning 行：匹配 GCC_WARNING_RE → 译文行追加在原文下方（translateGccWarning 命中时）
 * - note 行、汇总行（"N errors generated."）、其他行：原样保留
 * - 译文行以 "  ↳ " 前缀缩进，与原文区分
 * - 不含 ANSI 颜色码（颜色由调用方 Terminal effect 控制）
 * - 行尾为 \n（非 \r\n，调用方通过 normalizeEol 统一转换）
 *
 * @param stderr - g++/clang 原始 stderr
 * @returns 格式化后的纯文本（可能含译文行）
 */
export function formatStderrWithTranslation(stderr: string): string {
  const lines = stderr.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    out.push(line);
    const errMatch = GCC_ERROR_RE.exec(line);
    if (errMatch) {
      const translated = translateGccError(errMatch[4]);
      if (translated) {
        out.push(TRANSLATION_PREFIX + translated);
      }
      continue;
    }
    const warnMatch = GCC_WARNING_RE.exec(line);
    if (warnMatch) {
      const translated = translateGccWarning(warnMatch[4]);
      if (translated) {
        out.push(TRANSLATION_PREFIX + translated);
      }
    }
  }
  return out.join("\n");
}
