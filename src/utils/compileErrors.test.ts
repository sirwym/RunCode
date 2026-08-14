import { describe, it, expect } from "vitest";
import { parseGccErrors, translateGccError, translateGccWarning, formatStderrWithTranslation } from "./compileErrors";

describe("parseGccErrors", () => {
  it("解析标准 g++ error 行（translated 匹配作用域规则）", () => {
    const stderr = "main.cpp:3:5: error: 'cout' was not declared in this scope";
    const errors = parseGccErrors(stderr);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      line: 3,
      column: 5,
      message: "'cout' was not declared in this scope",
      translated: "标识符未在当前作用域内声明（变量/函数未定义或作用域不对）",
    });
  });

  it("解析多个 error 行（每行独立匹配翻译规则）", () => {
    const stderr = [
      "main.cpp:3:5: error: 'cout' was not declared in this scope",
      "main.cpp:4:12: error: expected ';' before '}' token",
    ].join("\n");
    const errors = parseGccErrors(stderr);
    expect(errors).toHaveLength(2);
    expect(errors[0].line).toBe(3);
    expect(errors[0].translated).toBe("标识符未在当前作用域内声明（变量/函数未定义或作用域不对）");
    expect(errors[1].line).toBe(4);
    expect(errors[1].translated).toBe("缺少分号 ';'");
  });

  it("忽略 note 和 warning 行", () => {
    const stderr = [
      "main.cpp:3:5: error: 'cout' was not declared in this scope",
      "main.cpp:2:1: note: 'std::cout' declared here",
      "main.cpp:5:1: warning: unused variable 'x' [-Wunused-variable]",
    ].join("\n");
    const errors = parseGccErrors(stderr);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(3);
  });

  it("匹配 fatal error", () => {
    const stderr = "main.cpp:1:10: fatal error: iostream.h: No such file or directory";
    const errors = parseGccErrors(stderr);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
    expect(errors[0].message).toBe("iostream.h: No such file or directory");
  });

  it("无 error 的 stderr 返回空数组", () => {
    expect(parseGccErrors("some random text\nno errors here")).toEqual([]);
  });

  it("空字符串返回空数组", () => {
    expect(parseGccErrors("")).toEqual([]);
  });

  it("兼容 Windows 路径含盘符", () => {
    const stderr = "C:\\path\\main.cpp:7:1: error: expected '}' at end of input";
    const errors = parseGccErrors(stderr);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(7);
    expect(errors[0].column).toBe(1);
  });

  it("兼容 CRLF 换行", () => {
    const stderr = "main.cpp:3:5: error: msg\r\nmain.cpp:4:1: error: msg2\r\n";
    const errors = parseGccErrors(stderr);
    expect(errors).toHaveLength(2);
  });

  it("未匹配翻译规则的错误 translated 为 null", () => {
    const stderr = "main.cpp:3:5: error: some unknown error message";
    const errors = parseGccErrors(stderr);
    expect(errors).toHaveLength(1);
    expect(errors[0].translated).toBeNull();
  });

  it("每个 error 对象包含 translated 字段", () => {
    const stderr = "main.cpp:3:5: error: expected ';' before '}' token";
    const errors = parseGccErrors(stderr);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toHaveProperty("translated");
    expect(typeof errors[0].translated).toBe("string");
  });
});

describe("translateGccError", () => {
  it("匹配 expected ';' → 返回中文分号提示", () => {
    expect(translateGccError("expected ';' before '}' token")).toBe("缺少分号 ';'");
  });

  it("匹配 was not declared in this scope → 返回中文作用域说明", () => {
    expect(translateGccError("'x' was not declared in this scope")).toBe(
      "标识符未在当前作用域内声明（变量/函数未定义或作用域不对）"
    );
  });

  it("匹配 undeclared identifier → 返回中文未声明说明", () => {
    expect(translateGccError("undeclared identifier 'foo'")).toBe(
      "使用了未声明的标识符（变量/函数名未定义或拼写错误）"
    );
  });

  it("匹配 expected ')' → 返回中文右括号提示", () => {
    expect(translateGccError("expected ')' before ';' token")).toBe("缺少右括号 ')'");
  });

  it("匹配 expected '}' → 返回中文右花括号提示", () => {
    expect(translateGccError("expected '}' at end of input")).toBe("缺少右花括号 '}'");
  });

  it("匹配 no matching function for call → 返回中文重载说明", () => {
    expect(translateGccError("no matching function for call to 'foo()'")).toBe(
      "没有匹配的函数重载（参数类型或数量不匹配）"
    );
  });

  it("匹配 redefinition of → 返回中文重复定义说明", () => {
    expect(translateGccError("redefinition of 'int main()'")).toBe("重复定义（同一名称定义了多次）");
  });

  // ========== 本次新增 error 规则测试 ==========

  it("匹配 unexpected character <U+XXXX>（clang 中文符号）→ 返回中文全角符号提示", () => {
    expect(translateGccError("unexpected character <U+300A>")).toBe(
      "代码中混入了中文全角符号（如 ，；（）《〈等），请检查附近代码，用英文符号替换"
    );
  });

  it("匹配 invalid character（GCC 中文符号）→ 返回中文全角符号提示", () => {
    expect(translateGccError("invalid character in input")).toBe(
      "代码中混入了中文全角符号或非法字符（如 ，；（）《〈等），请检查附近代码，用英文符号替换"
    );
  });

  it("匹配 stray '\\XXX' in program（GCC 中文符号八进制转义形式）→ 返回中文全角符号提示", () => {
    expect(translateGccError("stray '\\343' in program")).toBe(
      "代码中混入了中文全角符号或非法字符（如 ，；（）《〈等），请检查附近代码，用英文符号替换"
    );
  });

  it("匹配 stray '\\xXX' in program（GCC 中文符号十六进制转义形式）→ 返回中文全角符号提示", () => {
    expect(translateGccError("stray '\\xe3' in program")).toBe(
      "代码中混入了中文全角符号或非法字符（如 ，；（）《〈等），请检查附近代码，用英文符号替换"
    );
  });

  it("匹配 expected expression（clang 缺表达式）→ 返回中文缺表达式提示", () => {
    expect(translateGccError("expected expression")).toBe(
      "缺少表达式（可能是括号不匹配、运算符误用或中文符号干扰）"
    );
  });

  it("匹配 'main' must return 'int' → 返回中文 main 返回值提示", () => {
    expect(translateGccError("'main' must return 'int'")).toBe(
      "main 函数必须返回 int（老式 main(){} 写法不合法，应写 int main()）"
    );
  });

  it("匹配 variable-length array → 返回中文 VLA 提示", () => {
    expect(translateGccError("variable-length array 'a' declared")).toBe(
      "使用了变长数组 VLA（数组大小用变量，非标准 C++，本地能跑但 OJ 可能报错，建议用 vector 或开大静态数组）"
    );
  });

  it("匹配 No such file or directory → 返回中文头文件不存在提示", () => {
    expect(translateGccError("iostream.h: No such file or directory")).toBe(
      "头文件不存在（检查文件名拼写，标准 C++ 头文件不带 .h，如 #include<iostream>）"
    );
  });

  it("匹配 expected constructor, destructor, or type conversion → 返回中文全局域执行语句提示", () => {
    expect(translateGccError("expected constructor, destructor, or type conversion before ';' token")).toBe(
      "缺少构造/析构/类型转换（可能是函数外写了执行语句，全局域只能初始化不能执行语句）"
    );
  });

  it("未匹配规则 → 返回 null", () => {
    expect(translateGccError("some unknown error")).toBeNull();
  });

  it("空字符串 → 返回 null", () => {
    expect(translateGccError("")).toBeNull();
  });
});

describe("translateGccWarning", () => {
  it("匹配 unused variable → 返回中文未使用说明", () => {
    expect(translateGccWarning("unused variable 'x' [-Wunused-variable]")).toBe(
      "变量已声明但未使用（如不需要可删除，或用 (void)变量名; 显式忽略）"
    );
  });

  it("匹配 control reaches end of non-void function → 返回中文返回值说明", () => {
    expect(translateGccWarning("control reaches end of non-void function")).toBe(
      "非 void 函数可能有路径没有返回值（检查所有分支是否都有 return）"
    );
  });

  it("匹配 comparison between signed and unsigned → 返回中文类型比较说明", () => {
    expect(translateGccWarning("comparison between signed and unsigned integer expressions [-Wsign-compare]")).toBe(
      "有符号数与无符号数比较（建议统一类型，避免逻辑错误）"
    );
  });

  it("自动去除 [-W...] 选项标记后匹配", () => {
    expect(translateGccWarning("unused parameter 'argc' [-Wunused-parameter]")).toBe(
      "函数参数未使用（如不需要可删除参数，或用 (void)参数名; 忽略）"
    );
  });

  it("无 [-W...] 选项标记的 warning 也能匹配", () => {
    expect(translateGccWarning("unused variable 'x'")).toBe(
      "变量已声明但未使用（如不需要可删除，或用 (void)变量名; 显式忽略）"
    );
  });

  // ========== 本次新增 warning 规则测试 ==========

  it("匹配 missing terminating \" character → 返回中文字符串缺引号提示", () => {
    expect(translateGccWarning("missing terminating \" character [-Winvalid-pp-token]")).toBe(
      "字符串缺少结束的双引号 \"（检查本行是否有未闭合的 \"）"
    );
  });

  it("匹配 missing terminating ' character → 返回中文字符常量缺引号提示", () => {
    expect(translateGccWarning("missing terminating ' character")).toBe(
      "字符常量缺少结束的单引号 '（检查本行是否有未闭合的 '）"
    );
  });

  it("匹配 expression result unused → 返回中文表达式未使用提示", () => {
    expect(translateGccWarning("expression result unused [-Wunused-value]")).toBe(
      "表达式结果未使用（可能是误用了中文符号导致语句结构异常，检查附近符号）"
    );
  });

  it("未匹配规则 → 返回 null", () => {
    expect(translateGccWarning("some unknown warning [-Wunknown]")).toBeNull();
  });

  it("空字符串 → 返回 null", () => {
    expect(translateGccWarning("")).toBeNull();
  });
});

describe("formatStderrWithTranslation", () => {
  it("error 行后追加译文行（方案 A）", () => {
    const stderr = "main.cpp:3:5: error: expected ';' before '}' token";
    const result = formatStderrWithTranslation(stderr);
    expect(result).toBe(
      "main.cpp:3:5: error: expected ';' before '}' token\n  \u21B3 缺少分号 ';'"
    );
  });

  it("warning 行后追加译文行", () => {
    const stderr = "main.cpp:3:5: warning: unused variable 'x' [-Wunused-variable]";
    const result = formatStderrWithTranslation(stderr);
    expect(result).toBe(
      "main.cpp:3:5: warning: unused variable 'x' [-Wunused-variable]\n  \u21B3 变量已声明但未使用（如不需要可删除，或用 (void)变量名; 显式忽略）"
    );
  });

  it("note 行原样保留（不追加译文）", () => {
    const stderr = "main.cpp:2:1: note: 'std::cout' declared here";
    const result = formatStderrWithTranslation(stderr);
    expect(result).toBe("main.cpp:2:1: note: 'std::cout' declared here");
  });

  it("汇总行原样保留（不追加译文）", () => {
    const stderr = "1 error generated.";
    const result = formatStderrWithTranslation(stderr);
    expect(result).toBe("1 error generated.");
  });

  it("未匹配翻译规则的 error 行不追加译文行", () => {
    const stderr = "main.cpp:3:5: error: some unknown error message";
    const result = formatStderrWithTranslation(stderr);
    expect(result).toBe("main.cpp:3:5: error: some unknown error message");
  });

  it("未匹配翻译规则的 warning 行不追加译文行", () => {
    const stderr = "main.cpp:3:5: warning: some unknown warning [-Wunknown]";
    const result = formatStderrWithTranslation(stderr);
    expect(result).toBe("main.cpp:3:5: warning: some unknown warning [-Wunknown]");
  });

  it("完整 stderr（error + warning + note + 汇总）按顺序输出", () => {
    const stderr = [
      "main.cpp:3:5: warning: unused variable 'x' [-Wunused-variable]",
      "main.cpp:5:12: error: expected ';' before '}' token",
      "main.cpp:2:1: note: 'std::cout' declared here",
      "1 error generated.",
    ].join("\n");
    const result = formatStderrWithTranslation(stderr);
    expect(result).toBe([
      "main.cpp:3:5: warning: unused variable 'x' [-Wunused-variable]",
      "  \u21B3 变量已声明但未使用（如不需要可删除，或用 (void)变量名; 显式忽略）",
      "main.cpp:5:12: error: expected ';' before '}' token",
      "  \u21B3 缺少分号 ';'",
      "main.cpp:2:1: note: 'std::cout' declared here",
      "1 error generated.",
    ].join("\n"));
  });

  // ========== 真实样本端到端测试（用户提供的实际编译错误） ==========

  it("真实样本1：字符串缺结束引号 + expected expression", () => {
    // 用户提供的真实编译错误：cout << "Hello, RunCode!; 漏了 "
    const stderr = [
      "main.cpp:5:13: warning: missing terminating \" character [-Winvalid-pp-token]",
      "    cout << \"Hello, RunCode!;",
      "            ^",
      "main.cpp:5:13: error: expected expression",
      "1 warning and 1 error generated.",
    ].join("\n");
    const result = formatStderrWithTranslation(stderr);
    expect(result).toBe([
      "main.cpp:5:13: warning: missing terminating \" character [-Winvalid-pp-token]",
      "  \u21B3 字符串缺少结束的双引号 \"（检查本行是否有未闭合的 \"）",
      "    cout << \"Hello, RunCode!;",
      "            ^",
      "main.cpp:5:13: error: expected expression",
      "  \u21B3 缺少表达式（可能是括号不匹配、运算符误用或中文符号干扰）",
      "1 warning and 1 error generated.",
    ].join("\n"));
  });

  it("真实样本2：中文书名号 + expression result unused + 缺分号", () => {
    // 用户提供的真实编译错误：cout 《〈 "Hello, RunCode!"; 误用中文书名号
    // 注：用户终端复制的样本含已有译文行，此处还原为编译器原始 stderr（不含译文）
    const stderr = [
      "main.cpp:5:10: error: unexpected character <U+300A>",
      "    cout 《〈 \"Hello, RunCode!\";",
      "         ^~",
      "main.cpp:5:13: error: unexpected character <U+3008>",
      "    cout 《〈 \"Hello, RunCode!\";",
      "           ^~",
      "main.cpp:5:9: error: expected ';' after expression",
      "    cout 《〈 \"Hello, RunCode!\";",
      "        ^",
      "        ;",
      "main.cpp:5:5: warning: expression result unused [-Wunused-value]",
      "    cout 《〈 \"Hello, RunCode!\";",
      "    ^~~~",
      "main.cpp:5:17: warning: expression result unused [-Wunused-value]",
      "    cout 《〈 \"Hello, RunCode!\";",
      "              ^~~~~~~~~~~~~~~~~",
      "2 warnings and 3 errors generated.",
    ].join("\n");
    const result = formatStderrWithTranslation(stderr);
    expect(result).toBe([
      "main.cpp:5:10: error: unexpected character <U+300A>",
      "  \u21B3 代码中混入了中文全角符号（如 ，；（）《〈等），请检查附近代码，用英文符号替换",
      "    cout 《〈 \"Hello, RunCode!\";",
      "         ^~",
      "main.cpp:5:13: error: unexpected character <U+3008>",
      "  \u21B3 代码中混入了中文全角符号（如 ，；（）《〈等），请检查附近代码，用英文符号替换",
      "    cout 《〈 \"Hello, RunCode!\";",
      "           ^~",
      "main.cpp:5:9: error: expected ';' after expression",
      "  \u21B3 缺少分号 ';'",
      "    cout 《〈 \"Hello, RunCode!\";",
      "        ^",
      "        ;",
      "main.cpp:5:5: warning: expression result unused [-Wunused-value]",
      "  \u21B3 表达式结果未使用（可能是误用了中文符号导致语句结构异常，检查附近符号）",
      "    cout 《〈 \"Hello, RunCode!\";",
      "    ^~~~",
      "main.cpp:5:17: warning: expression result unused [-Wunused-value]",
      "  \u21B3 表达式结果未使用（可能是误用了中文符号导致语句结构异常，检查附近符号）",
      "    cout 《〈 \"Hello, RunCode!\";",
      "              ^~~~~~~~~~~~~~~~~",
      "2 warnings and 3 errors generated.",
    ].join("\n"));
  });

  it("空字符串返回空字符串", () => {
    expect(formatStderrWithTranslation("")).toBe("");
  });

  it("CRLF 换行兼容（输入按 \\r\\n 分割，输出用 \\n，保留末尾换行）", () => {
    const stderr = "main.cpp:3:5: error: expected ';' before '}' token\r\n1 error generated.\r\n";
    const result = formatStderrWithTranslation(stderr);
    expect(result).toBe(
      "main.cpp:3:5: error: expected ';' before '}' token\n  \u21B3 缺少分号 ';'\n1 error generated.\n"
    );
  });

  it("输出行尾为 \\n（非 \\r\\n），由调用方 normalizeEol 统一转换", () => {
    const stderr = "main.cpp:3:5: error: expected ';' before '}' token";
    const result = formatStderrWithTranslation(stderr);
    expect(result).not.toContain("\r\n");
    expect(result).toContain("\n");
  });
});
