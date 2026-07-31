import { describe, it, expect } from "vitest";
import {
  CHEATSHEET_ENTRIES,
  CHEATSHEET_CATEGORIES,
  searchCheatsheet,
  highlightText,
  type CheatCategory,
} from "./cheatsheet";
import { CPP_MEMBERS } from "../monaco/cppMembers";

const VALID_CATEGORIES: CheatCategory[] = [
  "io",
  "syntax",
  "stl",
  "algorithm",
  "dp",
  "graph",
];

describe("cheatsheet 数据完整性", () => {
  it("应有 74 条（6 大分类重组后）", () => {
    expect(CHEATSHEET_ENTRIES.length).toBe(74);
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
      "io",
      "syntax",
      "stl",
      "algorithm",
      "dp",
      "graph",
    ]);
  });

  it("每个 category 至少有 1 条数据（保证分类过滤有内容）", () => {
    for (const cat of VALID_CATEGORIES) {
      const count = CHEATSHEET_ENTRIES.filter((e) => e.category === cat).length;
      expect(count, `分类 ${cat} 应至少有 1 条`).toBeGreaterThanOrEqual(1);
    }
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

  it("syntax 类别有 8 条（GESP 1-3 级语法基础）", () => {
    const syntax = CHEATSHEET_ENTRIES.filter((e) => e.category === "syntax");
    expect(syntax.length).toBe(8);
    expect(syntax.map((e) => e.id).sort()).toEqual(
      ["array", "branch", "bitwise", "data-types", "function", "loop", "recursion", "struct"].sort(),
    );
  });

  it("stl 类别有 21 条（字符串 + 容器 + STL 算法）", () => {
    const stl = CHEATSHEET_ENTRIES.filter((e) => e.category === "stl");
    expect(stl.length).toBe(21);
    const ids = stl.map((e) => e.id);
    // 字符串（5 条）
    for (const required of [
      "string-length", "string-substr", "string-find", "to-string-stoi", "string-compare-concat",
    ]) {
      expect(ids, `stl 缺少 ${required}`).toContain(required);
    }
    // 容器（7 条）
    for (const required of [
      "vector", "pair", "map", "set", "stack-queue-pq", "deque", "unordered",
    ]) {
      expect(ids, `stl 缺少 ${required}`).toContain(required);
    }
    // STL 算法 + 链表（9 条）
    for (const required of [
      "sort", "min-max-abs-swap", "lower-upper-bound", "math-functions",
      "reverse-unique", "min-max-element", "accumulate", "next-permutation", "linked-list",
    ]) {
      expect(ids, `stl 缺少 ${required}`).toContain(required);
    }
  });

  it("algorithm 类别有 21 条（常用算法）", () => {
    const algorithm = CHEATSHEET_ENTRIES.filter((e) => e.category === "algorithm");
    expect(algorithm.length).toBe(21);
    const ids = algorithm.map((e) => e.id);
    // 排序算法（7 种：冒泡/选择/插入、归并、快排、桶、基数、计数、堆）
    for (const required of [
      "simple-sort", "merge-sort", "quick-sort",
      "bucket-sort", "radix-sort", "counting-sort", "heap-sort",
    ]) {
      expect(ids, `algorithm 缺少 ${required}`).toContain(required);
    }
    // 搜索与基础算法
    for (const required of [
      "dfs", "bfs", "connected-comp", "binary-search", "prefix-sum-diff",
      "two-pointers", "direction-array", "enum-simulate", "divide-conquer",
      "binary-lifting", "greedy", "sieve", "big-integer-add", "big-integer-div",
    ]) {
      expect(ids, `algorithm 缺少 ${required}`).toContain(required);
    }
  });

  it("dp 类别有 8 条（动态规划）", () => {
    const dp = CHEATSHEET_ENTRIES.filter((e) => e.category === "dp");
    expect(dp.length).toBe(8);
    expect(dp.map((e) => e.id).sort()).toEqual([
      "memoized-search", "knapsack-dp", "interval-dp", "tree-dp",
      "linear-dp", "bitmask-dp", "digit-dp", "counting-dp",
    ].sort());
  });

  it("graph 类别有 9 条（图论）", () => {
    const graph = CHEATSHEET_ENTRIES.filter((e) => e.category === "graph");
    expect(graph.length).toBe(9);
    expect(graph.map((e) => e.id).sort()).toEqual([
      "graph-storage-traversal", "tree-diameter", "tree-center", "tree-centroid",
      "lca", "hld", "shortest-path", "mst", "connectivity",
    ].sort());
  });
});

describe("searchCheatsheet", () => {
  it("空 query + all 返回全部 74 条", () => {
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "all").length).toBe(74);
  });

  it("空 query + 各分类过滤（io=7, syntax=8, stl=21, algorithm=21, dp=8, graph=9）", () => {
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "io").length).toBe(7);
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "syntax").length).toBe(8);
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "stl").length).toBe(21);
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "algorithm").length).toBe(21);
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "dp").length).toBe(8);
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "", "graph").length).toBe(9);
  });

  it("空白 query 等价于空 query", () => {
    expect(searchCheatsheet(CHEATSHEET_ENTRIES, "   ", "all").length).toBe(74);
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

  it("组合 query + category（stl 分类下搜 lower_bound 命中 map/set/lower-upper-bound，unordered 因说明文字命中）", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "lower_bound", "stl");
    const ids = r.map((e) => e.id);
    expect(ids).toContain("map");
    expect(ids).toContain("set");
    expect(ids).toContain("lower-upper-bound");
    // unordered 条目说明文字提及"不支持 lower_bound"，搜索会命中（教学价值：告知用户不支持）
    expect(ids).toContain("unordered");
  });

  it("组合 query + category（algorithm 分类下搜 lower_bound 命中 binary-search）", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "lower_bound", "algorithm");
    const ids = r.map((e) => e.id);
    // binary-search 的 keywords 包含 lower_bound；lower-upper-bound 已移至 stl
    expect(ids).toContain("binary-search");
    expect(ids).not.toContain("lower-upper-bound");
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

  it("GESP 扩充条目搜索：背包 命中 knapsack-dp（0-1 背包 + 完全背包合并条目）", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "背包", "all");
    const ids = r.map((e) => e.id);
    expect(ids).toContain("knapsack-dp");
  });

  it("GESP 扩充条目搜索：DP 命中 dp 分类下全部 8 条", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "DP", "all");
    const ids = r.map((e) => e.id);
    for (const id of [
      "memoized-search", "knapsack-dp", "interval-dp", "tree-dp",
      "linear-dp", "bitmask-dp", "digit-dp", "counting-dp",
    ]) {
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

describe("searchCheatsheet 加权排序", () => {
  it("搜 'string' 时 string-length 等条目排在数组之前", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "string", "all");
    const ids = r.map((e) => e.id);
    const stringIdx = ids.indexOf("string-length");
    const arrayIdx = ids.indexOf("array");
    expect(stringIdx).toBeGreaterThan(-1);
    expect(arrayIdx).toBeGreaterThan(-1);
    expect(stringIdx).toBeLessThan(arrayIdx);
  });

  it("搜 'vector' 时 vector 条目排在结构体之前", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "vector", "all");
    const ids = r.map((e) => e.id);
    const vectorIdx = ids.indexOf("vector");
    const structIdx = ids.indexOf("struct");
    expect(vectorIdx).toBeGreaterThan(-1);
    expect(structIdx).toBeGreaterThan(-1);
    expect(vectorIdx).toBeLessThan(structIdx);
  });

  it("name 精确匹配得分高于 code 子串匹配（搜 printf 排第一）", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "printf", "all");
    expect(r[0].id).toBe("printf");
  });

  it("空 query 仍按原 entries 顺序返回 74 条", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "", "all");
    expect(r.length).toBe(74);
    expect(r[0].id).toBe(CHEATSHEET_ENTRIES[0].id);
  });

  it("空 query + 分类过滤仍按原 entries 顺序", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "", "stl");
    expect(r.length).toBe(21);
    // stl 类第一条是 string-length（按 CHEATSHEET_ENTRIES 原顺序）
    expect(r[0].id).toBe("string-length");
  });

  it("按 snippet 代码命中（push_back 仍命中 vector，code 兜底 5 分）", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "push_back", "all");
    expect(r.map((e) => e.id)).toContain("vector");
  });

  it("keywords 精确匹配优先于 code 子串匹配", () => {
    // 搜 'size'：string-length 的 keywords 含 'size'（60 分）
    // 其他 code 中含 'size' 的条目（如 size_t）只有 5 分
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "size", "all");
    expect(r[0].id).toBe("string-length");
  });
});

describe("highlightText", () => {
  it("空 query 返回原文本（已转义）", () => {
    expect(highlightText("hello <world>", "")).toBe("hello &lt;world&gt;");
  });

  it("空白 query 等价于空 query", () => {
    expect(highlightText("hello", "   ")).toBe("hello");
  });

  it("大小写不敏感高亮", () => {
    expect(highlightText("Hello World", "world")).toBe(
      'Hello <mark class="cheatsheet-hl">World</mark>',
    );
  });

  it("多匹配全部高亮", () => {
    expect(highlightText("ab ab ab", "ab")).toBe(
      '<mark class="cheatsheet-hl">ab</mark> <mark class="cheatsheet-hl">ab</mark> <mark class="cheatsheet-hl">ab</mark>',
    );
  });

  it("转义 HTML 特殊字符防 XSS", () => {
    expect(highlightText("<script>", "scr")).toBe(
      '&lt;<mark class="cheatsheet-hl">scr</mark>ipt&gt;',
    );
  });

  it("转义 & 字符", () => {
    expect(highlightText("a & b", "")).toBe("a &amp; b");
  });

  it("转义 query 中的正则元字符", () => {
    expect(highlightText("a(b)c", "(b)")).toBe(
      'a<mark class="cheatsheet-hl">(b)</mark>c',
    );
  });

  it("无匹配返回转义后的原文本", () => {
    expect(highlightText("hello world", "xyz")).toBe("hello world");
  });

  it("保留匹配原文大小写", () => {
    expect(highlightText("Hello WORLD", "world")).toBe(
      'Hello <mark class="cheatsheet-hl">WORLD</mark>',
    );
  });
});

describe("string 类方法覆盖完整性", () => {
  it("string 类条目覆盖所有 STRING_MEMBERS 方法", () => {
    // string 相关条目已合并到 stl 分类，按 id 前缀筛选
    const stringEntryIds = [
      "string-length", "string-substr", "string-find",
      "to-string-stoi", "string-compare-concat",
    ];
    const stringEntries = CHEATSHEET_ENTRIES.filter((e) =>
      stringEntryIds.includes(e.id),
    );
    const allCode = stringEntries
      .flatMap((e) => e.snippets.map((s) => s.code))
      .join("\n");
    // 对照 cppMembers.ts STRING_MEMBERS 的 30 个方法（迭代器方法 begin/end 等用关键字形式检查）
    for (const method of [
      "size", "length", "empty", "clear", "append", "push_back", "pop_back",
      "substr", "find", "rfind", "find_first_of", "find_first_not_of",
      "find_last_of", "find_last_not_of", "insert", "erase", "replace",
      "c_str", "data", "compare", "resize", "reserve", "capacity", "at",
      "back", "front", "begin", "end", "rbegin", "rend",
    ]) {
      expect(allCode, `string 类应包含 ${method} 用法`).toContain(method);
    }
  });

  it("搜 'rfind' 命中 string-find 条目", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "rfind", "all");
    expect(r.map((e) => e.id)).toContain("string-find");
  });

  it("搜 'find_first_of' 命中 string-find 条目", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "find_first_of", "all");
    expect(r.map((e) => e.id)).toContain("string-find");
  });
});

describe("容器方法覆盖完整性", () => {
  it("vector 条目覆盖所有 VECTOR_MEMBERS 方法", () => {
    const v = CHEATSHEET_ENTRIES.find((e) => e.id === "vector")!;
    const code = v.snippets.map((s) => s.code).join("\n");
    for (const m of [
      "push_back", "emplace_back", "pop_back", "size", "empty", "clear",
      "insert", "erase", "resize", "reserve", "capacity", "at", "front",
      "back", "begin", "end",
    ]) {
      expect(code, `vector 应包含 ${m}`).toContain(m);
    }
  });

  it("map 条目覆盖所有 MAP_MEMBERS 方法", () => {
    const m = CHEATSHEET_ENTRIES.find((e) => e.id === "map")!;
    const code = m.snippets.map((s) => s.code).join("\n");
    for (const method of [
      "insert", "erase", "find", "count", "size", "empty", "clear", "at",
      "lower_bound", "upper_bound", "begin", "end",
    ]) {
      expect(code, `map 应包含 ${method}`).toContain(method);
    }
  });

  it("set 条目覆盖所有 SET_MEMBERS 方法", () => {
    const s = CHEATSHEET_ENTRIES.find((e) => e.id === "set")!;
    const code = s.snippets.map((s) => s.code).join("\n");
    for (const method of [
      "insert", "erase", "find", "count", "size", "empty", "clear",
      "lower_bound", "upper_bound", "begin", "end",
    ]) {
      expect(code, `set 应包含 ${method}`).toContain(method);
    }
  });

  it("deque 条目覆盖 vector 方法 + push_front/pop_front", () => {
    const d = CHEATSHEET_ENTRIES.find((e) => e.id === "deque")!;
    const code = d.snippets.map((s) => s.code).join("\n");
    for (const m of [
      "push_back", "pop_back", "emplace_back", "push_front", "pop_front",
      "insert", "erase", "resize", "at", "front", "back", "empty", "clear",
      "size", "begin", "end",
    ]) {
      expect(code, `deque 应包含 ${m}`).toContain(m);
    }
  });

  it("unordered 条目覆盖 unordered_map/unordered_set 方法", () => {
    const u = CHEATSHEET_ENTRIES.find((e) => e.id === "unordered")!;
    const code = u.snippets.map((s) => s.code).join("\n");
    for (const m of [
      "insert", "erase", "find", "count", "empty", "clear", "begin", "end",
      "size",
    ]) {
      expect(code, `unordered 应包含 ${m}`).toContain(m);
    }
  });

  it("搜 'emplace_back' 命中 vector 条目", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "emplace_back", "all");
    expect(r.map((e) => e.id)).toContain("vector");
  });

  it("搜 'lower_bound' 命中 map、set、lower-upper-bound 三条", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "lower_bound", "all");
    const ids = r.map((e) => e.id);
    expect(ids).toContain("map");
    expect(ids).toContain("set");
    expect(ids).toContain("lower-upper-bound");
  });

  it("搜 'push_front' 命中 deque 条目", () => {
    const r = searchCheatsheet(CHEATSHEET_ENTRIES, "push_front", "all");
    expect(r.map((e) => e.id)).toContain("deque");
  });
});

describe("代码补全与速查表一致性", () => {
  // 代码补全类型 → 速查表中对应条目 id 集合
  // list/array/multimap/multiset/unordered_multimap/unordered_multiset 速查表未覆盖，暂不约束
  const TYPE_TO_ENTRY_IDS: Record<string, string[]> = {
    string: ["string-length", "string-substr", "string-find", "to-string-stoi", "string-compare-concat"],
    vector: ["vector"],
    deque: ["deque"],
    map: ["map"],
    unordered_map: ["unordered"],
    set: ["set"],
    unordered_set: ["unordered"],
    stack: ["stack-queue-pq"],
    queue: ["stack-queue-pq"],
    priority_queue: ["stack-queue-pq"],
    pair: ["pair"],
  };

  // 收集所有待校验的 [类型, 方法] 对，统一输出测试用例
  const cases: Array<{ typeName: string; label: string; ids: string[] }> = [];
  for (const [typeName, members] of Object.entries(CPP_MEMBERS)) {
    const ids = TYPE_TO_ENTRY_IDS[typeName];
    if (!ids) continue; // 速查表未覆盖的类型跳过
    for (const member of members) {
      cases.push({ typeName, label: member.label, ids });
    }
  }

  for (const { typeName, label, ids } of cases) {
    it(`搜 ${typeName}::${label} 应命中对应速查表条目`, () => {
      const r = searchCheatsheet(CHEATSHEET_ENTRIES, label, "all");
      const hitIds = r.map((e) => e.id);
      // string 等多条目类型：方法分布在多个条目中，命中任意一个即可；
      // 单条目类型（vector/deque 等）只有 1 个 id，等价于必须命中
      const hit = ids.some((id) => hitIds.includes(id));
      expect(
        hit,
        `搜 '${label}' 应至少命中一个 ${typeName} 条目（候选：${ids.join(", ")}）`,
      ).toBe(true);
    });
  }

  it("速查表覆盖的补全类型至少 11 种", () => {
    expect(Object.keys(TYPE_TO_ENTRY_IDS).length).toBe(11);
  });
});
