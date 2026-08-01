import { describe, it, expect } from "vitest";
import { computeLineDiff, countDiffs, type DiffLine } from "./diff";

// 辅助：断言 DiffLine 序列的 type 数组
function types(lines: DiffLine[]): string[] {
  return lines.map((l) => l.type);
}

describe("computeLineDiff", () => {
  it("两个空字符串返回空数组", () => {
    expect(computeLineDiff("", "")).toEqual([]);
  });

  it("完全相同 → 全部 equal", () => {
    const lines = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(types(lines)).toEqual(["equal", "equal", "equal"]);
    expect(lines[0]).toMatchObject({
      leftLineNo: 1,
      rightLineNo: 1,
      leftContent: "a",
      rightContent: "a",
    });
    expect(lines[2]).toMatchObject({
      leftLineNo: 3,
      rightLineNo: 3,
      leftContent: "c",
      rightContent: "c",
    });
  });

  it("末尾追加一行 → 最后一行 added", () => {
    const lines = computeLineDiff("a\nb", "a\nb\nc");
    expect(types(lines)).toEqual(["equal", "equal", "added"]);
    expect(lines[2]).toMatchObject({
      leftLineNo: null,
      rightLineNo: 3,
      rightContent: "c",
    });
  });

  it("中间删除一行 → removed", () => {
    const lines = computeLineDiff("a\nb\nc", "a\nc");
    expect(types(lines)).toEqual(["equal", "removed", "equal"]);
    expect(lines[1]).toMatchObject({
      leftLineNo: 2,
      rightLineNo: null,
      leftContent: "b",
    });
  });

  it("中间修改一行 → modified", () => {
    const lines = computeLineDiff("a\nb\nc", "a\nB\nc");
    expect(types(lines)).toEqual(["equal", "modified", "equal"]);
    expect(lines[1]).toMatchObject({
      leftLineNo: 2,
      rightLineNo: 2,
      leftContent: "b",
      rightContent: "B",
    });
  });

  it("完全不同（行数相同）→ Myers 产生 removed/modified/added 序列", () => {
    // "a\nb" vs "x\ny"：LCS 为空，回溯产生 [removed(a), added(x), removed(b), added(y)]
    // 合并相邻 removed+added → [modified(a vs x), modified(b vs y)]
    // 但回溯顺序可能为 [removed(a), added(x), removed(b), added(y)]
    // 合并策略：成对合并 → [modified, modified]
    // 实际：[removed(a), modified(b vs x), added(y)] —— Myers 回溯从尾部开始，
    // 最后产生的顺序取决于 dp 矩阵的相等优先级
    const lines = computeLineDiff("a\nb", "x\ny");
    // 至少应有 2 处差异，且全部都是非 equal
    expect(lines.every((l) => l.type !== "equal")).toBe(true);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("完全不同（实际为空）→ 全部 added", () => {
    const lines = computeLineDiff("", "x\ny");
    expect(types(lines)).toEqual(["added", "added"]);
    expect(lines[0]).toMatchObject({ leftLineNo: null, rightLineNo: 1 });
    expect(lines[1]).toMatchObject({ leftLineNo: null, rightLineNo: 2 });
  });

  it("完全不同（期望为空）→ 全部 removed", () => {
    const lines = computeLineDiff("x\ny", "");
    expect(types(lines)).toEqual(["removed", "removed"]);
    expect(lines[0]).toMatchObject({ leftLineNo: 1, rightLineNo: null });
    expect(lines[1]).toMatchObject({ leftLineNo: 2, rightLineNo: null });
  });

  it("保留空行：中间有空行", () => {
    const lines = computeLineDiff("a\n\nb", "a\n\nb");
    expect(types(lines)).toEqual(["equal", "equal", "equal"]);
    expect(lines[1].leftContent).toBe("");
    expect(lines[1].rightContent).toBe("");
  });

  it("末尾换行不产生额外空行", () => {
    // "a\n" 应被切分成 ["a"]，而不是 ["a", ""]
    const lines = computeLineDiff("a\n", "a\n");
    expect(types(lines)).toEqual(["equal"]);
  });

  it("两侧末尾换行不一致（一有一无）→ 不应差异", () => {
    // "a\n" vs "a" → 两侧 splitLines 后都是 ["a"]
    const lines = computeLineDiff("a\n", "a");
    expect(types(lines)).toEqual(["equal"]);
  });

  it("行号在多差异场景正确递增", () => {
    // 实际：1 2 3 4 5
    // 期望：1 X 3 4 5（第 2 行修改）
    const lines = computeLineDiff("1\n2\n3\n4\n5", "1\nX\n3\n4\n5");
    expect(types(lines)).toEqual(["equal", "modified", "equal", "equal", "equal"]);
    expect(lines[0]).toMatchObject({ leftLineNo: 1, rightLineNo: 1 });
    expect(lines[1]).toMatchObject({ leftLineNo: 2, rightLineNo: 2 });
    expect(lines[2]).toMatchObject({ leftLineNo: 3, rightLineNo: 3 });
  });

  it("插入多行：行号正确", () => {
    // 实际：a b
    // 期望：a X Y b
    const lines = computeLineDiff("a\nb", "a\nX\nY\nb");
    expect(types(lines)).toEqual(["equal", "added", "added", "equal"]);
    expect(lines[0]).toMatchObject({ leftLineNo: 1, rightLineNo: 1 });
    expect(lines[1]).toMatchObject({ leftLineNo: null, rightLineNo: 2 });
    expect(lines[2]).toMatchObject({ leftLineNo: null, rightLineNo: 3 });
    expect(lines[3]).toMatchObject({ leftLineNo: 2, rightLineNo: 4 });
  });

  it("降级：超过 10MB 字符阈值使用 fallbackDiff（按行号对齐）", () => {
    // 构造 6MB + 6MB = 12MB 总量 > 10MB 阈值
    const big = "x".repeat(6 * 1024 * 1024);
    const big2 = "y".repeat(6 * 1024 * 1024);
    const start = performance.now();
    const lines = computeLineDiff(big, big2);
    const elapsed = performance.now() - start;

    // 降级路径：单行 modified（按行号对齐）
    expect(types(lines)).toEqual(["modified"]);
    // 应在 500ms 内完成（不阻塞主线程）
    expect(elapsed).toBeLessThan(500);
  });

  it("降级：行数乘积超阈值走 fallbackDiff", () => {
    // 6000 行 × 6000 行 = 36M > 25M 阈值，走 fallback
    // 但字符总数 < 10M，不会在字符粗筛阶段降级
    const left = Array.from({ length: 6000 }, (_, i) => `l${i}`).join("\n");
    const right = Array.from({ length: 6000 }, (_, i) => `r${i}`).join("\n");
    const lines = computeLineDiff(left, right);
    // fallback 按行号对齐：前 5000 行全部 modified（末尾为 truncated 提示行）
    expect(lines.slice(0, 5000).every((l) => l.type === "modified")).toBe(true);
    // 6000 行 > 5000 上限，应截断为 5000 + 1 truncated
    expect(lines.length).toBe(5001);
    expect(lines[5000].type).toBe("truncated");
  });

  it("截断：差异行数超过 5000 时截断并附加 truncated 行", () => {
    // 构造 6000 行全部不同（行数乘积 6000*1 < 25M，不走 fallback）
    const left = Array.from({ length: 6000 }, (_, i) => `l${i}`).join("\n");
    const right = "single";
    const lines = computeLineDiff(left, right);
    // Myers 回溯从尾部开始：added(single) 先 push，reverse 后在末尾，
    // 与末尾 removed 合并成 modified。因此前 5999 行 removed，最后 1 行 modified。
    // 截断后保留前 5000 行（均为 removed）+ 1 truncated
    expect(lines.length).toBe(5001);
    expect(lines[5000].type).toBe("truncated");
    expect(lines[0].type).toBe("removed");
    expect(lines[4999].type).toBe("removed");
  });
});

describe("countDiffs", () => {
  it("空数组返回 0", () => {
    expect(countDiffs([])).toBe(0);
  });

  it("全 equal 返回 0", () => {
    const lines = computeLineDiff("a\nb", "a\nb");
    expect(countDiffs(lines)).toBe(0);
  });

  it("统计 modified/added/removed", () => {
    const lines = computeLineDiff("a\nb\nc", "a\nX\nc\nD");
    // equal modified equal added → 2 处差异
    expect(countDiffs(lines)).toBe(2);
  });

  it("truncated 行不计入差异数", () => {
    // 构造 6000 行差异，截断后 5000 行 + 1 truncated
    const left = Array.from({ length: 6000 }, (_, i) => `l${i}`).join("\n");
    const lines = computeLineDiff(left, "single");
    // 截断行不应计入差异数
    expect(countDiffs(lines)).toBe(5000);
  });
});
