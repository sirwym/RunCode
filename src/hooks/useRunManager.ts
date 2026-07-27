import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RunKind, RunResult, TestRunResult, AppErrorPayload, TestProgress, StartPtyResult } from "../types";
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

// 单个 tab 的运行结果快照（per-tab 隔离）
interface TabResults {
  runResult: RunResult | null;
  testResult: TestRunResult | null;
  ptyExitInfo: PtyExitInfo | null;
  compileError: string | null;
}

function emptyTabResults(): TabResults {
  return { runResult: null, testResult: null, ptyExitInfo: null, compileError: null };
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

  // 编译失败时的 stderr（PTY 交互模式下，编译失败不创建 PTY 会话，
  // 直接把 stderr 存这里供 Terminal 显示 + Editor 解析错误行）
  compileError: string | null;

  // per-tab 结果快照（按 tab id 索引）
  activeTabId: string | null;
  resultsByTab: Record<string, TabResults>;
  setActiveTab: (tabId: string | null) => void;
  clearTab: (tabId: string) => void;

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
  compileError: null,
  activeTabId: null,
  resultsByTab: {},

  setActiveTab: (tabId) => {
    const snapshot = tabId ? (get().resultsByTab[tabId] ?? emptyTabResults()) : emptyTabResults();
    set({
      activeTabId: tabId,
      runResult: snapshot.runResult,
      testResult: snapshot.testResult,
      ptyExitInfo: snapshot.ptyExitInfo,
      compileError: snapshot.compileError,
      // testProgress 是瞬时的，切换 tab 时清空
      testProgress: null,
    });
  },

  clearTab: (tabId) => {
    set((s) => {
      const next = { ...s.resultsByTab };
      delete next[tabId];
      return { resultsByTab: next };
    });
  },

  compileRun: async (code, stdin) => {
    if (get().activeRunId) return;
    const initiatorTabId = get().activeTabId;
    set({ status: "running", error: null, kind: "compile_run", testResult: null });
    try {
      const result = await invoke<RunResult>("compile_and_run", { code, stdin });
      set((s) => {
        const isStillActive = s.activeTabId === initiatorTabId;
        const resultsByTab = initiatorTabId
          ? {
              ...s.resultsByTab,
              [initiatorTabId]: {
                runResult: result,
                testResult: s.resultsByTab[initiatorTabId]?.testResult ?? null,
                ptyExitInfo: s.resultsByTab[initiatorTabId]?.ptyExitInfo ?? null,
                compileError: s.resultsByTab[initiatorTabId]?.compileError ?? null,
              },
            }
          : s.resultsByTab;
        return {
          activeRunId: null,
          status: result.success ? "done" : "error",
          runResult: isStillActive ? result : s.runResult,
          kind: null,
          error: null,
          resultsByTab,
        };
      });
    } catch (e) {
      set((s) => {
        const isStillActive = s.activeTabId === initiatorTabId;
        const resultsByTab = initiatorTabId
          ? {
              ...s.resultsByTab,
              [initiatorTabId]: {
                runResult: null,
                testResult: s.resultsByTab[initiatorTabId]?.testResult ?? null,
                ptyExitInfo: s.resultsByTab[initiatorTabId]?.ptyExitInfo ?? null,
                compileError: s.resultsByTab[initiatorTabId]?.compileError ?? null,
              },
            }
          : s.resultsByTab;
        return {
          activeRunId: null,
          status: "error",
          runResult: isStillActive ? null : s.runResult,
          kind: null,
          error: localizeError(e),
          resultsByTab,
        };
      });
    }
  },

  runTests: async (code, suiteId, strict) => {
    if (get().activeRunId) return;
    const initiatorTabId = get().activeTabId;
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
      set((s) => {
        const isStillActive = s.activeTabId === initiatorTabId;
        const resultsByTab = initiatorTabId
          ? {
              ...s.resultsByTab,
              [initiatorTabId]: {
                runResult: s.resultsByTab[initiatorTabId]?.runResult ?? null,
                testResult: result,
                ptyExitInfo: s.resultsByTab[initiatorTabId]?.ptyExitInfo ?? null,
                compileError: s.resultsByTab[initiatorTabId]?.compileError ?? null,
              },
            }
          : s.resultsByTab;
        return {
          activeRunId: null,
          status: result.success ? "done" : "error",
          testResult: isStillActive ? result : s.testResult,
          kind: null,
          error: null,
          resultsByTab,
        };
      });
    } catch (e) {
      set((s) => {
        const isStillActive = s.activeTabId === initiatorTabId;
        const resultsByTab = initiatorTabId
          ? {
              ...s.resultsByTab,
              [initiatorTabId]: {
                runResult: s.resultsByTab[initiatorTabId]?.runResult ?? null,
                testResult: null,
                ptyExitInfo: s.resultsByTab[initiatorTabId]?.ptyExitInfo ?? null,
                compileError: s.resultsByTab[initiatorTabId]?.compileError ?? null,
              },
            }
          : s.resultsByTab;
        return {
          activeRunId: null,
          status: "error",
          testResult: isStillActive ? null : s.testResult,
          kind: null,
          error: localizeError(e),
          resultsByTab,
        };
      });
    } finally {
      if (unlisten) unlisten();
    }
  },

  startInteractive: async (code) => {
    if (get().activeRunId) return;
    const initiatorTabId = get().activeTabId;
    set({
      status: "running",
      error: null,
      kind: "interactive",
      runResult: null,
      testResult: null,
      ptyExitInfo: null,
      compileError: null,
    });
    try {
      const result = await invoke<StartPtyResult>("start_pty_run", { code });
      if (result.status === "success") {
        set({ activeRunId: result.run_id, ptyRunId: result.run_id });
      } else {
        // 编译失败：后端返回 CompileFailed，不创建 PTY 会话
        set((s) => {
          const isStillActive = s.activeTabId === initiatorTabId;
          const resultsByTab = initiatorTabId
            ? {
                ...s.resultsByTab,
                [initiatorTabId]: {
                  runResult: s.resultsByTab[initiatorTabId]?.runResult ?? null,
                  testResult: s.resultsByTab[initiatorTabId]?.testResult ?? null,
                  ptyExitInfo: s.resultsByTab[initiatorTabId]?.ptyExitInfo ?? null,
                  compileError: result.stderr,
                },
              }
            : s.resultsByTab;
          return {
            activeRunId: null,
            status: "error",
            ptyRunId: null,
            kind: null,
            compileError: isStillActive ? result.stderr : s.compileError,
            resultsByTab,
          };
        });
      }
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
    const exitInfo: PtyExitInfo = { exitCode: null, killedBy: "cancelled" };
    set((s) => {
      const initiatorTabId = s.activeTabId;
      const resultsByTab = initiatorTabId
        ? {
            ...s.resultsByTab,
            [initiatorTabId]: {
              runResult: s.resultsByTab[initiatorTabId]?.runResult ?? null,
              testResult: s.resultsByTab[initiatorTabId]?.testResult ?? null,
              ptyExitInfo: exitInfo,
              compileError: s.resultsByTab[initiatorTabId]?.compileError ?? null,
            },
          }
        : s.resultsByTab;
      return {
        activeRunId: null,
        ptyRunId: null,
        status: "idle",
        kind: null,
        ptyExitInfo: exitInfo,
        resultsByTab,
      };
    });
  },

  onPtyExit: (info) => {
    set((s) => {
      const initiatorTabId = s.activeTabId;
      const resultsByTab = initiatorTabId
        ? {
            ...s.resultsByTab,
            [initiatorTabId]: {
              runResult: s.resultsByTab[initiatorTabId]?.runResult ?? null,
              testResult: s.resultsByTab[initiatorTabId]?.testResult ?? null,
              ptyExitInfo: info,
              compileError: s.resultsByTab[initiatorTabId]?.compileError ?? null,
            },
          }
        : s.resultsByTab;
      return {
        activeRunId: null,
        ptyRunId: null,
        status: "idle",
        kind: null,
        ptyExitInfo: info,
        resultsByTab,
      };
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
      compileError: null,
    });
  },
}));
