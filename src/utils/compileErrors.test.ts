import { describe, it, expect } from "vitest";
import { parseGccErrors, translateGccError } from "./compileErrors";

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

  it("未匹配规则 → 返回 null", () => {
    expect(translateGccError("some unknown error")).toBeNull();
  });

  it("空字符串 → 返回 null", () => {
    expect(translateGccError("")).toBeNull();
  });
});
