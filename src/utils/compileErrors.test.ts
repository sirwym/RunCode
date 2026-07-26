import { describe, it, expect } from "vitest";
import { parseGccErrors } from "./compileErrors";

describe("parseGccErrors", () => {
  it("解析标准 g++ error 行", () => {
    const stderr = "main.cpp:3:5: error: 'cout' was not declared in this scope";
    const errors = parseGccErrors(stderr);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      line: 3,
      column: 5,
      message: "'cout' was not declared in this scope",
    });
  });

  it("解析多个 error 行", () => {
    const stderr = [
      "main.cpp:3:5: error: 'cout' was not declared in this scope",
      "main.cpp:4:12: error: expected ';' before '}' token",
    ].join("\n");
    const errors = parseGccErrors(stderr);
    expect(errors).toHaveLength(2);
    expect(errors[0].line).toBe(3);
    expect(errors[1].line).toBe(4);
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
});
