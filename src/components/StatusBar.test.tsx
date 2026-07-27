import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StatusBar from "./StatusBar";
import { useRunManager } from "../hooks/useRunManager";
import { useSettings } from "../hooks/useSettings";
import { useI18n } from "../hooks/useI18n";
import { zh } from "../locales/zh";
import type { AppSettings } from "../types";

// 按点分路径取值
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function makeSettings(): AppSettings {
  return {
    compiler: {
      cpp_standard: "c++17",
      opt_level: "O0",
      warnings: "wall",
      extra_args: "",
      compiler_path: null,
      template: "",
    },
    runtime: {
      compile_timeout_secs: 10,
      run_timeout_secs: 5,
      cpu_secs: 5,
      fsize_mb: 64,
    },
    general: { locale: "zh", theme: "dark", layout: "horizontal", auto_hide_panel: false },
    test: { fsize_mb: 10, test_time_limit_ms: 1000 },
    editor: {
      font_size: 14,
      theme: "vs-dark",
      terminal_font_size: 14,
      indent_style: "space",
      indent_size: 4,
      line_numbers: "on",
      enable_suggestions: true,
      auto_closing_brackets: true,
      auto_closing_quotes: true,
      word_wrap: "off",
      minimap_enabled: false,
    },
    current_language: "cpp",
    schema_version: 3,
  };
}

function resetStores(settings: AppSettings, status: "idle" | "running" | "done" | "error" = "idle") {
  useSettings.setState({
    settings,
    saving: false,
    load: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
  });
  useRunManager.setState({
    activeRunId: null,
    kind: null,
    status,
    runResult: null,
    testResult: null,
    error: null,
    testProgress: null,
    ptyRunId: null,
    ptyExitInfo: null,
    compileError: null,
    activeTabId: null,
    resultsByTab: {},
    setActiveTab: vi.fn(),
    clearTab: vi.fn(),
    compileRun: vi.fn(),
    runTests: vi.fn(),
    startInteractive: vi.fn(),
    stopInteractive: vi.fn(),
    onPtyExit: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  });
  useI18n.setState({
    locale: "zh",
    t: (key: string, params?: Record<string, string | number>) => {
      let s = getByPath(zh, key);
      if (typeof s !== "string") return key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          s = (s as string).replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return s as string;
    },
    setLocale: vi.fn(),
  });
}

describe("StatusBar 主操作/停止状态语义", () => {
  beforeEach(() => {
    resetStores(makeSettings(), "idle");
  });

  it("idle 状态运行按钮使用品牌蓝（default 变体）", () => {
    render(<StatusBar onRun={() => {}} onFormat={() => {}} cursorLine={1} cursorColumn={1} />);
    const runBtn = screen.getByTitle(zh.toolbar.run);
    // default 变体包含 bg-primary 类
    expect(runBtn.className).toContain("bg-primary");
    expect(runBtn.className).not.toContain("bg-error");
  });

  it("running 状态停止按钮使用错误红（destructive 变体）", () => {
    resetStores(makeSettings(), "running");
    render(<StatusBar onRun={() => {}} onFormat={() => {}} cursorLine={1} cursorColumn={1} />);
    const stopBtn = screen.getByTitle(zh.toolbar.stop);
    // destructive 变体包含 bg-error 类
    expect(stopBtn.className).toContain("bg-error");
    expect(stopBtn.className).not.toContain("bg-primary");
  });

  it("running 状态点击停止按钮调用 stop()", async () => {
    const user = userEvent.setup();
    const stopSpy = vi.fn();
    resetStores(makeSettings(), "running");
    useRunManager.setState({ stop: stopSpy });

    render(<StatusBar onRun={() => {}} onFormat={() => {}} cursorLine={1} cursorColumn={1} />);
    await user.click(screen.getByTitle(zh.toolbar.stop));
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("idle 状态点击运行按钮调用 onRun", async () => {
    const user = userEvent.setup();
    const onRunSpy = vi.fn();
    render(<StatusBar onRun={onRunSpy} onFormat={() => {}} cursorLine={1} cursorColumn={1} />);
    await user.click(screen.getByTitle(zh.toolbar.run));
    expect(onRunSpy).toHaveBeenCalledTimes(1);
  });

  it("running 状态格式化按钮 disabled", () => {
    resetStores(makeSettings(), "running");
    render(<StatusBar onRun={() => {}} onFormat={() => {}} cursorLine={1} cursorColumn={1} />);
    const formatBtn = screen.getByTitle(zh.menu.format);
    expect(formatBtn).toBeDisabled();
  });
});

describe("StatusBar 窄窗口优先级类", () => {
  beforeEach(() => {
    resetStores(makeSettings(), "idle");
  });

  it("光标位置不带 low-priority 类（高优先级，窄窗口保留）", () => {
    render(<StatusBar onRun={() => {}} onFormat={() => {}} cursorLine={12} cursorColumn={34} />);
    // zh.status.cursorPos = "行 {line}, 列 {col}"，插值后为 "行 12, 列 34"
    const cursorText = screen.getByText("行 12, 列 34");
    const item = cursorText.closest(".status-item");
    expect(item).not.toBeNull();
    expect(item?.className).not.toContain("status-item-low-priority");
  });

  it("编译器信息不带 low-priority 类（高优先级，窄窗口保留）", () => {
    render(<StatusBar onRun={() => {}} onFormat={() => {}} cursorLine={1} cursorColumn={1} />);
    const compilerText = screen.getByText("clang++");
    const item = compilerText.closest(".status-item");
    expect(item).not.toBeNull();
    expect(item?.className).not.toContain("status-item-low-priority");
  });

  it("缩进信息带 low-priority 类（窄窗口隐藏）", () => {
    render(<StatusBar onRun={() => {}} onFormat={() => {}} cursorLine={1} cursorColumn={1} />);
    // zh.status.indentSpace = "空格: {n}"，插值后为 "空格: 4"
    const indentText = screen.getByText("空格: 4");
    const item = indentText.closest(".status-item");
    expect(item).not.toBeNull();
    expect(item?.className).toContain("status-item-low-priority");
  });

  it("编译参数带 low-priority 类（窄窗口隐藏）", () => {
    render(<StatusBar onRun={() => {}} onFormat={() => {}} cursorLine={1} cursorColumn={1} />);
    // 编译参数文案：-std=c++17 -O0 -Wall
    const argsText = screen.getByText("-std=c++17 -O0 -Wall");
    const item = argsText.closest(".status-item");
    expect(item).not.toBeNull();
    expect(item?.className).toContain("status-item-low-priority");
  });

  it("运行时长与内存带 low-priority 类（窄窗口隐藏）", () => {
    resetStores(makeSettings(), "done");
    useRunManager.setState({
      runResult: {
        run_id: "test-run",
        success: true,
        stdout: "",
        stderr: "",
        exit_code: 0,
        duration_ms: 42,
        killed_by: null,
        truncated: false,
        stage: "run",
        max_rss_kb: 2048,
      } as never,
    });

    render(<StatusBar onRun={() => {}} onFormat={() => {}} cursorLine={1} cursorColumn={1} />);
    // 时长 42 ms
    const durationItem = screen.getByText("42 ms").closest(".status-item");
    expect(durationItem?.className).toContain("status-item-low-priority");
    // 内存 2.0 MB
    const memItem = screen.getByText("2.0 MB").closest(".status-item");
    expect(memItem?.className).toContain("status-item-low-priority");
  });
});
