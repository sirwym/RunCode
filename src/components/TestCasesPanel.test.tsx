import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Tauri API（模块顶层 import 需要）
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn(), message: vi.fn() }));

import { formatCaseDiagnostic } from "./TestCasesPanel";
import type { TestJudgeInfo } from "../hooks/useRunManager";
import type { TestCaseResult } from "../types";
import { useI18n } from "../hooks/useI18n";

beforeEach(() => {
  // 真实 i18n store（zh）
  useI18n.getState().setLocale("zh");
});

function makeResult(overrides: Partial<TestCaseResult> = {}): TestCaseResult {
  return {
    id: "tc_0",
    passed: false,
    verdict: "wa",
    stdout: "",
    stderr: "",
    exit_code: 0,
    duration_ms: 15,
    cpu_ms: 14,
    killed_by: null,
    truncated: false,
    first_diff: 3,
    max_rss_kb: 1024,
    ...overrides,
  };
}

function makeJudge(overrides: Partial<TestJudgeInfo> = {}): TestJudgeInfo {
  return {
    case_id: "tc_0",
    index: 2,
    total: 10,
    case_strict: false,
    exit_code: 0,
    duration_ms: 15,
    time_limit_ms: 1000,
    time_exceeded: false,
    passed: false,
    first_diff: 3,
    norm_equal: false,
    expected_len: 10,
    actual_len: 11,
    expected_esc: "1 2\\n",
    actual_esc: "1··2\\n",
    ...overrides,
  };
}

describe("formatCaseDiagnostic", () => {
  it("judge + 转义视图 → 完整诊断文本（位置/转义期望/转义实际）", () => {
    const t = useI18n.getState().t;
    const text = formatCaseDiagnostic(makeResult(), makeJudge(), 2, "样例三", t);
    const lines = text.split("\n");
    expect(lines[0]).toBe("[3/10] 样例三 WA strict=false exit=0 15/1000ms diff=3 len=10/11");
    expect(lines[1]).toBe("期望输出: [1 2\\n]");
    expect(lines[2]).toBe("实际: [1··2\\n]");
  });

  it("judge 无转义视图（大输出）→ 附带实际输出摘录", () => {
    const t = useI18n.getState().t;
    const result = makeResult({ stdout: "x".repeat(600) });
    const judge = makeJudge({ expected_esc: null, actual_esc: null });
    const text = formatCaseDiagnostic(result, judge, 0, "case", t);
    const lines = text.split("\n");
    // 摘录 512 字符 + 省略号
    expect(lines[1]).toBe(`实际: ${"x".repeat(512)}…`);
  });

  it("无 judge（旧快照恢复）→ 退化格式，不崩溃", () => {
    const t = useI18n.getState().t;
    const result = makeResult({ stdout: "abc", stderr: "boom" });
    const text = formatCaseDiagnostic(result, undefined, 4, "旧用例", t);
    const lines = text.split("\n");
    expect(lines[0]).toBe("#5 旧用例 WA exit=0 15ms diff=3");
    expect(lines[1]).toBe("实际: abc");
    expect(lines[2]).toBe("stderr: boom");
  });

  it("stderr 非空时附带（512 字符截断）", () => {
    const t = useI18n.getState().t;
    const result = makeResult({ stderr: "e".repeat(600) });
    const text = formatCaseDiagnostic(result, makeJudge(), 0, "c", t);
    expect(text.split("\n")[3]).toBe(`stderr: ${"e".repeat(512)}…`);
  });
});
