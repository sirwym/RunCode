import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RunKind, RunResult, TestRunResult, AppErrorPayload, TestProgress } from "../types";
import { getT } from "./useI18n";

// 运行状态：idle 空闲 / running 运行中 / done 成功结束 / error 出错
export type RunStatus = "idle" | "running" | "done" | "error";

// PTY 退出信息
export interface PtyExitInfo {
  exitCode: number | null;
  killedBy: string | null;
}

// 把后端 AppError（{code, params}）或任意异常转为本地化文案
function localizeError(e: unknown): string {
  const t = getT();
  const err = e as AppErrorPayload;
  if (err && typeof err === "object" && typeof err.code === "string") {
    return t(`errors.${err.code}`, err.params);
  }
  return typeof e === "string" ? e : String(e);
}

interface RunManagerState {
  // 统一状态
  activeRunId: string | null;
  kind: RunKind | null;
  status: RunStatus;

  // 结果（按 kind 分离）
  runResult: RunResult | null;
  testResult: TestRunResult | null;
  error: string | null;

  // 测试逐例进度
  testProgress: TestProgress | null;

  // PTY 交互运行
  ptyRunId: string | null;
  ptyExitInfo: PtyExitInfo | null;

  // 操作
  compileRun: (code: string, stdin?: string) => Promise<void>;
  runTests: (code: string, suiteId: string, strict: boolean) => Promise<void>;
  startInteractive: (code: string) => Promise<void>;
  stopInteractive: () => Promise<void>;
  onPtyExit: (info: PtyExitInfo) => void;
  stop: () => Promise<void>;
  reset: () => void;
}

// 统一运行会话管理（前端镜像后端 RunManager）。
// - 单活动任务互斥：activeRunId 非空时拒绝新任务（后端也会拒绝）
// - compileRun/runTests：等待完整结果返回
// - startInteractive：返回 run_id 后立即开始，输出通过事件流式推送
// - runTests：监听 test_progress 事件更新逐例进度
export const useRunManager = create<RunManagerState>((set, get) => ({
  activeRunId: null,
  kind: null,
  status: "idle",
  runResult: null,
  testResult: null,
  error: null,
  testProgress: null,
  ptyRunId: null,
  ptyExitInfo: null,

  compileRun: async (code, stdin) => {
    if (get().activeRunId) return;
    set({ status: "running", error: null, kind: "compile_run", testResult: null });
    try {
      const result = await invoke<RunResult>("compile_and_run", { code, stdin });
      set({
        activeRunId: null,
        status: result.success ? "done" : "error",
        runResult: result,
        kind: null,
        error: null,
      });
    } catch (e) {
      set({
        activeRunId: null,
        status: "error",
        runResult: null,
        kind: null,
        error: localizeError(e),
      });
    }
  },

  runTests: async (code, suiteId, strict) => {
    if (get().activeRunId) return;
    set({
      status: "running",
      error: null,
      kind: "test_run",
      runResult: null,
      testResult: null,
      testProgress: null,
    });

    // 监听逐例进度
    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await listen<TestProgress>("test_progress", (e) => {
        set({ testProgress: e.payload });
      });
    } catch {
      // 监听失败忽略
    }

    try {
      const result = await invoke<TestRunResult>("run_tests", { code, suiteId, strict });
      set({
        activeRunId: null,
        status: result.success ? "done" : "error",
        testResult: result,
        kind: null,
        error: null,
      });
    } catch (e) {
      set({
        activeRunId: null,
        status: "error",
        testResult: null,
        kind: null,
        error: localizeError(e),
      });
    } finally {
      if (unlisten) unlisten();
    }
  },

  startInteractive: async (code) => {
    if (get().activeRunId) return;
    set({
      status: "running",
      error: null,
      kind: "interactive",
      runResult: null,
      testResult: null,
      ptyExitInfo: null,
    });
    try {
      const runId = await invoke<string>("start_pty_run", { code });
      set({ activeRunId: runId, ptyRunId: runId });
    } catch (e) {
      set({
        activeRunId: null,
        status: "error",
        ptyRunId: null,
        kind: null,
        error: localizeError(e),
      });
    }
  },

  stopInteractive: async () => {
    const runId = get().activeRunId;
    if (!runId) return;
    try {
      await invoke<boolean>("stop_pty_run", { runId });
    } catch {
      // 忽略
    }
    set({
      activeRunId: null,
      ptyRunId: null,
      status: "idle",
      kind: null,
      ptyExitInfo: { exitCode: null, killedBy: "cancelled" },
    });
  },

  onPtyExit: (info) => {
    set({
      activeRunId: null,
      ptyRunId: null,
      status: "idle",
      kind: null,
      ptyExitInfo: info,
    });
  },

  stop: async () => {
    const runId = get().activeRunId;
    const kind = get().kind;
    if (!runId) return;

    if (kind === "interactive") {
      await get().stopInteractive();
      return;
    }

    try {
      await invoke<boolean>("stop_run", { runId });
    } catch {
      // 忽略
    }
    set({ activeRunId: null, status: "idle", kind: null });
  },

  reset: () => {
    set({
      status: "idle",
      runResult: null,
      testResult: null,
      error: null,
      activeRunId: null,
      kind: null,
      ptyRunId: null,
      ptyExitInfo: null,
      testProgress: null,
    });
  },
}));
