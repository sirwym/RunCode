import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettings, type ThemePreviewState } from "./useSettings";
import type { AppSettings, CustomThemeConfig } from "../types";

// mock @tauri-apps/api/core 的 invoke
const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

function makeCustomTheme(overrides: Partial<CustomThemeConfig> = {}): CustomThemeConfig {
  return {
    image_file: "test.png",
    colors: {
      bg: "#0a0a0a",
      panel_bg: "#141414",
      panel_bg_alt: "#1e1e1e",
      text: "#fafafa",
      text_muted: "#a3a3a3",
      border: "#2a2a2a",
      primary: "#3b65b8",
      primary_hover: "#4a74c6",
      primary_foreground: "#ffffff",
      primary_soft: "rgba(59, 101, 184, 0.14)",
      primary_border: "rgba(59, 101, 184, 0.40)",
      bg_terminal: "#1e1e2e",
    },
    base_mode: "dark",
    panel_alpha: 82,
    editor_alpha: 92,
    mask_opacity: 20,
    ...overrides,
  };
}

describe("useSettings themePreview 临时主题预览状态", () => {
  beforeEach(() => {
    useSettings.setState({
      settings: null,
      loading: false,
      saving: false,
      error: null,
      themePreview: null,
    });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("初始 themePreview 为 null", () => {
    expect(useSettings.getState().themePreview).toBeNull();
  });

  it("setThemePreview 设置预览状态（含 customTheme + imageUrl）", () => {
    const customTheme = makeCustomTheme();
    const preview: ThemePreviewState = { customTheme, imageUrl: "blob:http://localhost/test" };
    useSettings.getState().setThemePreview(preview);
    expect(useSettings.getState().themePreview).toEqual(preview);
  });

  it("clearThemePreview 清除预览状态", () => {
    const customTheme = makeCustomTheme();
    useSettings.getState().setThemePreview({ customTheme, imageUrl: "blob:test" });
    expect(useSettings.getState().themePreview).not.toBeNull();
    useSettings.getState().clearThemePreview();
    expect(useSettings.getState().themePreview).toBeNull();
  });

  it("setThemePreview(null) 等同于 clearThemePreview", () => {
    const customTheme = makeCustomTheme();
    useSettings.getState().setThemePreview({ customTheme });
    useSettings.getState().setThemePreview(null);
    expect(useSettings.getState().themePreview).toBeNull();
  });

  it("themePreview 不影响持久化 settings（分开存储）", () => {
    const settings: AppSettings = {
      compiler: {
        cpp_standard: "c++17",
        opt_level: "O0",
        warnings: "wall",
        extra_args: "",
        compiler_path: null,
        template: "",
      },
      runtime: { compile_timeout_secs: 10, run_timeout_secs: 5, cpu_secs: 5, fsize_mb: 64 },
      general: { locale: "zh", theme: "dark", layout: "horizontal", auto_hide_panel: false },
      test: { fsize_mb: 10, test_time_limit_ms: 1000, opt_level: "O2" },
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
    useSettings.setState({ settings });
    const customTheme = makeCustomTheme({ panel_alpha: 75, editor_alpha: 84, mask_opacity: 35 });
    useSettings.getState().setThemePreview({ customTheme });
    // settings 不应被 themePreview 修改
    expect(useSettings.getState().settings).toEqual(settings);
    expect(useSettings.getState().settings?.general.custom_theme).toBeUndefined();
    // themePreview 持有临时值
    expect(useSettings.getState().themePreview?.customTheme.panel_alpha).toBe(75);
  });

  it("save 成功后 settings 更新，但 themePreview 需手动清除（由调用方负责）", async () => {
    const settings: AppSettings = {
      compiler: {
        cpp_standard: "c++17",
        opt_level: "O0",
        warnings: "wall",
        extra_args: "",
        compiler_path: null,
        template: "",
      },
      runtime: { compile_timeout_secs: 10, run_timeout_secs: 5, cpu_secs: 5, fsize_mb: 64 },
      general: { locale: "zh", theme: "custom", layout: "horizontal", auto_hide_panel: false },
      test: { fsize_mb: 10, test_time_limit_ms: 1000, opt_level: "O2" },
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
    useSettings.setState({ settings });
    useSettings.getState().setThemePreview({ customTheme: makeCustomTheme() });
    await useSettings.getState().save(settings);
    // save 只更新 settings，不自动清除 themePreview（由 SettingsPanel.handleSave 负责）
    expect(useSettings.getState().settings).toEqual(settings);
    expect(useSettings.getState().themePreview).not.toBeNull();
  });

  it("save 失败时 themePreview 保留（让用户可继续调整）", async () => {
    invokeMock.mockRejectedValue(new Error("disk full"));
    const settings: AppSettings = {
      compiler: {
        cpp_standard: "c++17",
        opt_level: "O0",
        warnings: "wall",
        extra_args: "",
        compiler_path: null,
        template: "",
      },
      runtime: { compile_timeout_secs: 10, run_timeout_secs: 5, cpu_secs: 5, fsize_mb: 64 },
      general: { locale: "zh", theme: "custom", layout: "horizontal", auto_hide_panel: false },
      test: { fsize_mb: 10, test_time_limit_ms: 1000, opt_level: "O2" },
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
    useSettings.setState({ settings });
    useSettings.getState().setThemePreview({ customTheme: makeCustomTheme() });
    await expect(useSettings.getState().save(settings)).rejects.toThrow("disk full");
    // 保存失败：themePreview 仍保留
    expect(useSettings.getState().themePreview).not.toBeNull();
    expect(useSettings.getState().saving).toBe(false);
  });
});

describe("useSettings save 乐观更新与回滚", () => {
  function makeSettings(font_size: number): AppSettings {
    return {
      compiler: {
        cpp_standard: "c++17",
        opt_level: "O0",
        warnings: "wall",
        extra_args: "",
        compiler_path: null,
        template: "",
      },
      runtime: { compile_timeout_secs: 10, run_timeout_secs: 5, cpu_secs: 5, fsize_mb: 64 },
      general: { locale: "zh", theme: "dark", layout: "horizontal", auto_hide_panel: false },
      test: { fsize_mb: 10, test_time_limit_ms: 1000, opt_level: "O2" },
      editor: {
        font_size,
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

  beforeEach(() => {
    useSettings.setState({
      settings: null,
      loading: false,
      saving: false,
      error: null,
      themePreview: null,
    });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("乐观更新：save 调用后 settings 立即更新（不等 invoke resolve）", async () => {
    const initial = makeSettings(14);
    const next = makeSettings(16);
    useSettings.setState({ settings: initial });

    // invoke 不立即 resolve（用未 settle 的 Promise）
    invokeMock.mockReturnValue(new Promise(() => {}));

    // 调用 save，不 await
    const savePromise = useSettings.getState().save(next);

    // invoke 还在 pending，但 settings 已经更新
    expect(useSettings.getState().settings).toEqual(next);
    expect(useSettings.getState().saving).toBe(true);

    // 清理：让 promise settle（避免 unhandled rejection）
    invokeMock.mockResolvedValue(undefined);
    // 重新调用需要等原 promise，这里直接验证状态后不等待
    // 标记为已处理避免警告
    savePromise.catch(() => {});
  });

  it("成功后 saving 变 false，settings 保持新值", async () => {
    const initial = makeSettings(14);
    const next = makeSettings(20);
    useSettings.setState({ settings: initial });

    await useSettings.getState().save(next);

    expect(useSettings.getState().settings).toEqual(next);
    expect(useSettings.getState().saving).toBe(false);
    expect(useSettings.getState().error).toBeNull();
  });

  it("失败时回滚到之前的值", async () => {
    const initial = makeSettings(14);
    const next = makeSettings(20);
    useSettings.setState({ settings: initial });

    invokeMock.mockRejectedValueOnce(new Error("磁盘满"));

    await expect(useSettings.getState().save(next)).rejects.toThrow("磁盘满");

    // settings 回滚到初始值
    expect(useSettings.getState().settings).toEqual(initial);
    expect(useSettings.getState().saving).toBe(false);
    // String(new Error("磁盘满")) === "Error: 磁盘满"
    expect(useSettings.getState().error).toBe("Error: 磁盘满");
  });

  it("快速连续修改不丢失增量（乐观更新解决竞态）", async () => {
    const s1 = makeSettings(14);
    const s2 = makeSettings(16);
    const s3 = makeSettings(18);
    useSettings.setState({ settings: s1 });

    // 模拟快速连续 save：第一次慢，第二次快
    let resolveFirst: () => void = () => {};
    const firstInvoke = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    invokeMock.mockReturnValueOnce(firstInvoke);
    invokeMock.mockResolvedValueOnce(undefined);

    const p1 = useSettings.getState().save(s2);
    // s2 已乐观更新到 state
    expect(useSettings.getState().settings).toEqual(s2);

    const p2 = useSettings.getState().save(s3);
    // s3 已乐观更新到 state（覆盖了 s2）
    expect(useSettings.getState().settings).toEqual(s3);

    // 第一次 invoke resolve（慢）
    resolveFirst();
    await Promise.all([p1, p2]);

    // 最终 state 是 s3，不丢失
    expect(useSettings.getState().settings).toEqual(s3);
    expect(useSettings.getState().saving).toBe(false);
  });
});
