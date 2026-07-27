// 行级 diff 纯函数（自实现 Myers/LCS 简化版，不引入依赖）
//
// 设计要点：
// - 输入两个字符串，按 \n 切分成行，计算 LCS，回溯构造 DiffLine[]
// - 复杂度保护：当输入总长度 > FALLBACK_THRESHOLD 时降级为简单对齐 diff
// - 行号 1-based，null 表示该侧独有

export type DiffLineType = "equal" | "modified" | "added" | "removed";

export interface DiffLine {
  /** 实际侧行号（1-based），null 表示此行是期望侧独有 */
  leftLineNo: number | null;
  /** 期望侧行号（1-based），null 表示此行是实际侧独有 */
  rightLineNo: number | null;
  /** 实际侧该行内容（removed/equal/modified 有值，added 为空串） */
  leftContent: string;
  /** 期望侧该行内容（added/equal/modified 有值，removed 为空串） */
  rightContent: string;
  type: DiffLineType;
}

/** 总长度超过此阈值（约 5MB）时降级为简单对齐 diff，避免 JS 阻塞主线程 */
const FALLBACK_THRESHOLD = 5_000_000;

/** 按行切分字符串，保留空行；末尾换行不产生额外空行 */
function splitLines(s: string): string[] {
  if (s === "") return [];
  // 与 String.prototype.split("\n") 区别：不保留末尾空行
  const lines = s.split("\n");
  // 若原字符串以 \n 结尾，最后一个元素是 ""，去掉
  if (lines.length > 0 && lines[lines.length - 1] === "" && s.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

/**
 * 计算 LCS 二维矩阵，返回完整 path 用于回溯。
 * 矩阵尺寸 (m+1) x (n+1)，dp[i][j] = leftLines[0..i) 与 rightLines[0..j) 的 LCS 长度。
 */
function lcsMatrix(leftLines: string[], rightLines: string[]): number[][] {
  const m = leftLines.length;
  const n = rightLines.length;
  // 用 Uint32Array 节省内存（每个元素 4 字节）
  // 但为了回溯方便用 number[][]；对 5MB 内的输入（约 100K 行）尚可接受
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

/** 回溯 LCS 矩阵，构造 DiffLine[]（顺序：从尾部到头部，最后 reverse） */
function backtrack(
  dp: number[][],
  leftLines: string[],
  rightLines: string[],
): DiffLine[] {
  const result: DiffLine[] = [];
  let i = leftLines.length;
  let j = rightLines.length;
  let leftNo = leftLines.length;
  let rightNo = rightLines.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      // 相同行
      result.push({
        leftLineNo: leftNo,
        rightLineNo: rightNo,
        leftContent: leftLines[i - 1],
        rightContent: rightLines[j - 1],
        type: "equal",
      });
      i--;
      j--;
      leftNo--;
      rightNo--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // 期望侧独有（added）
      result.push({
        leftLineNo: null,
        rightLineNo: rightNo,
        leftContent: "",
        rightContent: rightLines[j - 1],
        type: "added",
      });
      j--;
      rightNo--;
    } else {
      // 实际侧独有（removed）
      result.push({
        leftLineNo: leftNo,
        rightLineNo: null,
        leftContent: leftLines[i - 1],
        rightContent: "",
        type: "removed",
      });
      i--;
      leftNo--;
    }
  }

  result.reverse();
  return result;
}

/**
 * 降级 diff：按行号对齐，超出较短一侧的部分标 added/removed。
 * 只标第一个差异行，后续按行号对齐（简单但不会雪崩）。
 */
function fallbackDiff(actual: string, expected: string): DiffLine[] {
  const left = splitLines(actual);
  const right = splitLines(expected);
  const maxLen = Math.max(left.length, right.length);
  const result: DiffLine[] = [];
  for (let i = 0; i < maxLen; i++) {
    const l = i < left.length ? left[i] : undefined;
    const r = i < right.length ? right[i] : undefined;
    if (l !== undefined && r !== undefined) {
      if (l === r) {
        result.push({
          leftLineNo: i + 1,
          rightLineNo: i + 1,
          leftContent: l,
          rightContent: r,
          type: "equal",
        });
      } else {
        result.push({
          leftLineNo: i + 1,
          rightLineNo: i + 1,
          leftContent: l,
          rightContent: r,
          type: "modified",
        });
      }
    } else if (l !== undefined) {
      result.push({
        leftLineNo: i + 1,
        rightLineNo: null,
        leftContent: l,
        rightContent: "",
        type: "removed",
      });
    } else if (r !== undefined) {
      result.push({
        leftLineNo: null,
        rightLineNo: i + 1,
        leftContent: "",
        rightContent: r,
        type: "added",
      });
    }
  }
  return result;
}

/**
 * 合并相邻的 added + removed 为 modified（同位置两侧都有差异内容时）。
 * Myers 回溯会产生 [removed, added] 或 [added, removed] 序列，合并后更直观。
 */
function mergeAdjacentAddedRemoved(lines: DiffLine[]): DiffLine[] {
  const result: DiffLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const cur = lines[i];
    const next = lines[i + 1];
    if (next && cur.type === "removed" && next.type === "added") {
      result.push({
        leftLineNo: cur.leftLineNo,
        rightLineNo: next.rightLineNo,
        leftContent: cur.leftContent,
        rightContent: next.rightContent,
        type: "modified",
      });
      i += 2;
    } else if (next && cur.type === "added" && next.type === "removed") {
      result.push({
        leftLineNo: next.leftLineNo,
        rightLineNo: cur.rightLineNo,
        leftContent: next.leftContent,
        rightContent: cur.rightContent,
        type: "modified",
      });
      i += 2;
    } else {
      result.push(cur);
      i++;
    }
  }
  return result;
}

/**
 * 计算两个字符串的行级 diff。
 *
 * @param actual 实际输出
 * @param expected 期望输出
 * @returns DiffLine[]，按行顺序排列
 */
export function computeLineDiff(actual: string, expected: string): DiffLine[] {
  // 复杂度保护：超阈值降级
  if (actual.length + expected.length > FALLBACK_THRESHOLD) {
    return fallbackDiff(actual, expected);
  }

  const leftLines = splitLines(actual);
  const rightLines = splitLines(expected);

  // 空输入快速路径
  if (leftLines.length === 0 && rightLines.length === 0) {
    return [];
  }
  if (leftLines.length === 0) {
    return rightLines.map((line, idx) => ({
      leftLineNo: null,
      rightLineNo: idx + 1,
      leftContent: "",
      rightContent: line,
      type: "added" as const,
    }));
  }
  if (rightLines.length === 0) {
    return leftLines.map((line, idx) => ({
      leftLineNo: idx + 1,
      rightLineNo: null,
      leftContent: line,
      rightContent: "",
      type: "removed" as const,
    }));
  }

  const dp = lcsMatrix(leftLines, rightLines);
  const raw = backtrack(dp, leftLines, rightLines);
  return mergeAdjacentAddedRemoved(raw);
}

/**
 * 统计 diff 结果中的差异行数（modified + added + removed）。
 * 用于 Modal header 显示"N 处差异"。
 */
export function countDiffs(lines: DiffLine[]): number {
  return lines.filter((l) => l.type !== "equal").length;
}
