import { describe, it, expect } from "vitest";
import {
  CHEATSHEET_ENTRIES,
  CHEATSHEET_CATEGORIES,
  searchCheatsheet,
  type CheatCategory,
} from "./cheatsheet";

const VALID_CATEGORIES: CheatCategory[] = [
  "syntax",
  "io",
  "string",
  "container",
  "algorithm",
  "template",
];

describe("cheatsheet 数据完整性", () => {
  it("应有 59 条（GESP 1-8 级覆盖扩充后）", () => {
    expect(CHEATSHEET_ENTRIES.length).toBe(59);
  });

  it("id 唯一", () => {
    const ids = CHEATSHEET_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每条 entry 字段完整", () => {
    for (const e of CHEATSHEET_ENTRIES) {
      expect(e.id).toBeTruthy();
      expect(VALID_CATEGORIES).toContain(e.category);
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.summary.length).toBeGreaterThan(0);
      expect(e.keywords.length).toBeGreaterThanOrEqual(3);
      expect(e.snippets.length).toBeGreaterThanOrEqual(1);
      for (const s of e.snippets) {
        expect(s.code.length).toBeGreaterThan(0);
        expect(s.comment.length).toBeGreaterThan(0);
      }
    }
  });

  it("分类元数据覆盖 all + 6 个分类，顺序固定", () => {
    expect(CHEATSHEET_CATEGORIES.map((c) => c.id)).toEqual([
      "all",
      "syntax",
      "io",
      "string",
      "container",
      "algorithm",
      "template",
    ]);
  });

  it("每个 category 至少有 1 条数据（保证分类过滤有内容）", () => {
    for (const cat of VALID_CATEGORIES) {
      const count = CHEATSHEET_ENTRIES.filter((e) => e.category === cat).length;
      expect(count, `分类 ${cat} 应至少有 1 条`).toBeGreaterThanOrEqual(1);
    }
  });

  it("syntax 类别有 8 条（GESP 1-3 级语法基础）", () => {
    const syntax = CHEATSHEET_ENTRIES.filter((e) => e.category === "syntax");
    expect(syntax.length).toBe(8);
    expect(syntax.map((e) => e.id).sort()).toEqual(
      ["array", "branch", "bitwise", "data-types", "function", "loop", "recursion", "struct"].sort(),
    );
  });

  it("二分查找条目包含两种整数写法 + 浮点二分", () => {
    const bs = CHEATSHEET_ENTRIES.find((e) => e.id === "binary-search");
    expect(bs).toBeDefined();
    expect(bs?.snippets.length).toBeGreaterThanOrEqual(3);
    expect(bs?.snippets[0].code).toContain("l <= r");
    expect(bs?.snippets[1].code).toContain("lo < hi");
    expect(bs?.snippets[2].code).toContain("for (int i = 0; i < 100");
  });

  it("高精度只有加法和除法（用户决策：先只加这两种）", () => {
    const bigInt = CHEATSHEET_ENTRIES.filter((e) =>
      e.id.startsWith("big-integer"),
    );
    expect(bigInt.map((e) => e.id).sort()).toEqual([
      "big-integer-add",
      "big-integer-div",
    ]);
  });

  it("template 类别覆盖 GESP 4-6 级核心算法", () => {
    const template = CHEATSHEET_ENTRIES.filter(
      (e) => e.category === "template",
    );
    expect(template.length).toBe(24);
    const ids = template.map((e) => e.id);
    // 必须覆盖：排序、搜索、DP、数据结构
    for (const required of [
      "simple-sort",
      "merge-sort",
      "quick-sort",
      "dfs",
      "bfs",
      "union-find",
      "sieve",
      "dp-1d",
      "knapsack-01",
      "knapsack-complete",
      "lis",
      "lcs",
      "linked-list",
      "binary-tree",
    ]) {
      expect(ids, `template 缺少 ${required}`).toContain(required);
    }
  });
});

describe("searchCheatsheet", () => {
  it("空 query + all 返回全部 59 条", () => {
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "all").length).toBe(59);
  });

  it("空 query + 各分类过滤（syntax=8, io=7, string=5, container=7, algorithm=8, template=24）", () => {
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "syntax").length).toBe(8);
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "io").length).toBe(7);
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "string").length).toBe(5);
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "container").length).toBe(7);
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "algorithm").length).toBe(8);
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "template").length).toBe(24);
  });

  it("空白 query 等价于空 query", () => {
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "   ", "all").length).toBe(59);
  });

  it("按名称命中（printf 一定在结果中）", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "printf", "all");
    expect(r.map((e) => e.id)).toContain("printf");
  });

  it("按中文关键词命中（保留小数 命中 printf 和 fixed-setprecision）", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "保留小数", "all");
    const ids = r.map((e) => e.id);
    expect(ids).toContain("printf");
    expect(ids).toContain("fixed-setprecision");
  });

  it("大小写不敏感（PRINTF 命中 printf）", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "PRINTF", "all");
    expect(r.map((e) => e.id)).toContain("printf");
  });

  it("按 snippet 代码命中（push_back 命中 vector）", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "push_back", "all");
    expect(r.map((e) => e.id)).toContain("vector");
  });

  it("组合 query + category（容器分类下搜 lower_bound 应为空）", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "lower_bound", "container");
    expect(r.length).toBe(0);
  });

  it("组合 query + category（algorithm 分类下搜 lower_bound 命中 1 条）", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "lower_bound", "algorithm");
    expect(r.length).toBe(1);
    expect(r[0].id).toBe("lower-upper-bound");
  });

  it("无匹配返回空数组", () => {
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "xyz123_not_exists", "all")).toEqual([]);
  });

  it("GESP 扩充条目搜索：freopen 命中文件重定向", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "freopen", "all");
    expect(r.map((e) => e.id)).toContain("freopen");
  });

  it("GESP 扩充条目搜索：位运算 命中 bitwise", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "位运算", "all");
    expect(r.map((e) => e.id)).toContain("bitwise");
  });

  it("GESP 扩充条目搜索：高精度 命中加法和除法两条", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "高精度", "all");
    const ids = r.map((e) => e.id);
    expect(ids).toContain("big-integer-add");
    expect(ids).toContain("big-integer-div");
  });

  it("GESP 扩充条目搜索：背包 命中 0-1 背包和完全背包", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "背包", "all");
    const ids = r.map((e) => e.id);
    expect(ids).toContain("knapsack-01");
    expect(ids).toContain("knapsack-complete");
  });

  it("GESP 扩充条目搜索：DP 命中所有 DP 相关条目", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "DP", "all");
    const ids = r.map((e) => e.id);
    for (const id of ["dp-1d", "knapsack-01", "knapsack-complete", "lis", "lcs"]) {
      expect(ids, `应包含 ${id}`).toContain(id);
    }
  });

  it("GESP 扩充条目搜索：DFS 命中 dfs 和 connected-comp", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "DFS", "all");
    const ids = r.map((e) => e.id);
    expect(ids).toContain("dfs");
    expect(ids).toContain("connected-comp");
  });
});
