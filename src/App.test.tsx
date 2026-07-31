import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";

// ============ Mock 配置（必须在 import App 之前） ============

// 用 vi.hoisted 声明 spy，确保 vi.mock 工厂能安全引用
const { collapseSpy, expandSpy, listenMock, capturedMenuHandlers } = vi.hoisted(() => ({
  collapseSpy: vi.fn(),
  expandSpy: vi.fn(),
  listenMock: vi.fn().mockResolvedValue(() => {}),
  capturedMenuHandlers: { current: null as Record<string, (val?: string) => void> | null },
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

// mock @tauri-apps/api/app（getVersion）
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.1.2"),
}));

// mock @tauri-apps/plugin-dialog（message）
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn().mockResolvedValue(undefined),
}));

// mock @tauri-apps/api/window（getCurrentWindow().setTitle + show）
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setTitle: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
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
  default: () => <div data-testid="editor" tabIndex={0} />,
}));
vi.mock("./components/TestCasesPanel", () => ({
  default: () => <div data-testid="testcases" className="testcases-panel" tabIndex={0} />,
}));
vi.mock("./components/Terminal", () => ({
  default: () => <div data-testid="terminal" tabIndex={0} />,
}));
vi.mock("./components/StatusBar", () => ({
  default: () => <div data-testid="statusbar" />,
}));
vi.mock("./components/SettingsPanel", () => ({
  default: () => <div data-testid="settings-panel" tabIndex={0} />,
}));
vi.mock("./components/RecentFilesDialog", () => ({
  default: () => <div data-testid="recent-dialog" />,
}));
vi.mock("./components/TitleBar", () => ({
  default: (props: any) => {
    capturedMenuHandlers.current = props.menuHandlers;
    return <div data-testid="titlebar" />;
  },
}));

// ============ 状态管理 ============

import { useSettings } from "./hooks/useSettings";
import { useRunManager } from "./hooks/useRunManager";
import { useTabs } from "./hooks/useTabs";
import { useTestSuite } from "./hooks/useTestSuite";
import { useTestOptions } from "./hooks/useTestOptions";
import { useI18n } from "./hooks/useI18n";
import { zh } from "./locales/zh";
import type { AppSettings, CustomThemeConfig, CustomThemeColors } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { message } from "@tauri-apps/plugin-dialog";

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
    test: { fsize_mb: 10, test_time_limit_ms: 1000, opt_level: "O2" },
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
    themePreview: null,
    setThemePreview: vi.fn((preview) => useSettings.setState({ themePreview: preview })),
    clearThemePreview: vi.fn(() => useSettings.setState({ themePreview: null })),
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
    ptyStartTime: null,
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
  useTestOptions.setState({ strict: false, toggleStrict: vi.fn() });
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
const { default: App, resolveRunShortcut } = await import("./App");

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

// ============ buildCustomThemeCssText 纯函数测试 ============
// 验证动态 CSS 变量生成的关键约束：
// - 编辑器 surface 用独立变量 --editor-surface-bg（单层合成）
// - 不得用不透明 --bg-terminal 覆盖编辑器 surface
// - editorAlpha 仅经 --editor-surface-bg 一次应用
// - Monaco editor.background 透明由 Editor.tsx 控制（见 Editor.test.ts）

const { buildCustomThemeCssText } = await import("./App");

function makeCustomThemeColors(overrides: Partial<CustomThemeColors> = {}): CustomThemeColors {
  return {
    bg: "#1e1e2e",
    panel_bg: "#181825",
    panel_bg_alt: "#11111b",
    text: "#fafafa",
    text_muted: "#a3a3a3",
    border: "#45475a",
    primary: "#3b65b8",
    primary_hover: "#4a78c9",
    primary_foreground: "#ffffff",
    primary_soft: "rgba(59,101,184,0.14)",
    primary_border: "rgba(59,101,184,0.40)",
    bg_terminal: "#1e1e2e",
    ...overrides,
  };
}

function makeCustomThemeConfig(overrides: Partial<CustomThemeConfig> = {}): CustomThemeConfig {
  return {
    image_file: "test.png",
    colors: makeCustomThemeColors(),
    base_mode: "dark",
    panel_alpha: 82,
    editor_alpha: 92,
    mask_opacity: 20,
    ...overrides,
  };
}

describe("buildCustomThemeCssText 编辑器 surface 单层透明度", () => {
  it("editor_alpha=72 时，--editor-surface-bg 为 rgba(..., 0.72)", () => {
    const custom = makeCustomThemeConfig({ editor_alpha: 72 });
    const css = buildCustomThemeCssText(custom, null);
    // bg_terminal=#1e1e2e → rgb(30, 30, 46)
    expect(css).toContain("--editor-surface-bg: rgba(30, 30, 46, 0.72)");
  });

  it("editor_alpha=100 时，--editor-surface-bg 为 rgba(..., 1)（完全不透明）", () => {
    const custom = makeCustomThemeConfig({ editor_alpha: 100 });
    const css = buildCustomThemeCssText(custom, null);
    expect(css).toContain("--editor-surface-bg: rgba(30, 30, 46, 1)");
  });

  it("editor_alpha=70 / 85 / 92 生成可辨识的差异值", () => {
    const css70 = buildCustomThemeCssText(makeCustomThemeConfig({ editor_alpha: 70 }), null);
    const css85 = buildCustomThemeCssText(makeCustomThemeConfig({ editor_alpha: 85 }), null);
    const css92 = buildCustomThemeCssText(makeCustomThemeConfig({ editor_alpha: 92 }), null);
    expect(css70).toContain("rgba(30, 30, 46, 0.7)");
    expect(css85).toContain("rgba(30, 30, 46, 0.85)");
    expect(css92).toContain("rgba(30, 30, 46, 0.92)");
    // 三者应互不相同
    const extract = (s: string) => s.match(/--editor-surface-bg: ([^;]+);/)?.[1];
    expect(extract(css70)).not.toBe(extract(css85));
    expect(extract(css85)).not.toBe(extract(css92));
    expect(extract(css70)).not.toBe(extract(css92));
  });

  it("--editor-surface-bg 使用 bg_terminal 的 RGB，而非 bg 的 RGB", () => {
    const custom = makeCustomThemeConfig({
      colors: makeCustomThemeColors({
        bg: "#0a0a0a",
        bg_terminal: "#1e1e2e",
      }),
    });
    const css = buildCustomThemeCssText(custom, null);
    // bg_terminal=#1e1e2e → rgb(30, 30, 46)，不是 bg 的 rgb(10, 10, 10)
    expect(css).toContain("--editor-surface-bg: rgba(30, 30, 46, 0.92)");
    expect(css).not.toContain("--editor-surface-bg: rgba(10, 10, 10");
  });
});

describe("buildCustomThemeCssText 不得用不透明 --bg-terminal 覆盖编辑器 surface", () => {
  it("--bg-terminal 仍以纯色 HEX 注入（供非编辑器场景兜底）", () => {
    const custom = makeCustomThemeConfig();
    const css = buildCustomThemeCssText(custom, null);
    // --bg-terminal 应为纯色 HEX 值
    expect(css).toContain("--bg-terminal: #1e1e2e");
  });

  it("动态样式中 --bg-terminal 不带 alpha 通道（不作为编辑器 surface）", () => {
    const custom = makeCustomThemeConfig({ editor_alpha: 72 });
    const css = buildCustomThemeCssText(custom, null);
    // 提取 --bg-terminal 行，验证是纯 HEX 而非 rgba()
    const bgTerminalLine = css.match(/--bg-terminal: ([^;]+);/);
    expect(bgTerminalLine).not.toBeNull();
    expect(bgTerminalLine![1].trim()).toBe("#1e1e2e");
    expect(bgTerminalLine![1]).not.toContain("rgba");
  });

  it("动态样式中 --editor-surface-bg 为半透明 rgba，与 --bg-terminal 是不同变量", () => {
    const custom = makeCustomThemeConfig({ editor_alpha: 72 });
    const css = buildCustomThemeCssText(custom, null);
    const editorSurfaceLine = css.match(/--editor-surface-bg: ([^;]+);/);
    const bgTerminalLine = css.match(/--bg-terminal: ([^;]+);/);
    expect(editorSurfaceLine).not.toBeNull();
    expect(bgTerminalLine).not.toBeNull();
    // editor-surface-bg 是 rgba 半透明
    expect(editorSurfaceLine![1]).toContain("rgba");
    expect(editorSurfaceLine![1]).toContain("0.72");
    // bg-terminal 是纯 HEX
    expect(bgTerminalLine![1].trim()).toBe("#1e1e2e");
    // 两者值不同
    expect(editorSurfaceLine![1].trim()).not.toBe(bgTerminalLine![1].trim());
  });

  it("动态样式不包含 --bg-terminal-alpha 变量（已废弃该映射路径）", () => {
    const custom = makeCustomThemeConfig();
    const css = buildCustomThemeCssText(custom, null);
    expect(css).not.toContain("--bg-terminal-alpha");
  });
});

describe("buildCustomThemeCssText panel / mask / 图片 URL", () => {
  it("panel_alpha=82 → --panel-bg-alpha 使用 panel_bg RGB（#181825 → 24,24,37）", () => {
    const custom = makeCustomThemeConfig({ panel_alpha: 82 });
    const css = buildCustomThemeCssText(custom, null);
    expect(css).toContain("--panel-bg-alpha: rgba(24, 24, 37, 0.82)");
  });

  it("--panel-bg-alpha 使用 panel_bg 的 RGB，而非 bg 的 RGB", () => {
    const custom = makeCustomThemeConfig({
      colors: makeCustomThemeColors({
        bg: "#0a0a0a",        // rgb(10, 10, 10)
        panel_bg: "#181825",  // rgb(24, 24, 37)
      }),
    });
    const css = buildCustomThemeCssText(custom, null);
    expect(css).toContain("--panel-bg-alpha: rgba(24, 24, 37, 0.82)");
    expect(css).not.toContain("--panel-bg-alpha: rgba(10, 10, 10");
  });

  it("--panel-bg-alt-alpha 也使用 panel_bg 的 RGB", () => {
    const custom = makeCustomThemeConfig({ panel_alpha: 80 });
    const css = buildCustomThemeCssText(custom, null);
    // panel_bg=#181825 → rgb(24, 24, 37), alpha = min(0.80+0.03, 1) ≈ 0.83
    // 浮点精度：0.8+0.03=0.8300000000000001，只检查前缀
    expect(css).toContain("--panel-bg-alt-alpha: rgba(24, 24, 37, 0.83");
  });

  it("panel_alpha=0 → alpha 为 0", () => {
    const css = buildCustomThemeCssText(makeCustomThemeConfig({ panel_alpha: 0 }), null);
    expect(css).toContain("--panel-bg-alpha: rgba(24, 24, 37, 0)");
  });

  it("panel_alpha=100 → alpha 为 1", () => {
    const css = buildCustomThemeCssText(makeCustomThemeConfig({ panel_alpha: 100 }), null);
    expect(css).toContain("--panel-bg-alpha: rgba(24, 24, 37, 1)");
  });

  it("mask_opacity=0 → --mask-opacity 为 0", () => {
    const css = buildCustomThemeCssText(makeCustomThemeConfig({ mask_opacity: 0 }), null);
    expect(css).toContain("--mask-opacity: 0");
  });

  it("mask_opacity=100 → --mask-opacity 为 1", () => {
    const css = buildCustomThemeCssText(makeCustomThemeConfig({ mask_opacity: 100 }), null);
    expect(css).toContain("--mask-opacity: 1");
  });

  it("mask_opacity=35 → --mask-opacity 为 0.35", () => {
    const custom = makeCustomThemeConfig({ mask_opacity: 35 });
    const css = buildCustomThemeCssText(custom, null);
    expect(css).toContain("--mask-opacity: 0.35");
  });

  it("bgImageUrl=null → --bg-image: none", () => {
    const custom = makeCustomThemeConfig();
    const css = buildCustomThemeCssText(custom, null);
    expect(css).toContain("--bg-image: none");
  });

  it("bgImageUrl 非 null → --bg-image: url(\"...\")", () => {
    const custom = makeCustomThemeConfig();
    const css = buildCustomThemeCssText(custom, "blob:http://localhost/abc");
    expect(css).toContain('--bg-image: url("blob:http://localhost/abc")');
  });
});

// ============ App 主题预览渲染测试 ============
// 验证 App 读取 useSettings.themePreview 并驱动 DOM：
// - themePreview 存在时 data-theme="custom"，注入 --editor-surface-bg
// - themePreview 清除时回退到持久化 settings 主题
// - 滑动期间 save_settings 调用次数为 0（由 SettingsPanel 测试覆盖，此处验证 App 不主动 save）

describe("App 主题预览渲染（themePreview 优先于持久化 settings）", () => {
  beforeEach(() => {
    collapseSpy.mockClear();
    expandSpy.mockClear();
    listenMock.mockClear();
    resetStores(makeSettings());
  });

  it("themePreview 存在时，document root 设置 data-theme=custom", async () => {
    const settings = makeSettings();
    resetStores(settings);
    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 初始无预览，data-theme 应为持久化主题（dark）
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    // 设置 themePreview：App 应强制 data-theme=custom
    const customTheme = makeCustomThemeConfig({ editor_alpha: 72 });
    act(() => {
      useSettings.setState({
        themePreview: { customTheme },
      });
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("custom");
  });

  it("themePreview 存在时，注入 --editor-surface-bg 反映预览的 editor_alpha", async () => {
    const settings = makeSettings();
    resetStores(settings);
    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 设置 themePreview：editor_alpha=72
    const customTheme = makeCustomThemeConfig({ editor_alpha: 72 });
    act(() => {
      useSettings.setState({
        themePreview: { customTheme },
      });
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const styleEl = document.getElementById("custom-theme-vars");
    expect(styleEl).not.toBeNull();
    const css = styleEl!.textContent ?? "";
    // bg_terminal=#1e1e2e → rgb(30, 30, 46)，alpha=0.72
    expect(css).toContain("--editor-surface-bg: rgba(30, 30, 46, 0.72)");
    // 同时设置 data-base-mode
    expect(document.documentElement.getAttribute("data-base-mode")).toBe("dark");
  });

  it("themePreview 变化时，--editor-surface-bg 实时更新（无需保存）", async () => {
    const settings = makeSettings();
    resetStores(settings);
    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 模拟滑块拖动：themePreview 从 72 → 85 → 92
    for (const alpha of [72, 85, 92]) {
      const customTheme = makeCustomThemeConfig({ editor_alpha: alpha });
      act(() => {
        useSettings.setState({
          themePreview: { customTheme },
        });
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      const styleEl = document.getElementById("custom-theme-vars");
      expect(styleEl).not.toBeNull();
      const css = styleEl!.textContent ?? "";
      expect(css).toContain(`rgba(30, 30, 46, 0.${alpha})`);
    }
  });

  it("themePreview 期间 save 调用次数为 0（App 不主动保存预览值）", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const settings = makeSettings();
    resetStores(settings);
    useSettings.setState({ save: saveMock });

    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 模拟多次滑块拖动
    for (const alpha of [72, 85, 92, 100]) {
      const customTheme = makeCustomThemeConfig({ editor_alpha: alpha });
      act(() => {
        useSettings.setState({ themePreview: { customTheme } });
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    // App 不应主动调用 save（预览值只在用户点保存时落盘）
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("清除 themePreview 后，data-theme 回退到持久化 settings 主题", async () => {
    const settings = makeSettings(); // theme: dark
    resetStores(settings);
    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 设置预览
    act(() => {
      useSettings.setState({
        themePreview: { customTheme: makeCustomThemeConfig() },
      });
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("custom");

    // 清除预览（模拟取消/关闭/Escape）
    act(() => {
      useSettings.setState({ themePreview: null });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 回退到持久化主题
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("清除 themePreview 后，--editor-surface-bg 注入的 style 被移除", async () => {
    const settings = makeSettings(); // theme: dark（非 custom）
    resetStores(settings);
    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 设置预览：注入 style
    act(() => {
      useSettings.setState({
        themePreview: { customTheme: makeCustomThemeConfig() },
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.getElementById("custom-theme-vars")).not.toBeNull();

    // 清除预览：style 应被移除
    act(() => {
      useSettings.setState({ themePreview: null });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.getElementById("custom-theme-vars")).toBeNull();
  });

  it("themePreview.imageUrl 非空时，--bg-image 用 blob URL（新图片预览路径）", async () => {
    const settings = makeSettings();
    resetStores(settings);
    render(<App />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 模拟新导入图片：themePreview 带 imageUrl
    const customTheme = makeCustomThemeConfig({ editor_alpha: 85 });
    act(() => {
      useSettings.setState({
        themePreview: { customTheme, imageUrl: "blob:http://localhost/preview.png" },
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const styleEl = document.getElementById("custom-theme-vars");
    expect(styleEl).not.toBeNull();
    const css = styleEl!.textContent ?? "";
    expect(css).toContain('--bg-image: url("blob:http://localhost/preview.png")');
    expect(css).toContain("--editor-surface-bg: rgba(30, 30, 46, 0.85)");
  });
});

// ============ Windows keydown 快捷键接管测试 ============
// jsdom 环境 navigator.platform 非 Mac，keydown handler 会被注册
// Editor 被 mock 为 div，editorRef.current 为 null，Monaco 相关快捷键验证不 crash 即可

describe("Windows keydown 快捷键接管", () => {
  beforeEach(() => {
    collapseSpy.mockClear();
    expandSpy.mockClear();
    listenMock.mockClear();
    resetStores(makeSettings());
  });

  it("Ctrl+N 触发 newTab", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });

    expect(useTabs.getState().newTab).toHaveBeenCalledWith("cpp");
  });

  it("Ctrl+S 触发 saveTab", async () => {
    useTabs.setState({ activeId: "tab1" });
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    expect(useTabs.getState().saveTab).toHaveBeenCalledWith("tab1");
  });

  it("Ctrl+Shift+S 触发 saveTabAs", async () => {
    useTabs.setState({ activeId: "tab1" });
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: "s", ctrlKey: true, shiftKey: true });

    expect(useTabs.getState().saveTabAs).toHaveBeenCalledWith("tab1");
  });

  it("Ctrl+W 终端无焦点时触发 closeTab", async () => {
    useTabs.setState({ activeId: "tab1" });
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: "w", ctrlKey: true });

    expect(useTabs.getState().closeTab).toHaveBeenCalledWith("tab1");
  });

  it("Ctrl+W 无 activeId 时不触发 closeTab", async () => {
    useTabs.setState({ activeId: null });
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: "w", ctrlKey: true });

    expect(useTabs.getState().closeTab).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+W 触发 closeAll", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: "w", ctrlKey: true, shiftKey: true });

    expect(useTabs.getState().closeAll).toHaveBeenCalled();
  });

  it("Ctrl+, 打开设置面板", async () => {
    const { container } = render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });

    // SettingsPanel mock 为 div，验证无 crash 即可（setSettingsOpen 内部状态）
    expect(container).toBeTruthy();
  });

  it("Ctrl+= 增大编辑器字号", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: "=", ctrlKey: true });

    const saveMock = useSettings.getState().save as ReturnType<typeof vi.fn>;
    expect(saveMock).toHaveBeenCalledTimes(1);
    const saved = saveMock.mock.calls[0][0] as AppSettings;
    expect(saved.editor.font_size).toBe(16); // 14 + 2
  });

  it("Ctrl+- 减小编辑器字号", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: "-", ctrlKey: true });

    const saveMock = useSettings.getState().save as ReturnType<typeof vi.fn>;
    expect(saveMock).toHaveBeenCalledTimes(1);
    const saved = saveMock.mock.calls[0][0] as AppSettings;
    expect(saved.editor.font_size).toBe(12); // 14 - 2
  });

  it("Ctrl+0 重置编辑器字号", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: "0", ctrlKey: true });

    const saveMock = useSettings.getState().save as ReturnType<typeof vi.fn>;
    expect(saveMock).toHaveBeenCalledTimes(1);
    const saved = saveMock.mock.calls[0][0] as AppSettings;
    expect(saved.editor.font_size).toBe(14); // FONT_SIZE_DEFAULT
  });

  it("Ctrl+F 不 crash（editorRef 为 null 时静默返回）", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // Editor mock 为 div，editorRef.current 为 null，triggerFind 应静默返回
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    // 无 crash 即通过
  });

  it("Ctrl+G 不 crash（editorRef 为 null 时静默返回）", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
  });

  it("Ctrl+Shift+G 不 crash 且不与 Ctrl+G 冲突", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: "g", ctrlKey: true, shiftKey: true });
    // 无 crash 即通过
  });

  it("Shift+Alt+F 触发格式化", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // formatRef.current 调用 invoke("format_code")，invoke 被 mock 为 resolve(undefined)
    // 内部会 catch 并处理，验证不 crash
    fireEvent.keyDown(window, { key: "f", shiftKey: true, altKey: true });
  });

  it("Ctrl+\\ 切换输出面板（调用 collapse）", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // 面板未折叠 → Ctrl+\ 调用 collapse
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(collapseSpy).toHaveBeenCalledTimes(1);
  });

  it("metaKey 为 true 时不触发任何快捷键", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    fireEvent.keyDown(window, { key: "n", ctrlKey: true, metaKey: true });
    expect(useTabs.getState().newTab).not.toHaveBeenCalled();
  });
});

// ============ 菜单 handler: toggle_devtools 和 about ============

describe("菜单 handler: toggle_devtools 和 about", () => {
  beforeEach(() => {
    collapseSpy.mockClear();
    expandSpy.mockClear();
    listenMock.mockClear();
    vi.mocked(invoke).mockClear();
    vi.mocked(getVersion).mockClear();
    vi.mocked(message).mockClear();
    resetStores(makeSettings());
  });

  it("toggle_devtools handler 调用 invoke(\"toggle_devtools\")", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    act(() => {
      capturedMenuHandlers.current?.toggle_devtools();
    });

    expect(invoke).toHaveBeenCalledWith("toggle_devtools");
  });

  it("about handler 使用 getVersion 获取版本并调用 message 显示信息", async () => {
    render(<App />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    await act(async () => {
      capturedMenuHandlers.current?.about();
    });

    expect(getVersion).toHaveBeenCalled();
    expect(message).toHaveBeenCalled();
    const msgArg = vi.mocked(message).mock.calls[0][0] as string;
    expect(msgArg).toContain("0.1.2");
    expect(msgArg).toContain("YuanMing");
    expect(msgArg).toContain("MIT License");
    expect(msgArg).toContain("https://github.com/YuanMing/RunCode");
  });
});

// ============ resolveRunShortcut 纯函数测试 ============
// 验证跨平台快捷键解析：macOS 用 Cmd，Windows 用 Ctrl，拒绝 Alt 和另一平台修饰键

describe("resolveRunShortcut 纯函数", () => {
  it("macOS: Cmd+Enter → terminal", () => {
    expect(resolveRunShortcut("Enter", true, false, false, false, true)).toBe("terminal");
  });
  it("macOS: Cmd+Shift+Enter → tests", () => {
    expect(resolveRunShortcut("Enter", true, false, true, false, true)).toBe("tests");
  });
  it("macOS: Ctrl+Enter → null（仅响应 Cmd）", () => {
    expect(resolveRunShortcut("Enter", false, true, false, false, true)).toBeNull();
  });
  it("macOS: Cmd+Ctrl+Enter → null（拒绝另一平台修饰键）", () => {
    expect(resolveRunShortcut("Enter", true, true, false, false, true)).toBeNull();
  });
  it("macOS: Cmd+Alt+Enter → null（拒绝 Alt）", () => {
    expect(resolveRunShortcut("Enter", true, false, false, true, true)).toBeNull();
  });
  it("Windows: Ctrl+Enter → terminal", () => {
    expect(resolveRunShortcut("Enter", false, true, false, false, false)).toBe("terminal");
  });
  it("Windows: Ctrl+Shift+Enter → tests", () => {
    expect(resolveRunShortcut("Enter", false, true, true, false, false)).toBe("tests");
  });
  it("Windows: Cmd+Enter → null（仅响应 Ctrl）", () => {
    expect(resolveRunShortcut("Enter", true, false, false, false, false)).toBeNull();
  });
  it("Windows: Ctrl+Alt+Enter → null（拒绝 Alt）", () => {
    expect(resolveRunShortcut("Enter", false, true, false, true, false)).toBeNull();
  });
  it("非 Enter 键 → null", () => {
    expect(resolveRunShortcut("a", false, true, false, false, false)).toBeNull();
  });
  it("无修饰键 Enter → null", () => {
    expect(resolveRunShortcut("Enter", false, false, false, false, false)).toBeNull();
  });
});

// ============ 运行快捷键全链路测试 ============
// 验证 App 集中 keydown 监听 → 焦点范围限定 → 面板展开 → 标签切换 → 运行回调
// jsdom 环境 navigator.platform 非 Mac，测试 Windows 快捷键（Ctrl+Enter / Ctrl+Shift+Enter）

describe("运行快捷键（App keydown 链路）", () => {
  function setupStores(suiteId: string | null) {
    resetStores(makeSettings());
    useTabs.setState({
      tabs: [{
        id: "tab1",
        path: null,
        fileName: "test.cpp",
        content: "int main(){}",
        savedContent: "int main(){}",
        dirty: false,
        language: "cpp",
        suiteId,
      }],
      activeId: "tab1",
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
      suiteId,
      setSuiteId: vi.fn(),
      ensureSuiteForDocPath: vi.fn().mockResolvedValue(null),
      ensureSuiteForUntitled: vi.fn().mockResolvedValue(null),
    });
    useTestOptions.setState({ strict: false, toggleStrict: vi.fn() });
  }

  async function settle() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  function getActiveTabText(container: HTMLElement): string {
    const tabs = container.querySelectorAll(".panel-tab");
    for (const t of tabs) {
      if (t.classList.contains("active")) return t.textContent ?? "";
    }
    return "";
  }

  beforeEach(() => {
    collapseSpy.mockClear();
    expandSpy.mockClear();
    listenMock.mockClear();
    setupStores("suite1");
  });

  it("编辑器焦点 Ctrl+Enter → 终端运行（参数正确，只调一次）", async () => {
    const { container } = render(<App />);
    await settle();

    const editor = container.querySelector('[data-testid="editor"]') as HTMLElement;
    editor.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

    expect(useRunManager.getState().startInteractive).toHaveBeenCalledTimes(1);
    expect(useRunManager.getState().startInteractive).toHaveBeenCalledWith("int main(){}");
    expect(useRunManager.getState().runTests).not.toHaveBeenCalled();
  });

  it("编辑器焦点 Ctrl+Shift+Enter → 多样例运行（参数正确，只调一次）", async () => {
    const { container } = render(<App />);
    await settle();

    const editor = container.querySelector('[data-testid="editor"]') as HTMLElement;
    editor.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, shiftKey: true });

    expect(useRunManager.getState().runTests).toHaveBeenCalledTimes(1);
    expect(useRunManager.getState().runTests).toHaveBeenCalledWith("int main(){}", "suite1", false);
    expect(useRunManager.getState().startInteractive).not.toHaveBeenCalled();
  });

  it("测试面板焦点 Ctrl+Enter → 终端运行", async () => {
    const { container } = render(<App />);
    await settle();

    const testcases = container.querySelector('[data-testid="testcases"]') as HTMLElement;
    testcases.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

    expect(useRunManager.getState().startInteractive).toHaveBeenCalledTimes(1);
    expect(useRunManager.getState().startInteractive).toHaveBeenCalledWith("int main(){}");
  });

  it("测试面板焦点 Ctrl+Shift+Enter → 多样例运行", async () => {
    const { container } = render(<App />);
    await settle();

    const testcases = container.querySelector('[data-testid="testcases"]') as HTMLElement;
    testcases.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, shiftKey: true });

    expect(useRunManager.getState().runTests).toHaveBeenCalledTimes(1);
    expect(useRunManager.getState().runTests).toHaveBeenCalledWith("int main(){}", "suite1", false);
  });

  it("测试标签按钮焦点（tab=tests 时 .right-panel 内）Ctrl+Enter → 终端运行", async () => {
    const { container } = render(<App />);
    await settle();

    // 点击 tests 标签按钮切换到 tests tab
    const testsTabBtn = container.querySelectorAll(".panel-tab")[1] as HTMLButtonElement;
    fireEvent.click(testsTabBtn);
    // 焦点在 tests 标签按钮上（在 .right-panel 内但不在 .testcases-panel 内）
    testsTabBtn.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

    expect(useRunManager.getState().startInteractive).toHaveBeenCalledTimes(1);
    expect(useRunManager.getState().startInteractive).toHaveBeenCalledWith("int main(){}");
  });

  it("auto_hide_panel=false 时运行仍调用 expand()", async () => {
    // makeSettings 默认 auto_hide_panel=false
    const { container } = render(<App />);
    await settle();

    const editor = container.querySelector('[data-testid="editor"]') as HTMLElement;
    editor.focus();
    expandSpy.mockClear(); // 清除 mount 期间的调用
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

    expect(expandSpy).toHaveBeenCalledTimes(1);
  });

  it("终端运行切换到 terminal 标签", async () => {
    const { container } = render(<App />);
    await settle();

    // 先切换到 tests tab
    const testsTabBtn = container.querySelectorAll(".panel-tab")[1] as HTMLButtonElement;
    fireEvent.click(testsTabBtn);
    expect(getActiveTabText(container)).toBe(zh.panel.tests);

    // 编辑器焦点下 Ctrl+Enter → 切换到 terminal
    const editor = container.querySelector('[data-testid="editor"]') as HTMLElement;
    editor.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

    expect(getActiveTabText(container)).toBe(zh.panel.terminal);
  });

  it("多样例运行切换到 tests 标签", async () => {
    const { container } = render(<App />);
    await settle();

    // 默认 tab 是 terminal
    expect(getActiveTabText(container)).toBe(zh.panel.terminal);

    const editor = container.querySelector('[data-testid="editor"]') as HTMLElement;
    editor.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, shiftKey: true });

    expect(getActiveTabText(container)).toBe(zh.panel.tests);
  });

  it("普通 Enter 不触发任何运行（测试输入框中正常换行）", async () => {
    const { container } = render(<App />);
    await settle();

    const testcases = container.querySelector('[data-testid="testcases"]') as HTMLElement;
    testcases.focus();
    fireEvent.keyDown(window, { key: "Enter" });

    expect(useRunManager.getState().startInteractive).not.toHaveBeenCalled();
    expect(useRunManager.getState().runTests).not.toHaveBeenCalled();
  });

  it("错误平台修饰键（metaKey）不触发", async () => {
    const { container } = render(<App />);
    await settle();

    const editor = container.querySelector('[data-testid="editor"]') as HTMLElement;
    editor.focus();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });

    expect(useRunManager.getState().startInteractive).not.toHaveBeenCalled();
    expect(useRunManager.getState().runTests).not.toHaveBeenCalled();
  });

  it("Alt 组合不触发", async () => {
    const { container } = render(<App />);
    await settle();

    const editor = container.querySelector('[data-testid="editor"]') as HTMLElement;
    editor.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, altKey: true });

    expect(useRunManager.getState().startInteractive).not.toHaveBeenCalled();
    expect(useRunManager.getState().runTests).not.toHaveBeenCalled();
  });

  it("重复按键（repeat=true）不触发", async () => {
    const { container } = render(<App />);
    await settle();

    const editor = container.querySelector('[data-testid="editor"]') as HTMLElement;
    editor.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, repeat: true });

    expect(useRunManager.getState().startInteractive).not.toHaveBeenCalled();
    expect(useRunManager.getState().runTests).not.toHaveBeenCalled();
  });

  it("输入法组合状态（isComposing=true）不触发", async () => {
    const { container } = render(<App />);
    await settle();

    const editor = container.querySelector('[data-testid="editor"]') as HTMLElement;
    editor.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, isComposing: true });

    expect(useRunManager.getState().startInteractive).not.toHaveBeenCalled();
    expect(useRunManager.getState().runTests).not.toHaveBeenCalled();
  });

  it("终端焦点不触发", async () => {
    const { container } = render(<App />);
    await settle();

    // tab 默认为 terminal，Terminal 在 .right-panel 内但 currentTab !== "tests"
    const terminal = container.querySelector('[data-testid="terminal"]') as HTMLElement;
    terminal.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

    expect(useRunManager.getState().startInteractive).not.toHaveBeenCalled();
    expect(useRunManager.getState().runTests).not.toHaveBeenCalled();
  });

  it("设置面板焦点不触发", async () => {
    const { container } = render(<App />);
    await settle();

    const settings = container.querySelector('[data-testid="settings-panel"]') as HTMLElement;
    settings.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

    expect(useRunManager.getState().startInteractive).not.toHaveBeenCalled();
    expect(useRunManager.getState().runTests).not.toHaveBeenCalled();
  });

  it("suiteId 暂未就绪时：打开 tests 标签但不调用 runTests", async () => {
    // 重新设置：suiteId 为 null，tab 也无 suiteId
    setupStores(null);
    const { container } = render(<App />);
    await settle();

    const editor = container.querySelector('[data-testid="editor"]') as HTMLElement;
    editor.focus();
    expandSpy.mockClear();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, shiftKey: true });

    // runTests 不应被调用（suiteId 未就绪）
    expect(useRunManager.getState().runTests).not.toHaveBeenCalled();
    // 但标签应切换到 tests
    expect(getActiveTabText(container)).toBe(zh.panel.tests);
    // 且面板应展开（revealPanel 无条件调用 expand）
    expect(expandSpy).toHaveBeenCalledTimes(1);
  });
});
