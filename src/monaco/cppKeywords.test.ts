import { describe, it, expect } from "vitest";
import { CPP_KEYWORDS_ALL, type KeywordKind } from "./cppKeywords";

describe("CPP_KEYWORDS_ALL", () => {
  it("数据源非空", () => {
    expect(CPP_KEYWORDS_ALL.length).toBeGreaterThan(50);
  });

  it("包含核心 C++ 关键词", () => {
    const labels = CPP_KEYWORDS_ALL.map((k) => k.label);
    const required = ["int", "double", "void", "const", "return", "if", "for", "while"];
    for (const label of required) {
      expect(labels).toContain(label);
    }
  });

  it("包含 STL 容器", () => {
    const labels = CPP_KEYWORDS_ALL.map((k) => k.label);
    const required = [
      "vector",
      "map",
      "unordered_map",
      "set",
      "queue",
      "stack",
      "string",
      "pair",
    ];
    for (const label of required) {
      expect(labels).toContain(label);
    }
  });

  it("包含 STL 算法", () => {
    const labels = CPP_KEYWORDS_ALL.map((k) => k.label);
    const required = ["sort", "lower_bound", "upper_bound", "max", "min", "unique"];
    for (const label of required) {
      expect(labels).toContain(label);
    }
  });

  it("包含常用 IO", () => {
    const labels = CPP_KEYWORDS_ALL.map((k) => k.label);
    const required = ["cin", "cout", "endl", "printf", "scanf"];
    for (const label of required) {
      expect(labels).toContain(label);
    }
  });

  it("每项都有 label/kind/detail", () => {
    for (const k of CPP_KEYWORDS_ALL) {
      expect(k.label).toBeTruthy();
      expect(k.kind).toBeTruthy();
      expect(k.detail).toBeTruthy();
    }
  });

  it("kind 取值在合法集合内", () => {
    const validKinds: KeywordKind[] = [
      "Keyword",
      "Class",
      "Function",
      "Variable",
      "Constant",
      "Module",
    ];
    for (const k of CPP_KEYWORDS_ALL) {
      expect(validKinds).toContain(k.kind);
    }
  });

  it("label 不重复", () => {
    const labels = CPP_KEYWORDS_ALL.map((k) => k.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("label 不含空格", () => {
    for (const k of CPP_KEYWORDS_ALL) {
      expect(k.label).not.toMatch(/\s/);
    }
  });

  it("vector 是 STL 容器（Class kind）", () => {
    const v = CPP_KEYWORDS_ALL.find((k) => k.label === "vector");
    expect(v).toBeDefined();
    expect(v!.kind).toBe("Class");
  });

  it("int 是关键词（Keyword kind）", () => {
    const i = CPP_KEYWORDS_ALL.find((k) => k.label === "int");
    expect(i).toBeDefined();
    expect(i!.kind).toBe("Keyword");
  });

  it("sort 是函数（Function kind）", () => {
    const s = CPP_KEYWORDS_ALL.find((k) => k.label === "sort");
    expect(s).toBeDefined();
    expect(s!.kind).toBe("Function");
  });

  it("cin 是变量（Variable kind）", () => {
    const c = CPP_KEYWORDS_ALL.find((k) => k.label === "cin");
    expect(c).toBeDefined();
    expect(c!.kind).toBe("Variable");
  });

  // ============== OI 扩展数据源 ==============

  it("包含 bits/stdc++.h 万能头", () => {
    const h = CPP_KEYWORDS_ALL.find((k) => k.label === "bits/stdc++.h");
    expect(h).toBeDefined();
    expect(h!.kind).toBe("Module");
  });

  it("包含 OI 常用头文件", () => {
    const labels = CPP_KEYWORDS_ALL.map((k) => k.label);
    const required = [
      "iostream",
      "cstdio",
      "cstring",
      "cmath",
      "cstdlib",
      "climits",
      "cstdint",
      "numeric",
      "functional",
      "utility",
      "cassert",
      "ctime",
      "random",
      "algorithm",
    ];
    for (const label of required) {
      expect(labels).toContain(label);
    }
  });

  it("包含 OI 常用算法扩展", () => {
    const labels = CPP_KEYWORDS_ALL.map((k) => k.label);
    const required = [
      "iota",
      "partial_sum",
      "inplace_merge",
      "shuffle",
      "gcd",
      "lcm",
      "__gcd",
      "__lg",
      "memset",
      "memcpy",
      "sqrt",
      "pow",
      "ceil",
      "floor",
      "fabs",
    ];
    for (const label of required) {
      expect(labels).toContain(label);
    }
  });

  it("包含 OI 常用宏常量", () => {
    const labels = CPP_KEYWORDS_ALL.map((k) => k.label);
    const required = [
      "INT_MAX",
      "INT_MIN",
      "LLONG_MAX",
      "LLONG_MIN",
      "UINT_MAX",
      "ULLONG_MAX",
      "INFINITY",
      "NAN",
      "EOF",
      "NULL",
      "CHAR_BIT",
    ];
    for (const label of required) {
      expect(labels).toContain(label);
    }
  });

  it("包含 GCC 扩展 128 位整数类型", () => {
    const labels = CPP_KEYWORDS_ALL.map((k) => k.label);
    expect(labels).toContain("__int128_t");
    expect(labels).toContain("__uint128_t");
  });

  it("包含完整定宽整数类型（8/16/32/64）", () => {
    const labels = CPP_KEYWORDS_ALL.map((k) => k.label);
    const required = [
      "int8_t",
      "uint8_t",
      "int16_t",
      "uint16_t",
      "int32_t",
      "uint32_t",
      "int64_t",
      "uint64_t",
    ];
    for (const label of required) {
      expect(labels).toContain(label);
    }
  });

  it("bits/stdc++.h 是 Module kind", () => {
    const h = CPP_KEYWORDS_ALL.find((k) => k.label === "bits/stdc++.h");
    expect(h).toBeDefined();
    expect(h!.kind).toBe("Module");
  });

  it("INT_MAX 是 Constant kind", () => {
    const m = CPP_KEYWORDS_ALL.find((k) => k.label === "INT_MAX");
    expect(m).toBeDefined();
    expect(m!.kind).toBe("Constant");
  });

  it("数据源总量 ≥ 200", () => {
    expect(CPP_KEYWORDS_ALL.length).toBeGreaterThanOrEqual(200);
  });
});
