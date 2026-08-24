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
  /** PTY 运行耗时（毫秒），开始时间未记录时为 null */
  durationMs: number | null;
  /** 进程内存峰值（KB），后端无法获取时为 null */
  maxRssKb: number | null;
}

// 测试判定诊断信息（与后端 test_judge_info 事件对应，UI 展示 + DevTools Console）
export interface TestJudgeInfo {
  case_id: string;
  index: number;
  total: number;
  /** 最终生效的严格模式（case.strict || 全局 strict） */
  case_strict: boolean;
  exit_code: number | null;
  duration_ms: number;
  time_limit_ms: number;
  time_exceeded: boolean;
  passed: boolean;
  first_diff: number | null;
  norm_equal: boolean;
  expected_len: number;
  actual_len: number;
  /** 失败且输出较小时附带的转义全文（空格=· 换行=\n 等）；否则 null */
  expected_esc: string | null;
  actual_esc: string | null;
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

  /** 测试判定诊断（按 runId 归属，仅与同 runId 的 testResult 配套展示，
   *  避免 tab 快照恢复旧结果时串到新运行的诊断） */
  judgeInfo: { runId: string; byCase: Record<string, TestJudgeInfo> } | null;

  // PTY 交互运行
  ptyRunId: string | null;
  /** 当前 PTY 运行的发起 tab（快照写入键，不随 tab 切换变化） */
  ptyInitiatorTabId: string | null;
  ptyExitInfo: PtyExitInfo | null;
  /** PTY 运行开始时间戳（毫秒），用于计算 durationMs */
  ptyStartTime: number | null;

  /** PTY 就绪信号（单调递增计数器）：startInteractive 编译成功、PTY 建立后 +1。
   *  Terminal 监听其变化自动聚焦，光标立即闪烁提示"可以输入了"。
   *  仅递增、从不重置（reset/stop/exit 均不动它），避免跨运行取值碰撞。 */
  ptyReadySeq: number;

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
  runTests: (code: string, suiteId: string, strict: boolean, caseIds?: string[] | null) => Promise<void>;
  startInteractive: (code: string) => Promise<void>;
  stopInteractive: () => Promise<void>;
  onPtyExit: (info: Omit<PtyExitInfo, "durationMs" | "maxRssKb">, maxRssKb: number | null) => void;
  markPtyFirstInput: () => void;
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
  judgeInfo: null,
  ptyRunId: null,
  ptyInitiatorTabId: null,
  ptyExitInfo: null,
  ptyStartTime: null,
  ptyReadySeq: 0,
  compileError: null,
  activeTabId: null,
  resultsByTab: {},

  setActiveTab: (tabId) => {
    const s = get();
    // 同 tab 重复切换：no-op，不影响进行中的运行
    if (s.activeTabId === tabId) return;

    let resultsByTab = s.resultsByTab;
    // 切换 tab 即放弃当前运行：终止后端任务 + 删除发起 tab 快照（切回彻底空白）
    if (s.activeRunId) {
      // 运行存续期间 activeTabId 必为发起 tab（任何切换都会在此终止运行）
      const initiatorTabId = s.activeTabId;
      if (initiatorTabId) {
        resultsByTab = { ...resultsByTab };
        delete resultsByTab[initiatorTabId];
      }
      if (s.kind === "interactive") {
        // 含编译期（stop_pty_run 幂等）；后端 cancelled 标志保证 pty_exit 不再 emit
        void invoke<boolean>("stop_pty_run", { runId: s.activeRunId }).catch(() => {});
      } else {
        // 批量：异步取消后端，晚到结果由各 runId 守卫丢弃
        void invoke<boolean>("stop_run", { runId: s.activeRunId }).catch(() => {});
      }
    }

    const snapshot = tabId ? (resultsByTab[tabId] ?? emptyTabResults()) : emptyTabResults();
    set({
      ...(s.activeRunId
        ? {
            // 运行被切换终止：归零运行态（快照已删，不写"已取消"）
            activeRunId: null,
            ptyRunId: null,
            ptyInitiatorTabId: null,
            ptyStartTime: null,
            kind: null,
            status: "idle",
            error: null,
          }
        : {}),
      resultsByTab,
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
    // 前端生成 runId，invoke 前立即设置 activeRunId 让停止按钮可用
    const runId = crypto.randomUUID();
    set({
      activeRunId: runId,
      status: "running",
      error: null,
      kind: "compile_run",
      testResult: null,
    });
    try {
      const result = await invoke<RunResult>("compile_and_run", { code, stdin, runId });
      set((s) => {
        // 守卫：已被 stop 或被新任务替换，丢弃结果（不覆盖 idle）
        if (s.activeRunId !== runId) return s;
        const isStillActive = s.activeTabId === initiatorTabId;
        const isCompileFailed = result.stage === "compile_failed";
        const resultsByTab = initiatorTabId
          ? {
              ...s.resultsByTab,
              [initiatorTabId]: {
                runResult: result,
                testResult: s.resultsByTab[initiatorTabId]?.testResult ?? null,
                ptyExitInfo: s.resultsByTab[initiatorTabId]?.ptyExitInfo ?? null,
                compileError: isCompileFailed ? result.stderr : s.resultsByTab[initiatorTabId]?.compileError ?? null,
              },
            }
          : s.resultsByTab;
        return {
          activeRunId: null,
          status: result.success ? "done" : "error",
          runResult: isStillActive ? result : s.runResult,
          compileError: isStillActive && isCompileFailed ? result.stderr : s.compileError,
          kind: null,
          error: null,
          resultsByTab,
        };
      });
    } catch (e) {
      set((s) => {
        // 守卫：已被 stop 或被新任务替换，丢弃错误
        if (s.activeRunId !== runId) return s;
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

  runTests: async (code, suiteId, strict, caseIds) => {
    if (get().activeRunId) return;
    const initiatorTabId = get().activeTabId;
    // 前端生成 runId，invoke 前立即设置 activeRunId 让停止按钮可用
    const runId = crypto.randomUUID();
    set({
      activeRunId: runId,
      status: "running",
      error: null,
      kind: "test_run",
      runResult: null,
      testResult: null,
      testProgress: null,
      // 初始化而非 null：旧 run 的残余监听事件会被 runId 守卫挡住，
      // 避免其在 null 期抢占播种错误 runId（新 run 事件反而被挡）
      judgeInfo: { runId, byCase: {} },
    });

    // 监听逐例进度
    let unlisten: UnlistenFn | null = null;
    // 监听判定诊断信息：存入 judgeInfo 供 UI 展示，同时打印 DevTools Console 辅助排查
    let unlistenJudge: UnlistenFn | null = null;
    try {
      unlisten = await listen<TestProgress>("test_progress", (e) => {
        // 守卫：切换 tab 终止运行后（activeRunId 已清），旧进度事件不再刷新新 tab
        if (get().activeRunId !== runId) return;
        set({ testProgress: e.payload });
      });
      unlistenJudge = await listen<TestJudgeInfo>("test_judge_info", (e) => {
        const p = e.payload;
        const tag = p.passed ? "PASS" : "FAIL";
        console.log(
          `[Judge ${p.index + 1}/${p.total}] ${tag} case=${p.case_id} strict=${p.case_strict} exit=${p.exit_code} ${p.duration_ms}/${p.time_limit_ms}ms${p.time_exceeded ? " TLE" : ""} diff=${p.first_diff} eq=${p.norm_equal} len=${p.expected_len}/${p.actual_len}`,
        );
        if (p.expected_esc != null && p.actual_esc != null) {
          console.log(`  expected: [${p.expected_esc}]  actual: [${p.actual_esc}]`);
        } else if (!p.passed) {
          console.log("  (输出较大，使用「对比差异」查看)");
        }
        // 存入 state（runId 守卫：旧 run 残余监听不写入新 run 的诊断）
        set((s) => {
          if (s.judgeInfo?.runId !== runId) return s;
          return {
            judgeInfo: {
              runId,
              byCase: { ...s.judgeInfo.byCase, [p.case_id]: p },
            },
          };
        });
      });
    } catch (err) {
      console.warn("[useRunManager] test_progress 监听注册失败，测试进度将无反馈", err);
    }

    // 守卫：listen await 期间用户点 stop，stop 看到 activeRunId 还在但后端 session 还没注册，
    // stop_run 返回 false 但前端仍把 activeRunId 设为 null。
    // 这里检查后跳过 invoke，避免后端开始跑而前端已经 idle。
    if (get().activeRunId !== runId) {
      if (unlisten) unlisten();
      if (unlistenJudge) unlistenJudge();
      return;
    }

    try {
      const result = await invoke<TestRunResult>("run_tests", {
        code,
        suiteId,
        strict,
        caseIds: caseIds ?? null,
        runId,
      });
      set((s) => {
        // 守卫：已被 stop 或被新任务替换，丢弃结果
        if (s.activeRunId !== runId) return s;
        const isStillActive = s.activeTabId === initiatorTabId;
        const isCompileFailed = result.stage === "compile_failed";
        const resultsByTab = initiatorTabId
          ? {
              ...s.resultsByTab,
              [initiatorTabId]: {
                runResult: s.resultsByTab[initiatorTabId]?.runResult ?? null,
                testResult: result,
                ptyExitInfo: s.resultsByTab[initiatorTabId]?.ptyExitInfo ?? null,
                compileError: isCompileFailed ? result.compile_stderr : s.resultsByTab[initiatorTabId]?.compileError ?? null,
              },
            }
          : s.resultsByTab;
        return {
          activeRunId: null,
          status: result.success ? "done" : "error",
          testResult: isStillActive ? result : s.testResult,
          compileError: isStillActive && isCompileFailed ? result.compile_stderr : s.compileError,
          kind: null,
          error: null,
          resultsByTab,
        };
      });
    } catch (e) {
      set((s) => {
        // 守卫：已被 stop 或被新任务替换，丢弃错误
        if (s.activeRunId !== runId) return s;
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
      if (unlistenJudge) unlistenJudge();
    }
  },

  startInteractive: async (code) => {
    if (get().activeRunId) return;
    const initiatorTabId = get().activeTabId;
    // 前端预生成 runId，invoke 前设置 activeRunId + ptyRunId：
    // - activeRunId 让编译期停止按钮可用
    // - ptyRunId 提前设置让 Terminal 在 invoke 前就注册 pty_output/pty_exit 监听器，
    //   避免立即退出的程序（如 echo hi）事件在监听器注册前发完导致丢失
    const runId = crypto.randomUUID();
    set({
      activeRunId: runId,
      ptyRunId: runId,
      ptyInitiatorTabId: initiatorTabId,
      status: "running",
      error: null,
      kind: "interactive",
      runResult: null,
      testResult: null,
      ptyExitInfo: null,
      ptyStartTime: Date.now(),
      compileError: null,
    });
    try {
      const result = await invoke<StartPtyResult>("start_pty_run", { code, runId });
      if (result.status === "success") {
        // 守卫：编译期间被 stop，丢弃结果（PTY 已建立需清理）
        // stop_pty_run 已被 stopInteractive 调用，但 PTY 在 start_pty_run 返回后才创建，
        // stopInteractive 的 kill 是 no-op。这里再调一次确保 PTY 清理。
        // stop_pty_run 是幂等的，重复调用无害。
        if (get().activeRunId !== runId) {
          await invoke<boolean>("stop_pty_run", { runId }).catch(() => {});
          return;
        }
        set((s) => {
          const resultsByTab = initiatorTabId
            ? {
                ...s.resultsByTab,
                [initiatorTabId]: {
                  runResult: s.resultsByTab[initiatorTabId]?.runResult ?? null,
                  testResult: s.resultsByTab[initiatorTabId]?.testResult ?? null,
                  ptyExitInfo: s.resultsByTab[initiatorTabId]?.ptyExitInfo ?? null,
                  compileError: s.resultsByTab[initiatorTabId]?.compileError ?? null,
                },
              }
            : s.resultsByTab;
          return {
            activeRunId: result.run_id,
            ptyRunId: result.run_id,
            // 编译成功、PTY 建立：发出就绪信号，Terminal 自动聚焦（方案 B）
            ptyReadySeq: s.ptyReadySeq + 1,
            resultsByTab,
          };
        });
      } else {
        // 守卫：编译期间被 stop，丢弃结果
        if (get().activeRunId !== runId) return;
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
            ptyInitiatorTabId: null,
            kind: null,
            compileError: isStillActive ? result.stderr : s.compileError,
            resultsByTab,
          };
        });
      }
    } catch (e) {
      // 守卫：已被 stop，丢弃错误
      if (get().activeRunId !== runId) return;
      set({
        activeRunId: null,
        status: "error",
        ptyRunId: null,
        ptyInitiatorTabId: null,
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
    } catch (err) {
      console.warn("[useRunManager] stop_pty_run 调用失败", err);
    }
    const startTime = get().ptyStartTime;
    const durationMs = startTime ? Date.now() - startTime : null;
    const exitInfo: PtyExitInfo = { exitCode: null, killedBy: "cancelled", durationMs, maxRssKb: null };
    set((s) => {
      const initiatorTabId = s.ptyInitiatorTabId;
      const isStillActive = s.activeTabId === initiatorTabId;
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
        ptyInitiatorTabId: null,
        status: "idle",
        kind: null,
        ptyExitInfo: isStillActive ? exitInfo : s.ptyExitInfo,
        ptyStartTime: null,
        resultsByTab,
      };
    });
  },

  onPtyExit: (info, maxRssKb) => {
    set((s) => {
      // 切换 tab 已终止会话（ptyRunId 清空）：残余 pty_exit 事件直接忽略，
      // 不写快照（已删）、不破坏新 tab 可能已开始的新运行
      if (!s.ptyRunId) return s;
      const startTime = s.ptyStartTime;
      const durationMs = startTime ? Date.now() - startTime : null;
      const exitInfo: PtyExitInfo = { ...info, durationMs, maxRssKb };
      const initiatorTabId = s.ptyInitiatorTabId;
      const isStillActive = s.activeTabId === initiatorTabId;
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
        ptyInitiatorTabId: null,
        status: "idle",
        kind: null,
        ptyExitInfo: isStillActive ? exitInfo : s.ptyExitInfo,
        ptyStartTime: null,
        resultsByTab,
      };
    });
  },

  markPtyFirstInput: () => {
    // 后端 pty_first_input 事件触发，重置计时起点为首次输入时刻
    set({ ptyStartTime: Date.now() });
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
    } catch (err) {
      console.warn("[useRunManager] stop_run 调用失败", err);
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
      ptyInitiatorTabId: null,
      ptyExitInfo: null,
      ptyStartTime: null,
      testProgress: null,
      compileError: null,
    });
  },
}));
