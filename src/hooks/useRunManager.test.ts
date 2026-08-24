import { describe, it, expect, beforeEach, vi } from "vitest";
import { useRunManager } from "./useRunManager";
import type { TestJudgeInfo } from "./useRunManager";
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
    job_object_degraded: false,
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
      judgeInfo: null,
      ptyRunId: null,
      ptyInitiatorTabId: null,
      ptyExitInfo: null,
      ptyStartTime: null,
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

  it("运行中切换 tab → 终止运行、删除发起 tab 快照、晚到结果被守卫丢弃", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    const resultA = makeTestRunResult(1, 4);

    // 让 invoke 返回一个 pending promise，便于中途切换 tab
    let resolveRun: (v: TestRunResult) => void = () => {};
    invokeMock.mockReturnValueOnce(new Promise<TestRunResult>((res) => { resolveRun = res; }));
    invokeMock.mockResolvedValueOnce(true); // stop_run（切换终止时 fire-and-forget 调用）

    const runPromise = useRunManager.getState().runTests("code", "suite-a", false);
    expect(useRunManager.getState().activeRunId).not.toBeNull();

    // 运行中切到 tab-b → 运行被终止，发起 tab 快照被删（含历史）
    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().activeTabId).toBe("tab-b");
    expect(useRunManager.getState().activeRunId).toBeNull();
    expect(useRunManager.getState().resultsByTab["tab-a"]).toBeUndefined();
    expect(invokeMock.mock.calls.some((c) => c[0] === "stop_run")).toBe(true);

    // 晚到的结果到达 → 被守卫丢弃，不写快照
    resolveRun(resultA);
    await runPromise;

    expect(useRunManager.getState().resultsByTab["tab-a"]).toBeUndefined();
    expect(useRunManager.getState().resultsByTab["tab-b"]?.testResult ?? null).toBeNull();
    // 当前展示（tab-b）的 testResult 仍为 null
    expect(useRunManager.getState().testResult).toBeNull();

    // 切回 tab-a → 彻底空白（历史快照已清）
    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().testResult).toBeNull();
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

    // 生产序列：clearTab 发生在切换 activeId 之后（App effect 按 activeId 变化触发，
    // 同 tab 重复 setActiveTab 不可达），这里用切走再切回模拟
    useRunManager.getState().setActiveTab("tab-b");
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

  it("切换终止会话后残余 onPtyExit 被忽略，不破坏新 tab 的后续运行", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce({ status: "success", run_id: "pty-1", compile_stdout: "", compile_stderr: "" });
    await useRunManager.getState().startInteractive("code");

    // PTY 运行中切到 tab-b → 会话被终止
    invokeMock.mockResolvedValueOnce(true); // stop_pty_run
    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().ptyRunId).toBeNull();

    // 残余 pty_exit 事件（切换前已发出、在途）→ 守卫忽略，不写快照
    useRunManager.getState().onPtyExit({ exitCode: 0, killedBy: null }, 2048);
    expect(useRunManager.getState().resultsByTab["tab-a"]).toBeUndefined();
    expect(useRunManager.getState().ptyExitInfo).toBeNull();
    expect(useRunManager.getState().activeRunId).toBeNull();

    // tab-b 立即开始新运行不受影响
    invokeMock.mockResolvedValueOnce({ status: "success", run_id: "pty-2", compile_stdout: "", compile_stderr: "" });
    await useRunManager.getState().startInteractive("code2");
    expect(useRunManager.getState().ptyRunId).toBe("pty-2");
    expect(useRunManager.getState().resultsByTab["tab-b"]?.ptyExitInfo ?? null).toBeNull();
  });

  it("切换终止会话后 stopInteractive 为 no-op（activeRunId 已清）", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce({ status: "success", run_id: "x", compile_stdout: "", compile_stderr: "" });
    await useRunManager.getState().startInteractive("code");

    // 运行中切到 tab-b → 运行已被 setActiveTab 终止
    invokeMock.mockResolvedValueOnce(true); // stop_pty_run（setActiveTab 调用）
    useRunManager.getState().setActiveTab("tab-b");

    invokeMock.mockClear();
    await useRunManager.getState().stopInteractive();
    // 无新增 stop_pty_run 调用，不写任何快照
    expect(invokeMock.mock.calls.some((c) => c[0] === "stop_pty_run")).toBe(false);
    expect(useRunManager.getState().resultsByTab["tab-a"]).toBeUndefined();
    expect(useRunManager.getState().resultsByTab["tab-b"]?.ptyExitInfo ?? null).toBeNull();
  });

  it("同 tab 重复切换 → no-op，进行中的运行不受影响", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce({ status: "success", run_id: "x", compile_stdout: "", compile_stderr: "" });
    await useRunManager.getState().startInteractive("code");
    const runId = useRunManager.getState().activeRunId;

    // 同 tab 重复 setActiveTab（关闭其他 tab 触发 activeId 不变的场景）
    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().activeRunId).toBe(runId);
    expect(useRunManager.getState().ptyRunId).toBe(runId);
    expect(invokeMock.mock.calls.some((c) => c[0] === "stop_pty_run")).toBe(false);
  });

  it("交互运行中切换 → stop_pty_run 被调，发起 tab 历史快照一并清空", async () => {
    useRunManager.getState().setActiveTab("tab-a");

    // 预置历史快照：先完成一次编译运行
    invokeMock.mockResolvedValueOnce(makeRunResult(true));
    await useRunManager.getState().compileRun("code");
    expect(useRunManager.getState().resultsByTab["tab-a"]?.runResult).not.toBeNull();

    // 再开始交互运行
    invokeMock.mockResolvedValueOnce({ status: "success", run_id: "pty-1", compile_stdout: "", compile_stderr: "" });
    await useRunManager.getState().startInteractive("code");

    // 切换 → 终止 + 历史快照一并删除
    invokeMock.mockResolvedValueOnce(true); // stop_pty_run
    useRunManager.getState().setActiveTab("tab-b");

    const s = useRunManager.getState();
    expect(s.activeRunId).toBeNull();
    expect(s.ptyRunId).toBeNull();
    expect(s.kind).toBeNull();
    expect(s.status).toBe("idle");
    expect(s.resultsByTab["tab-a"]).toBeUndefined(); // 含 compileRun 的历史
    expect(invokeMock.mock.calls.some((c) => c[0] === "stop_pty_run")).toBe(true);

    // 切回 tab-a → 彻底空白
    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().runResult).toBeNull();
    expect(useRunManager.getState().ptyExitInfo).toBeNull();
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
    invokeMock.mockResolvedValueOnce(true); // stop_run（切换终止时 fire-and-forget 调用）
    void useRunManager.getState().runTests("code", "suite-a", false);

    // 等待 listen 被调用
    await new Promise((r) => setTimeout(r, 0));
    holder.cb?.({ payload: progress });

    expect(useRunManager.getState().testProgress).toEqual(progress);
    // 切到 tab-b → testProgress 清空
    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().testProgress).toBeNull();
  });

  it("test_judge_info 事件按 case_id 存入 judgeInfo（runId 归属当前运行）", async () => {
    useRunManager.getState().setActiveTab("tab-a");

    type JudgeCb = (e: { payload: TestJudgeInfo }) => void;
    const holder: { cb: JudgeCb | null } = { cb: null };
    listenMock.mockImplementation(async (event: string, cb: JudgeCb) => {
      if (event === "test_judge_info") holder.cb = cb;
      return () => {};
    });

    invokeMock.mockReturnValueOnce(new Promise<TestRunResult>(() => {})); // 永不 resolve
    void useRunManager.getState().runTests("code", "suite-a", false);
    await new Promise((r) => setTimeout(r, 0));

    const runId = useRunManager.getState().activeRunId;
    expect(useRunManager.getState().judgeInfo).toEqual({ runId, byCase: {} });

    const judge: TestJudgeInfo = {
      case_id: "tc_0", index: 0, total: 2, case_strict: false,
      exit_code: 0, duration_ms: 5, time_limit_ms: 1000, time_exceeded: false,
      passed: false, first_diff: 3, norm_equal: false,
      expected_len: 10, actual_len: 10,
      expected_esc: "1 2\\n", actual_esc: "1··2\\n",
    };
    holder.cb?.({ payload: judge });

    expect(useRunManager.getState().judgeInfo).toEqual({ runId, byCase: { tc_0: judge } });
  });

  it("旧 run 的残余 judge 事件不写入新 run 的 judgeInfo", async () => {
    useRunManager.getState().setActiveTab("tab-a");

    type JudgeCb = (e: { payload: TestJudgeInfo }) => void;
    const holderA: { cb: JudgeCb | null } = { cb: null };
    listenMock.mockImplementation(async (event: string, cb: JudgeCb) => {
      // 只捕获第一次注册（run A 的监听），run B 注册时保留 A 的闭包
      if (event === "test_judge_info" && !holderA.cb) holderA.cb = cb;
      return () => {};
    });

    // run A（永不 resolve），随后切换 tab 终止
    invokeMock.mockReturnValueOnce(new Promise<TestRunResult>(() => {}));
    invokeMock.mockResolvedValueOnce(true); // stop_run
    void useRunManager.getState().runTests("code", "suite-a", false);
    await new Promise((r) => setTimeout(r, 0));
    useRunManager.getState().setActiveTab("tab-b");

    // run B 开始（judgeInfo 已重置为 B 的 runId）
    invokeMock.mockReturnValueOnce(new Promise<TestRunResult>(() => {}));
    void useRunManager.getState().runTests("code", "suite-b", false);
    await new Promise((r) => setTimeout(r, 0));
    const runB = useRunManager.getState().activeRunId;
    expect(useRunManager.getState().judgeInfo).toEqual({ runId: runB, byCase: {} });

    // run A 的残余 judge 事件到达 → runId 守卫挡住，不写入
    const stale: TestJudgeInfo = {
      case_id: "tc_9", index: 9, total: 10, case_strict: false,
      exit_code: 0, duration_ms: 1, time_limit_ms: 1000, time_exceeded: false,
      passed: true, first_diff: null, norm_equal: true,
      expected_len: 0, actual_len: 0, expected_esc: null, actual_esc: null,
    };
    holderA.cb?.({ payload: stale });
    expect(useRunManager.getState().judgeInfo).toEqual({ runId: runB, byCase: {} });
  });
});

// ============ PTY 交互运行编译成功状态测试 ============
// 验证 StartPtyResult::Success（含/不含 warning 的 compile_stderr）时：
// - 状态保持 running（不变成 error，警告不展示、被忽略）
// - 不影响 compileError（语义分离）
// - PTY 会话正常建立（ptyRunId 非空）
describe("useRunManager PTY 编译成功状态", () => {
  beforeEach(() => {
    useRunManager.setState({
      activeRunId: null,
      kind: null,
      status: "idle",
      runResult: null,
      testResult: null,
      error: null,
      testProgress: null,
      judgeInfo: null,
      ptyRunId: null,
      ptyInitiatorTabId: null,
      ptyExitInfo: null,
      ptyStartTime: null,
      compileError: null,
      activeTabId: null,
      resultsByTab: {},
    });
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("StartPtyResult success + 含 warning → 状态 running，PTY 建立，compileError 保持 null", async () => {
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
    // compileError 保持 null（warning 不应触发错误状态）
    expect(s.compileError).toBeNull();
  });

  it("StartPtyResult compile_failed → compileError 存储", async () => {
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
      judgeInfo: null,
      ptyRunId: null,
      ptyInitiatorTabId: null,
      ptyExitInfo: null,
      ptyStartTime: null,
      compileError: null,
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
      ptyRunId: null, ptyInitiatorTabId: null, ptyExitInfo: null, ptyStartTime: null,
      compileError: null,
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
      ptyRunId: null, ptyInitiatorTabId: null, ptyExitInfo: null, ptyStartTime: null,
      compileError: null,
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

// ============ compileRun / runTests 编译失败 compileError 统一接入测试 ============
// 验证功能1a：compileRun 和 runTests 编译失败时也设置 compileError，
// 与 startInteractive 行为一致，触发 Editor 行号定位。
describe("useRunManager compileRun/runTests 编译失败 compileError 接入", () => {
  function makeCompileFailedRunResult(): RunResult {
    return {
      run_id: "r-fail",
      success: false,
      stdout: "",
      stderr: "main.cpp:3:5: error: expected ';' before '}' token",
      exit_code: null,
      duration_ms: 100,
      killed_by: null,
      truncated: false,
      stage: "compile_failed",
      max_rss_kb: 0,
      job_object_degraded: false,
    };
  }

  function makeCompileFailedTestRunResult(): TestRunResult {
    return {
      run_id: "t-fail",
      success: false,
      total: 0,
      passed: 0,
      stage: "compile_failed",
      compile_stdout: "",
      compile_stderr: "main.cpp:3:5: error: 'x' was not declared in this scope",
      used_opt_level: "O2",
      results: [],
      job_object_degraded: false,
    };
  }

  beforeEach(() => {
    useRunManager.setState({
      activeRunId: null,
      kind: null,
      status: "idle",
      runResult: null,
      testResult: null,
      error: null,
      testProgress: null,
      judgeInfo: null,
      ptyRunId: null,
      ptyInitiatorTabId: null,
      ptyExitInfo: null,
      ptyStartTime: null,
      compileError: null,
      activeTabId: null,
      resultsByTab: {},
    });
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("compileRun 编译失败 → compileError 写入发起 tab + 全局 state", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce(makeCompileFailedRunResult());

    await useRunManager.getState().compileRun("code");

    const s = useRunManager.getState();
    expect(s.status).toBe("error");
    expect(s.compileError).toBe("main.cpp:3:5: error: expected ';' before '}' token");
    expect(s.resultsByTab["tab-a"]?.compileError).toBe("main.cpp:3:5: error: expected ';' before '}' token");
  });

  it("compileRun 编译失败后切到其他 tab → compileError 隔离", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce(makeCompileFailedRunResult());

    await useRunManager.getState().compileRun("code");

    // 切到 tab-b → 无 compileError
    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().compileError).toBeNull();

    // 切回 tab-a → 恢复 compileError
    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().compileError).toBe("main.cpp:3:5: error: expected ';' before '}' token");
  });

  it("runTests 编译失败 → compileError 写入 result.compile_stderr", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce(makeCompileFailedTestRunResult());

    await useRunManager.getState().runTests("code", "suite-a", false);

    const s = useRunManager.getState();
    expect(s.status).toBe("error");
    expect(s.compileError).toBe("main.cpp:3:5: error: 'x' was not declared in this scope");
    expect(s.resultsByTab["tab-a"]?.compileError).toBe("main.cpp:3:5: error: 'x' was not declared in this scope");
  });

  it("runTests 编译失败后切到其他 tab → compileError 隔离", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce(makeCompileFailedTestRunResult());

    await useRunManager.getState().runTests("code", "suite-a", false);

    // 切到 tab-b → 无 compileError
    useRunManager.getState().setActiveTab("tab-b");
    expect(useRunManager.getState().compileError).toBeNull();

    // 切回 tab-a → 恢复 compileError
    useRunManager.getState().setActiveTab("tab-a");
    expect(useRunManager.getState().compileError).toBe("main.cpp:3:5: error: 'x' was not declared in this scope");
  });

  it("compileRun 编译成功 → compileError 保持 null（不误设）", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce(makeRunResult(true));

    await useRunManager.getState().compileRun("code");

    const s = useRunManager.getState();
    expect(s.status).toBe("done");
    expect(s.compileError).toBeNull();
    expect(s.resultsByTab["tab-a"]?.compileError).toBeNull();
  });
});

// ============ PTY 就绪聚焦信号 ptyReadySeq 测试 ============
// 验证方案 B：startInteractive 编译成功、PTY 建立时发出单调递增信号，
// Terminal 监听其变化自动聚焦终端（光标闪烁提示可输入）。
describe("useRunManager PTY 就绪聚焦信号 ptyReadySeq", () => {
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
      ptyInitiatorTabId: null,
      ptyExitInfo: null,
      ptyStartTime: null,
      ptyReadySeq: 0,
      compileError: null,
      activeTabId: null,
      resultsByTab: {},
    });
    invokeMock.mockReset();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => {});
  });

  it("startInteractive 成功 → ptyReadySeq +1，连续两次运行递增到 2", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce({
      status: "success",
      run_id: "pty-1",
      compile_stdout: "",
      compile_stderr: "",
    });
    await useRunManager.getState().startInteractive("code");
    expect(useRunManager.getState().ptyReadySeq).toBe(1);

    // 结束第一次会话（activeRunId 清空），否则第二次 startInteractive 会被互斥守卫拦截
    useRunManager.getState().onPtyExit({ exitCode: 0, killedBy: null }, 1024);

    invokeMock.mockResolvedValueOnce({
      status: "success",
      run_id: "pty-2",
      compile_stdout: "",
      compile_stderr: "",
    });
    await useRunManager.getState().startInteractive("code");
    expect(useRunManager.getState().ptyReadySeq).toBe(2);
  });

  it("startInteractive 编译失败 → ptyReadySeq 不变（不聚焦，回编辑器改代码）", async () => {
    useRunManager.getState().setActiveTab("tab-a");
    invokeMock.mockResolvedValueOnce({
      status: "compile_failed",
      run_id: "x",
      stderr: "error: foo",
    });
    await useRunManager.getState().startInteractive("code");
    expect(useRunManager.getState().ptyReadySeq).toBe(0);
  });

  it("编译期间被 stop → invoke 返回 success 也不递增（守卫丢弃）", async () => {
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
      ptyStartTime: null,
    });

    // 旧请求返回 success（PTY 已建立）
    invokeMock.mockResolvedValueOnce(true); // stop_pty_run
    resolveRun({ status: "success", run_id: runId!, compile_stdout: "", compile_stderr: "" });
    await runPromise;

    // 就绪信号不递增
    expect(useRunManager.getState().ptyReadySeq).toBe(0);
    // 且调用了 stop_pty_run 清理 PTY
    const stopCall = invokeMock.mock.calls.find((c) => c[0] === "stop_pty_run");
    expect(stopCall).toBeDefined();
  });
});
