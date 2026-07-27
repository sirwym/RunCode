import { describe, it, expect, beforeEach, vi } from "vitest";
import { useRunManager } from "./useRunManager";
import type { TestRunResult, RunResult, TestProgress } from "../types";

// Mock @tauri-apps/api/core 的 invoke
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Mock @tauri-apps/api/event 的 listen
const listenMock = vi.fn().mockResolvedValue(() => {});
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

// Mock useI18n.getT 避免 localizeError 报错
vi.mock("./useI18n", () => ({
  getT: () => (key: string) => key,
}));

function makeTestRunResult(passed: number, total: number): TestRunResult {
  return {
    run_id: "r1",
    success: passed === total,
    total,
    passed,
    stage: "ran",
    compile_stdout: "",
    compile_stderr: "",
    results: [],
  };
}

function makeRunResult(success: boolean): RunResult {
  return {
    run_id: "r2",
    success,
    stdout: "",
    stderr: "",
    exit_code: 0,
    duration_ms: 100,
    killed_by: null,
    truncated: false,
    stage: "ran",
    max_rss_kb: 1024,
  };
}

describe("useRunManager per-tab 隔离", () => {
  beforeEach(() => {
    useRunManager.setState({
      activeRunId: null,
      kind: null,
      status: "idle",
      runResult: null,
      testResult: null,
      error: null,
      testProgress: null,
      ptyRunId: null,
      ptyExitInfo: null,
      compileError: null,
      activeTabId: null,
      resultsByTab: {},
    });
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("setActiveTab 切换到无快照的 tab → 所有结果为 null", () => {
    useRunManager.getState().setActiveTab("tab-new");
    const s = useRunManager.getState();
    expect(s.activeTabId).toBe("tab-new");
    expect(s.runResult).toBeNull();
    expect(s.testResult).toBeNull();
    expect(s.ptyExitInfo).toBeNull();
    expect(s.compileError).toBeNull();
  });

  it("setActiveTab(null) 清空展示", () => {
    useRunManager.getState().setActiveTab("tab-a");
    useRunManager.getState().setActiveTab(null);
    const s = useRunManager.getState();
    expect(s.activeTabId).toBeNull();
    expect(s.runResult).toBeNull();
    expect(s.testResult).toBeNull();
  });

  it("compileRun 结果写入发起 tab 的快照，切回时恢复", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce(makeRunResult(true));

    await useRunManager.getState().compileRun("code");

    // 写入 tab-a 快照
    expect(useRunManager.getState().resultsByTab["tab-a"]?.runResult).not.toBeNull();
    expect(useRunManager.getState().runResult).not.toBeNull();

    // 切到 tab-b（无快照）
    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().runResult).toBeNull();

    // 切回 tab-a → 恢复
    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().runResult).not.toBeNull();
  });

  it("runTests 结果写入发起 tab，切到其他 tab 不被覆盖", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    const resultA = makeTestRunResult(0, 4);
    invokeMock.mockResolvedValueOnce(resultA);

    await useRunManager.getState().runTests("code", "suite-a", false);

    expect(useRunManager.getState().testResult?.passed).toBe(0);
    expect(useRunManager.getState().resultsByTab["tab-a"]?.testResult?.passed).toBe(0);

    // 切到 tab-b → testResult 变 null
    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().testResult).toBeNull();

    // 切回 tab-a → 恢复 0/4
    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().testResult?.passed).toBe(0);
  });

  it("运行中切换 tab，结果仍写入发起 tab", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    const resultA = makeTestRunResult(1, 4);

    // 让 invoke 返回一个 pending promise，便于中途切换 tab
    let resolveRun: (v: TestRunResult) => void = () => {};
    invokeMock.mockReturnValueOnce(new Promise<TestRunResult>((res) => { resolveRun = res; }));

    const runPromise = useRunManager.getState().runTests("code", "suite-a", false);

    // 运行中切到 tab-b
    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().activeTabId).toBe("tab-b");
    expect(useRunManager.getState().testResult).toBeNull();

    // 完成 → 结果写入 tab-a，不写入 tab-b
    resolveRun(resultA);
    await runPromise;

    expect(useRunManager.getState().resultsByTab["tab-a"]?.testResult?.passed).toBe(1);
    expect(useRunManager.getState().resultsByTab["tab-b"]?.testResult ?? null).toBeNull();
    // 当前展示（tab-b）的 testResult 仍为 null
    expect(useRunManager.getState().testResult).toBeNull();

    // 切回 tab-a → 看到 1/4
    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().testResult?.passed).toBe(1);
  });

  it("clearTab 删除指定 tab 的快照", () => {
    useRunManager.getState().setActiveTab("tab-a");
    useRunManager.getState().clearTab("tab-a");
    expect(useRunManager.getState().resultsByTab["tab-a"]).toBeUndefined();
  });

  it("clearTab 后 setActiveTab 返回空快照", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce(makeRunResult(true));
    await useRunManager.getState().compileRun("code");
    expect(useRunManager.getState().runResult).not.toBeNull();

    useRunManager.getState().clearTab("tab-a");
    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().runResult).toBeNull();
  });

  it("clearTab 不影响其他 tab", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce(makeRunResult(true));
    await useRunManager.getState().compileRun("code");

    useRunManager.getState().setActiveTab("tab-b");
    invokeMock.mockResolvedValueOnce(makeTestRunResult(2, 4));
    await useRunManager.getState().runTests("code", "suite-b", false);

    // 清 tab-a，tab-b 不受影响
    useRunManager.getState().clearTab("tab-a");
    expect(useRunManager.getState().resultsByTab["tab-a"]).toBeUndefined();
    expect(useRunManager.getState().resultsByTab["tab-b"]?.testResult?.passed).toBe(2);
  });

  it("startInteractive 编译失败 → compileError 写入发起 tab", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce({
      status: "compile_failed",
      run_id: "x",
      stderr: "error: foo",
    });

    await useRunManager.getState().startInteractive("code");

    expect(useRunManager.getState().compileError).toBe("error: foo");
    expect(useRunManager.getState().resultsByTab["tab-a"]?.compileError).toBe("error: foo");

    // 切到 tab-b → 无 compileError
    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().compileError).toBeNull();

    // 切回 tab-a → 恢复
    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().compileError).toBe("error: foo");
  });

  it("onPtyExit 写入当前 tab 的 ptyExitInfo 快照", () => {
    useRunManager.getState().setActiveTab("tab-a");
    const exit = { exitCode: 0, killedBy: null };
    useRunManager.getState().onPtyExit(exit);

    expect(useRunManager.getState().ptyExitInfo).toEqual(exit);
    expect(useRunManager.getState().resultsByTab["tab-a"]?.ptyExitInfo).toEqual(exit);

    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().ptyExitInfo).toBeNull();

    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().ptyExitInfo).toEqual(exit);
  });

  it("testProgress 不持久化到快照（瞬时状态）", async () => {
    useRunManager.getState().setActiveTab("tab-a");

    // 模拟 test_progress 事件回调
    const progress: TestProgress = {
      status: "running",
      run_id: "r1",
      case_id: "c1",
      index: 0,
      total: 4,
    };

    // 通过 listen 回调触发
    type ProgressCb = (e: { payload: TestProgress }) => void;
    const holder: { cb: ProgressCb | null } = { cb: null };
    listenMock.mockImplementationOnce(async (_event: string, cb: ProgressCb) => {
      holder.cb = cb;
      return () => {};
    });

    invokeMock.mockReturnValueOnce(new Promise<TestRunResult>(() => {})); // 永不 resolve
    void useRunManager.getState().runTests("code", "suite-a", false);

    // 等待 listen 被调用
    await new Promise((r) => setTimeout(r, 0));
    holder.cb?.({ payload: progress });

    expect(useRunManager.getState().testProgress).toEqual(progress);
    // 切到 tab-b → testProgress 清空
    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().testProgress).toBeNull();
  });
});
