import { describe, it, expect, beforeEach, vi } from "vitest";
import { useRunManager } from "./useRunManager";
import type { TestRunResult, RunResult, TestProgress, StartPtyResult } from "../types";

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
    used_opt_level: "O2",
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
    job_object_degraded: false,
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
      ptyStartTime: null,
      compileError: null,
      compileWarning: null,
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

  it("onPtyExit 写入当前 tab 的 ptyExitInfo 快照（含 durationMs）", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    // 触发 startInteractive 设置 ptyStartTime
    invokeMock.mockResolvedValueOnce({ status: "success", run_id: "x", compile_stdout: "", compile_stderr: "" });
    await useRunManager.getState().startInteractive("code");
    const before = Date.now();
    const exit = { exitCode: 0, killedBy: null };
    useRunManager.getState().onPtyExit(exit, 2048);
    const after = Date.now();

    const info = useRunManager.getState().ptyExitInfo;
    expect(info?.exitCode).toBe(0);
    expect(info?.maxRssKb).toBe(2048);
    expect(info?.durationMs).not.toBeNull();
    expect(info!.durationMs!).toBeGreaterThanOrEqual(0);
    expect(info!.durationMs!).toBeLessThanOrEqual(after - before + 100);
    // 快照隔离验证
    expect(useRunManager.getState().resultsByTab["tab-a"]?.ptyExitInfo).toEqual(info);

    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().ptyExitInfo).toBeNull();

    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().ptyExitInfo).toEqual(info);
  });

  it("stopInteractive 计算 durationMs", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce({ status: "success", run_id: "x", compile_stdout: "", compile_stderr: "" });
    await useRunManager.getState().startInteractive("code");
    invokeMock.mockResolvedValueOnce(true); // stop_pty_run
    await useRunManager.getState().stopInteractive();
    const info = useRunManager.getState().ptyExitInfo;
    expect(info?.killedBy).toBe("cancelled");
    expect(info?.durationMs).not.toBeNull();
    expect(info!.durationMs!).toBeGreaterThanOrEqual(0);
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

// ============ PTY 交互运行编译 warning 保留测试 ============
// 验证 StartPtyResult::Success 携带 compile_stderr（含 warning）时：
// - 状态保持 running（不变成 error）
// - compileWarning 写入 store + 发起 tab 快照
// - 不影响 compileError（语义分离）
// - PTY 会话正常建立（ptyRunId 非空）
describe("useRunManager PTY 编译 warning 保留", () => {
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
      ptyStartTime: null,
      compileError: null,
      compileWarning: null,
      activeTabId: null,
      resultsByTab: {},
    });
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("StartPtyResult success + 含 warning → 状态 running，compileWarning 存储，ptyRunId 非空", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    const warningStderr = "main.cpp:7:1: warning: non-void function does not return a value in all control paths [-Wreturn-type]";
    invokeMock.mockResolvedValueOnce({
      status: "success",
      run_id: "pty-1",
      compile_stdout: "",
      compile_stderr: warningStderr,
    });

    await useRunManager.getState().startInteractive("code");

    const s = useRunManager.getState();
    // 状态保持 running（不变成 error/done）
    expect(s.status).toBe("running");
    expect(s.kind).toBe("interactive");
    // PTY 会话正常建立
    expect(s.activeRunId).toBe("pty-1");
    expect(s.ptyRunId).toBe("pty-1");
    // compileWarning 存储
    expect(s.compileWarning).toBe(warningStderr);
    // compileError 保持 null（语义分离，warning 不应触发错误状态）
    expect(s.compileError).toBeNull();
    // 快照隔离
    expect(s.resultsByTab["tab-a"]?.compileWarning).toBe(warningStderr);
    expect(s.resultsByTab["tab-a"]?.compileError).toBeNull();
  });

  it("StartPtyResult success + 空 stderr → compileWarning 为 null（无 warning 不显示）", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce({
      status: "success",
      run_id: "pty-2",
      compile_stdout: "",
      compile_stderr: "",
    });

    await useRunManager.getState().startInteractive("code");

    const s = useRunManager.getState();
    expect(s.status).toBe("running");
    expect(s.ptyRunId).toBe("pty-2");
    expect(s.compileWarning).toBeNull();
  });

  it("StartPtyResult success + 仅空白 stderr → compileWarning 为 null", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce({
      status: "success",
      run_id: "pty-3",
      compile_stdout: "",
      compile_stderr: "   \n  \n",
    });

    await useRunManager.getState().startInteractive("code");

    const s = useRunManager.getState();
    expect(s.compileWarning).toBeNull();
  });

  it("StartPtyResult compile_failed → compileError 存储，compileWarning 保持 null", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce({
      status: "compile_failed",
      run_id: "x",
      stderr: "error: foo",
    });

    await useRunManager.getState().startInteractive("code");

    const s = useRunManager.getState();
    // 编译失败 → error 状态
    expect(s.status).toBe("error");
    expect(s.activeRunId).toBeNull();
    expect(s.ptyRunId).toBeNull();
    expect(s.compileError).toBe("error: foo");
    // warning 不应被设置
    expect(s.compileWarning).toBeNull();
  });

  it("compileWarning 写入发起 tab，切换 tab 隔离", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    const warning = "main.cpp:3:5: warning: unused variable 'x' [-Wunused-variable]";
    invokeMock.mockResolvedValueOnce({
      status: "success",
      run_id: "pty-4",
      compile_stdout: "",
      compile_stderr: warning,
    });

    await useRunManager.getState().startInteractive("code");

    // 切到 tab-b → 无 compileWarning
    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().compileWarning).toBeNull();

    // 切回 tab-a → 恢复 warning
    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().compileWarning).toBe(warning);
  });

  it("onPtyExit 后 compileWarning 保留在快照中（恢复查看时仍可见）", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    const warning = "main.cpp:7:1: warning: non-void function does not return a value";
    invokeMock.mockResolvedValueOnce({
      status: "success",
      run_id: "pty-5",
      compile_stdout: "",
      compile_stderr: warning,
    });
    await useRunManager.getState().startInteractive("code");

    // 模拟 PTY 退出
    useRunManager.getState().onPtyExit({ exitCode: 0, killedBy: null }, 1024);

    // 退出后 compileWarning 在当前 state 中保留（来自 tab-a 快照）
    expect(useRunManager.getState().compileWarning).toBe(warning);
    // 切走再切回，warning 仍在快照中
    useRunManager.getState().setActiveTab("tab-b");
    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().compileWarning).toBe(warning);
  });
});

// ============ 前端生成 runId 测试 ============
// 验证 compileRun / runTests 在 invoke 前生成 uuid 写入 activeRunId，
// 并将 runId 传给后端命令，让停止按钮在请求发出瞬间即可用。
describe("useRunManager 前端生成 runId", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      ptyStartTime: null,
      compileError: null,
      compileWarning: null,
      activeTabId: null,
      resultsByTab: {},
    });
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("compileRun 在 invoke 前设置 activeRunId，并传入 uuid 格式的 runId", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce(makeRunResult(true));

    const runPromise = useRunManager.getState().compileRun("code");

    // invoke 发起瞬间 activeRunId 应已设置（不等 await 完成）
    const activeDuringRun = useRunManager.getState().activeRunId;
    expect(activeDuringRun).not.toBeNull();
    expect(activeDuringRun).toMatch(UUID_RE);

    await runPromise;

    // invoke 收到 runId 参数
    const invokeArgs = invokeMock.mock.calls[0];
    expect(invokeArgs[0]).toBe("compile_and_run");
    const invokePayload = invokeArgs[1] as { runId?: string };
    expect(invokePayload.runId).toBe(activeDuringRun);
    expect(invokePayload.runId).toMatch(UUID_RE);

    // 完成后 activeRunId 被清除
    expect(useRunManager.getState().activeRunId).toBeNull();
  });

  it("runTests 在 invoke 前设置 activeRunId，并传入 uuid 格式的 runId", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce(makeTestRunResult(2, 4));

    const runPromise = useRunManager.getState().runTests("code", "suite-a", false);

    // invoke 发起瞬间 activeRunId 应已设置
    const activeDuringRun = useRunManager.getState().activeRunId;
    expect(activeDuringRun).not.toBeNull();
    expect(activeDuringRun).toMatch(UUID_RE);

    await runPromise;

    // invoke 收到 runId 参数（run_tests 的 payload）
    const runTestsCall = invokeMock.mock.calls.find((c) => c[0] === "run_tests");
    expect(runTestsCall).toBeDefined();
    const invokePayload = runTestsCall![1] as { runId?: string };
    expect(invokePayload.runId).toBe(activeDuringRun);
    expect(invokePayload.runId).toMatch(UUID_RE);

    // 完成后 activeRunId 被清除
    expect(useRunManager.getState().activeRunId).toBeNull();
  });

  it("compileRun 失败时也清除 activeRunId", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockRejectedValueOnce(new Error("network"));

    await useRunManager.getState().compileRun("code");

    expect(useRunManager.getState().activeRunId).toBeNull();
    expect(useRunManager.getState().status).toBe("error");
  });

  it("runTests 失败时也清除 activeRunId", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockRejectedValueOnce(new Error("network"));

    await useRunManager.getState().runTests("code", "suite-a", false);

    expect(useRunManager.getState().activeRunId).toBeNull();
    expect(useRunManager.getState().status).toBe("error");
  });
});

// ============ startInteractive 预生成 runId 测试 ============
// 验证 startInteractive 在 invoke 前生成 uuid 写入 activeRunId，
// 并将 runId 传给后端 start_pty_run 命令，让编译期停止按钮可用。
describe("useRunManager startInteractive 预生成 runId", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  beforeEach(() => {
    useRunManager.setState({
      activeRunId: null, kind: null, status: "idle",
      runResult: null, testResult: null, error: null, testProgress: null,
      ptyRunId: null, ptyExitInfo: null, ptyStartTime: null,
      compileError: null, compileWarning: null,
      activeTabId: null, resultsByTab: {},
    });
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("startInteractive 在 invoke 前设置 activeRunId，并传入 uuid 格式 runId", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce({
      status: "success",
      run_id: "pty-1",
      compile_stdout: "",
      compile_stderr: "",
    });

    const runPromise = useRunManager.getState().startInteractive("code");
    const activeDuringRun = useRunManager.getState().activeRunId;
    expect(activeDuringRun).not.toBeNull();
    expect(activeDuringRun).toMatch(UUID_RE);

    await runPromise;

    const call = invokeMock.mock.calls.find((c) => c[0] === "start_pty_run");
    expect(call).toBeDefined();
    const payload = call![1] as { runId?: string };
    expect(payload.runId).toBe(activeDuringRun);
    expect(payload.runId).toMatch(UUID_RE);
  });
});

// ============ stop 后旧请求覆盖守卫测试 ============
// 验证 compileRun/runTests/startInteractive 在 stop 后旧请求返回时，
// 回调检测 activeRunId !== runId，丢弃结果，不覆盖 idle 状态。
describe("useRunManager stop 后旧请求覆盖守卫", () => {
  beforeEach(() => {
    useRunManager.setState({
      activeRunId: null, kind: null, status: "idle",
      runResult: null, testResult: null, error: null, testProgress: null,
      ptyRunId: null, ptyExitInfo: null, ptyStartTime: null,
      compileError: null, compileWarning: null,
      activeTabId: null, resultsByTab: {},
    });
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("compileRun 在 stop 后返回成功结果，丢弃不覆盖 idle", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    let resolveRun: (v: RunResult) => void = () => {};
    invokeMock.mockReturnValueOnce(new Promise<RunResult>((res) => { resolveRun = res; }));

    const runPromise = useRunManager.getState().compileRun("code");
    const runId = useRunManager.getState().activeRunId;
    expect(runId).not.toBeNull();

    // 模拟 stop：把 activeRunId 设为 null，status 设为 idle
    useRunManager.setState({ activeRunId: null, status: "idle", kind: null });

    // 旧请求返回 success
    resolveRun(makeRunResult(true));
    await runPromise;

    // 状态应保持 idle，不被 done 覆盖
    expect(useRunManager.getState().status).toBe("idle");
    // 结果不写入快照
    expect(useRunManager.getState().resultsByTab["tab-a"]?.runResult ?? null).toBeNull();
  });

  it("runTests 在 stop 后返回结果，丢弃不覆盖 idle", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    let resolveRun: (v: TestRunResult) => void = () => {};
    invokeMock.mockReturnValueOnce(new Promise<TestRunResult>((res) => { resolveRun = res; }));

    const runPromise = useRunManager.getState().runTests("code", "suite-a", false);
    const runId = useRunManager.getState().activeRunId;
    expect(runId).not.toBeNull();

    // 模拟 stop
    useRunManager.setState({ activeRunId: null, status: "idle", kind: null });

    resolveRun(makeTestRunResult(2, 4));
    await runPromise;

    expect(useRunManager.getState().status).toBe("idle");
    expect(useRunManager.getState().resultsByTab["tab-a"]?.testResult ?? null).toBeNull();
  });

  it("startInteractive 在 stop 后返回 success，丢弃并调用 stop_pty_run 清理 PTY", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    let resolveRun: (v: StartPtyResult) => void = () => {};
    invokeMock.mockReturnValueOnce(new Promise<StartPtyResult>((res) => { resolveRun = res; }));

    const runPromise = useRunManager.getState().startInteractive("code");
    const runId = useRunManager.getState().activeRunId;
    expect(runId).not.toBeNull();

    // 模拟 stopInteractive 把 activeRunId 设为 null
    useRunManager.setState({
      activeRunId: null, status: "idle", kind: null,
      ptyRunId: null,
      ptyExitInfo: { exitCode: null, killedBy: "cancelled", durationMs: 100, maxRssKb: null },
      ptyStartTime: null,
    });

    // 旧请求返回 success（PTY 已建立）
    invokeMock.mockResolvedValueOnce(true); // stop_pty_run
    resolveRun({ status: "success", run_id: runId!, compile_stdout: "", compile_stderr: "" });
    await runPromise;

    // 状态保持 idle
    expect(useRunManager.getState().status).toBe("idle");
    // 应该调用了 stop_pty_run 清理 PTY
    const stopCall = invokeMock.mock.calls.find((c) => c[0] === "stop_pty_run");
    expect(stopCall).toBeDefined();
  });
});
