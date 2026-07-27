import { describe, it, expect } from "vitest";
import { CPP_SNIPPETS } from "./cppSnippets";

describe("CPP_SNIPPETS", () => {
  it("包含 main 模板", () => {
    expect(CPP_SNIPPETS.find((s) => s.label === "main")).toBeDefined();
  });

  it("包含 OI 竞赛常用 13 个 snippet", () => {
    const labels = CPP_SNIPPETS.map((s) => s.label);
    const expected = [
      "main",
      "for",
      "while",
      "if",
      "vector",
      "map",
      "sort",
      "dfs",
      "bfs",
      "struct",
      "cin",
      "cout",
      "freopen",
    ];
    for (const label of expected) {
      expect(labels).toContain(label);
    }
  });

  it("每个 snippet 都有 label/insertText/detail", () => {
    for (const s of CPP_SNIPPETS) {
      expect(s.label).toBeTruthy();
      expect(s.insertText).toBeTruthy();
      expect(s.detail).toBeTruthy();
    }
  });

  it("snippet 占位符语法正确（${n} 或 ${n:label}）", () => {
    const re = /\$\{(\d+)(?::[^}]+)?\}/g;
    for (const s of CPP_SNIPPETS) {
      const matches = [...s.insertText.matchAll(re)];
      if (matches.length === 0) continue;
      const nums = matches.map((m) => parseInt(m[1]));
      // 编号从 1 开始递增（允许重复引用，如 ${1:i} 多次使用）
      const uniqueSorted = [...new Set(nums)].sort((a, b) => a - b);
      expect(uniqueSorted[0]).toBe(1);
      for (let i = 1; i < uniqueSorted.length; i++) {
        expect(uniqueSorted[i]).toBe(uniqueSorted[i - 1] + 1);
      }
    }
  });

  it("snippet label 不重复", () => {
    const labels = CPP_SNIPPETS.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("dfs snippet 包含递归调用", () => {
    const dfs = CPP_SNIPPETS.find((s) => s.label === "dfs");
    expect(dfs).toBeDefined();
    expect(dfs!.insertText).toContain("dfs(");
  });

  it("for snippet 占位符引用一致（${1:i} 出现 3 次）", () => {
    const forSnippet = CPP_SNIPPETS.find((s) => s.label === "for");
    expect(forSnippet).toBeDefined();
    const matches = forSnippet!.insertText.match(/\$\{1:i\}/g);
    expect(matches?.length).toBe(3);
  });
});
