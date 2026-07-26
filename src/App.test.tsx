import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

// ============ Mock 配置（必须在 import App 之前） ============

// 用 vi.hoisted 声明 spy，确保 vi.mock 工厂能安全引用
const { collapseSpy, expandSpy, listenMock } = vi.hoisted(() => ({
  collapseSpy: vi.fn(),
  expandSpy: vi.fn(),
  listenMock: vi.fn().mockResolvedValue(() => {}),
}));

// mock react-resizable-panels：Panel 把 ref 暴露为 { collapse, expand }
vi.mock("react-resizable-panels", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    PanelGroup: ({ children }: { children: ReactNode }) => (
      <div data-testid="panel-group">{children}</div>
    ),
    Panel: forwardRef<ImperativePanelHandle>(
      ({ children, collapsible, collapsedSize, onCollapse, onExpand, minSize, defaultSize, ...rest }: any, ref: any) => {
        // 过滤掉 react-resizable-panels 专有 prop，避免传给 DOM
        void collapsible; void collapsedSize; void onCollapse; void onExpand; void minSize; void defaultSize;
        useImperativeHandle(ref, () => ({
          collapse: collapseSpy,
          expand: expandSpy,
          getId: () => "test",
          getSize: () => 50,
          resize: () => {},
          isCollapsed: () => false,
        }));
        return <div data-testid="panel" {...rest}>{children}</div>;
      }
    ),
    PanelResizeHandle: () => <div data-testid="resize-handle" />,
  };
});

// mock @tauri-apps/api/core（invoke）
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// mock @tauri-apps/api/window（getCurrentWindow().setTitle）
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTitle: vi.fn().mockResolvedValue(undefined),
  }),
}));

// mock @tauri-apps/api/event（listen）
vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

// mock 所有子组件为简单 div（EditorPane 的 ref 调用会用 ?. 安全跳过）
vi.mock("./components/TabBar", () => ({
  default: () => <div data-testid="tabbar" />,
}));
vi.mock("./components/Editor", () => ({
  default: () => <div data-testid="editor" />,
}));
vi.mock("./components/TestCasesPanel", () => ({
  default: () => <div data-testid="testcases" />,
}));
vi.mock("./components/Terminal", () => ({
  default: () => <div data-testid="terminal" />,
}));
vi.mock("./components/StatusBar", () => ({
  default: () => <div data-testid="statusbar" />,
}));
vi.mock("./components/SettingsPanel", () => ({
  default: () => <div data-testid="settings-panel" />,
}));
vi.mock("./components/RecentFilesDialog", () => ({
  default: () => <div data-testid="recent-dialog" />,
}));

// ============ 状态管理 ============

import { useSettings } from "./hooks/useSettings";
import { useRunManager } from "./hooks/useRunManager";
import { useTabs } from "./hooks/useTabs";
import { useTestSuite } from "./hooks/useTestSuite";
import { useI18n } from "./hooks/useI18n";
import { zh } from "./locales/zh";
import type { AppSettings } from "./types";

// 简单的 t 函数
function makeT() {
  return (key: string) => {
    const parts = key.split(".");
    let cur: unknown = zh;
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in cur) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return key;
      }
    }
    return typeof cur === "string" ? cur : key;
  };
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    compiler: {
      cpp_standard: "c++17", opt_level: "O0", warnings: "wall",
      extra_args: "", compiler_path: null, template: "",
    },
    runtime: {
      compile_timeout_secs: 10, run_timeout_secs: 5, cpu_secs: 5, fsize_mb: 64,
    },
    general: { locale: "zh", theme: "dark", layout: "horizontal", auto_hide_panel: false },
    test: { fsize_mb: 10, test_time_limit_ms: 1000 },
    editor: {
      font_size: 14, theme: "vs-dark", terminal_font_size: 14,
      indent_style: "space", indent_size: 4, line_numbers: "on",
      enable_suggestions: true, auto_closing_brackets: true, auto_closing_quotes: true,
      word_wrap: "off", minimap_enabled: false,
    },
    current_language: "cpp",
    schema_version: 3,
    ...overrides,
  };
}

function resetStores(settings: AppSettings) {
  useSettings.setState({
    settings,
    saving: false,
    load: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
  });
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
    compileRun: vi.fn(),
    runTests: vi.fn(),
    startInteractive: vi.fn(),
    stopInteractive: vi.fn(),
    onPtyExit: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  });
  useTabs.setState({
    tabs: [],
    activeId: null,
    newTab: vi.fn(),
    openTab: vi.fn(),
    openTabDialog: vi.fn(),
    closeTab: vi.fn(),
    closeAll: vi.fn(),
    switchTab: vi.fn(),
    saveTab: vi.fn(),
    saveTabAs: vi.fn(),
    setContent: vi.fn(),
    setSuiteId: vi.fn(),
    restore: vi.fn().mockResolvedValue(undefined),
    setOnCloseTabs: vi.fn(),
  });
  useTestSuite.setState({
    suiteId: null,
    setSuiteId: vi.fn(),
    ensureSuiteForDocPath: vi.fn().mockResolvedValue(null),
    ensureSuiteForUntitled: vi.fn().mockResolvedValue(null),
  });
  useI18n.setState({
    locale: "zh",
    t: makeT(),
    setLocale: vi.fn(),
  });
}

// ============ 测试 ============

// jsdom 缺失 matchMedia，App.tsx 的 system 主题监听需要
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// 动态 import App，确保所有 mock 先就位
const { default: App } = await import("./App");

describe("App 自动隐藏逻辑", () => {
  beforeEach(() => {
    collapseSpy.mockClear();
    expandSpy.mockClear();
    listenMock.mockClear();
    resetStores(makeSettings());
  });

  it("autoHide 从 false → true 时调用 collapse()", async () => {
    const { rerender } = render(<App />);

    // 等待 useEffect 执行
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 初始 autoHide=false，不应调用 collapse
    expect(collapseSpy).not.toHaveBeenCalled();

    // 切换 autoHide=true
    const newSettings = makeSettings({
      general: { locale: "zh", theme: "dark", layout: "horizontal", auto_hide_panel: true },
    });
    act(() => {
      useSettings.setState({ settings: newSettings });
    });

    rerender(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(collapseSpy).toHaveBeenCalledTimes(1);
  });

  it("autoHide 从 true → false 时调用 expand()", async () => {
    // 初始 autoHide=true
    const settingsTrue = makeSettings({
      general: { locale: "zh", theme: "dark", layout: "horizontal", auto_hide_panel: true },
    });
    resetStores(settingsTrue);

    const { rerender } = render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 初始 autoHide=true 会先触发 collapse（mount 时 autoHide 已为 true）
    collapseSpy.mockClear();

    // 切换 autoHide=false
    const settingsFalse = makeSettings({
      general: { locale: "zh", theme: "dark", layout: "horizontal", auto_hide_panel: false },
    });
    act(() => {
      useSettings.setState({ settings: settingsFalse });
    });

    rerender(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(expandSpy).toHaveBeenCalledTimes(1);
  });

  it("autoHide=true 且运行中时不调用 collapse()（保留展开）", async () => {
    const settingsTrue = makeSettings({
      general: { locale: "zh", theme: "dark", layout: "horizontal", auto_hide_panel: true },
    });
    resetStores(settingsTrue);

    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 初始 mount 时 autoHide=true 会触发 collapse
    collapseSpy.mockClear();

    // 模拟运行中状态
    act(() => {
      useRunManager.setState({ status: "running" });
    });

    // 再次触发 autoHide effect（通过 settings 变化触发 re-render）
    act(() => {
      useSettings.setState({
        settings: { ...settingsTrue, general: { ...settingsTrue.general, theme: "light" } },
      });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // autoHide 未变（仍为 true），effect 依赖 [autoHide] 不触发，collapse 不应被调用
    expect(collapseSpy).not.toHaveBeenCalled();
  });

  it("运行结束不自动折叠（保持展开直到用户手动收起）", async () => {
    // 此行为在 App.tsx 中体现为：handleRun 调用 expand()，但运行结束时不调用 collapse()
    // 由于 handleRun 是 App 内部闭包，这里通过验证 autoHide effect 仅在 autoHide 变化时触发来间接验证
    const settingsTrue = makeSettings({
      general: { locale: "zh", theme: "dark", layout: "horizontal", auto_hide_panel: true },
    });
    resetStores(settingsTrue);

    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // mount 时 autoHide=true 触发 collapse
    expect(collapseSpy).toHaveBeenCalledTimes(1);
    collapseSpy.mockClear();

    // 模拟运行中 → 运行结束（status 变化，但 autoHide 不变）
    act(() => {
      useRunManager.setState({ status: "running" });
      useRunManager.setState({ status: "idle" });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 运行结束不应触发 collapse（autoHide effect 依赖 [autoHide]，不依赖 status）
    expect(collapseSpy).not.toHaveBeenCalled();
  });
});

describe("面板关闭按钮联动 auto_hide_panel 设置", () => {
  beforeEach(() => {
    collapseSpy.mockClear();
    expandSpy.mockClear();
    listenMock.mockClear();
    resetStores(makeSettings());
  });

  it("点击面板关闭按钮触发 updateSettings({ auto_hide_panel: true }) 并 collapse()", async () => {
    const { container } = render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 初始 autoHide=false，collapse 不应被调用
    expect(collapseSpy).not.toHaveBeenCalled();

    // 找到 × 按钮
    const closeBtn = container.querySelector(".panel-close") as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();

    // 点击 ×
    await act(async () => {
      closeBtn.click();
    });

    // 验证 save 被调用，且 auto_hide_panel=true
    const saveMock = useSettings.getState().save as ReturnType<typeof vi.fn>;
    expect(saveMock).toHaveBeenCalledTimes(1);
    const savedSettings = saveMock.mock.calls[0][0] as AppSettings;
    expect(savedSettings.general.auto_hide_panel).toBe(true);

    // 验证 collapse 被调用
    expect(collapseSpy).toHaveBeenCalledTimes(1);
  });

  it("autoHide=true 时点 × 仍调用 save 和 collapse（幂等）", async () => {
    // 初始 autoHide=true
    const settingsTrue = makeSettings({
      general: { locale: "zh", theme: "dark", layout: "horizontal", auto_hide_panel: true },
    });
    resetStores(settingsTrue);

    const { container } = render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // mount 时 autoHide=true 触发 collapse
    collapseSpy.mockClear();
    const saveMock = useSettings.getState().save as ReturnType<typeof vi.fn>;
    saveMock.mockClear();

    const closeBtn = container.querySelector(".panel-close") as HTMLButtonElement;
    await act(async () => {
      closeBtn.click();
    });

    // 即使 autoHide 已为 true，× 仍调用 save（保持一致性）和 collapse
    expect(saveMock).toHaveBeenCalledTimes(1);
    const savedSettings = saveMock.mock.calls[0][0] as AppSettings;
    expect(savedSettings.general.auto_hide_panel).toBe(true);
    expect(collapseSpy).toHaveBeenCalledTimes(1);
  });
});
