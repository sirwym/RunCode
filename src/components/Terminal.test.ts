import { describe, it, expect } from "vitest";
import { XTERM_DARK_THEME, XTERM_LIGHT_THEME, buildCustomXtermTheme } from "./Terminal";
import type { CustomThemeColors } from "../types";

// 验证 xterm 主题与品牌令牌一致
// xterm 属于运行时适配层（需直接提供颜色字符串），无法消费 CSS 变量；
// 颜色值必须与 global.css / ADR-0006 中的品牌令牌保持一致
// 详见 ADR-0006 与 docs/brand-guidelines.md
describe("RunCode xterm 主题颜色一致性", () => {
  // 品牌令牌权威值（与 global.css / ADR-0006 一致）
  // Dark Primary: #3B65B8（适配色）
  // Light Primary: #365EAA（标志原色）
  // Dark Hover: #4A74C6
  // Light Hover: #2F5498
  // Dark Focus Ring: #6F91D5
  // Light Focus Ring: #365EAA
  const BRAND = {
    DARK_PRIMARY: "#3b65b8",
    DARK_HOVER: "#4a74c6",
    DARK_FOCUS: "#6f91d5",
    LIGHT_PRIMARY: "#365eaa",
    LIGHT_HOVER: "#2f5498",
  };

  describe("XTERM_DARK_THEME", () => {
    it("光标使用 Dark Focus Ring (#6F91D5)", () => {
      expect(XTERM_DARK_THEME.cursor).toBe(BRAND.DARK_FOCUS);
    });

    it("ANSI blue 使用 Dark Primary 适配色 (#3B65B8)", () => {
      expect(XTERM_DARK_THEME.blue).toBe(BRAND.DARK_PRIMARY);
    });

    it("ANSI brightBlue 使用 Dark Hover (#4A74C6)", () => {
      expect(XTERM_DARK_THEME.brightBlue).toBe(BRAND.DARK_HOVER);
    });

    it("选区背景为半透明品牌蓝 rgba(74, 116, 198, 0.30)", () => {
      expect(XTERM_DARK_THEME.selectionBackground).toBe("rgba(74, 116, 198, 0.30)");
    });

    it("光标颜色为 6 位 HEX（无 alpha）", () => {
      expect(XTERM_DARK_THEME.cursor).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  describe("XTERM_LIGHT_THEME", () => {
    it("光标使用 Light Primary / Focus Ring (#365EAA)", () => {
      expect(XTERM_LIGHT_THEME.cursor).toBe(BRAND.LIGHT_PRIMARY);
    });

    it("ANSI blue 使用 Light Primary (#365EAA)", () => {
      expect(XTERM_LIGHT_THEME.blue).toBe(BRAND.LIGHT_PRIMARY);
    });

    it("ANSI brightBlue 使用 Light Hover (#2F5498)", () => {
      expect(XTERM_LIGHT_THEME.brightBlue).toBe(BRAND.LIGHT_HOVER);
    });

    it("选区背景为半透明品牌蓝 rgba(54, 94, 170, 0.25)", () => {
      expect(XTERM_LIGHT_THEME.selectionBackground).toBe("rgba(54, 94, 170, 0.25)");
    });

    it("光标颜色为 6 位 HEX（无 alpha）", () => {
      expect(XTERM_LIGHT_THEME.cursor).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  describe("两主题一致性约束", () => {
    it("Dark 与 Light 的 cursorAccent 与各自背景一致", () => {
      expect(XTERM_DARK_THEME.cursorAccent).toBe(XTERM_DARK_THEME.background);
      expect(XTERM_LIGHT_THEME.cursorAccent).toBe(XTERM_LIGHT_THEME.background);
    });

    it("Dark blue (#3B65B8) 与 Light blue (#365EAA) 不同（适配色差异）", () => {
      expect(XTERM_DARK_THEME.blue).not.toBe(XTERM_LIGHT_THEME.blue);
    });

    it("Dark brightBlue (#4A74C6) 与 Light brightBlue (#2F5498) 不同", () => {
      expect(XTERM_DARK_THEME.brightBlue).not.toBe(XTERM_LIGHT_THEME.brightBlue);
    });
  });
});

// buildCustomXtermTheme 的 panelAlpha 参数控制终端背景透明度
// alpha 0.50~0.95，rgba 格式（xterm 接受 rgba，与 Monaco 不同）
// 见图片主题背景化实施方案 阶段5
describe("buildCustomXtermTheme panelAlpha 透明度", () => {
  const sampleColors: CustomThemeColors = {
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
  };

  it("panelAlpha=0.82 时 background 为 rgba(...,0.82)", () => {
    const theme = buildCustomXtermTheme(sampleColors, 0.82);
    expect(theme.background).toBe("rgba(30, 30, 46, 0.82)");
    expect(theme.background).toMatch(/^rgba\(\d+,\s*\d+,\s*\d+,\s*0\.82\)$/);
  });

  it("panelAlpha=0.50 时 background 为 rgba(...,0.5)（最低透明度）", () => {
    const theme = buildCustomXtermTheme(sampleColors, 0.50);
    expect(theme.background).toBe("rgba(30, 30, 46, 0.5)");
  });

  it("panelAlpha=0.95 时 background 为 rgba(...,0.95)（最高透明度）", () => {
    const theme = buildCustomXtermTheme(sampleColors, 0.95);
    expect(theme.background).toBe("rgba(30, 30, 46, 0.95)");
  });

  it("panelAlpha 默认值 0.82（未传参时）", () => {
    const theme = buildCustomXtermTheme(sampleColors);
    expect(theme.background).toBe("rgba(30, 30, 46, 0.82)");
  });

  it("panelAlpha 变化时 background 的 RGB 部分不变，仅 alpha 变化", () => {
    const low = buildCustomXtermTheme(sampleColors, 0.50);
    const high = buildCustomXtermTheme(sampleColors, 0.95);
    // RGB 部分一致
    expect(low.background!.replace(/,\s*[\d.]+\)$/, ")"))
      .toBe(high.background!.replace(/,\s*[\d.]+\)$/, ")"));
    // alpha 不同
    expect(low.background).not.toBe(high.background);
  });

  it("background 始终为 rgba 格式（非 HEX）", () => {
    const theme = buildCustomXtermTheme(sampleColors, 0.82);
    expect(theme.background).toMatch(/^rgba\(/);
    expect(theme.background).not.toMatch(/^#/);
  });

  it("custom 主题覆盖 cursor/blue/brightBlue 为提取色", () => {
    const theme = buildCustomXtermTheme(sampleColors, 0.82);
    expect(theme.cursor).toBe(sampleColors.primary);
    expect(theme.blue).toBe(sampleColors.primary);
    expect(theme.brightBlue).toBe(sampleColors.primary_hover);
    expect(theme.foreground).toBe(sampleColors.text);
  });
});

// buildCustomXtermTheme 的 baseMode 参数决定 ANSI 预设
// 禁止用 bg_terminal === "#ffffff" 推断（浅色图可能提取出 #f3f7f8 等非纯白）
describe("buildCustomXtermTheme baseMode ANSI 预设", () => {
  const darkColors: CustomThemeColors = {
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
  };

  const lightColors: CustomThemeColors = {
    ...darkColors,
    bg: "#f3f7f8",
    bg_terminal: "#f3f7f8",
    text: "#0a0a0a",
    text_muted: "#737373",
  };

  it("baseMode=dark → ANSI 沿用 XTERM_DARK_THEME", () => {
    const theme = buildCustomXtermTheme(darkColors, 0.82, "dark");
    // ANSI red/green/yellow 等沿用深色预设
    expect(theme.red).toBe(XTERM_DARK_THEME.red);
    expect(theme.green).toBe(XTERM_DARK_THEME.green);
    expect(theme.yellow).toBe(XTERM_DARK_THEME.yellow);
  });

  it("baseMode=light → ANSI 沿用 XTERM_LIGHT_THEME", () => {
    const theme = buildCustomXtermTheme(lightColors, 0.82, "light");
    expect(theme.red).toBe(XTERM_LIGHT_THEME.red);
    expect(theme.green).toBe(XTERM_LIGHT_THEME.green);
    expect(theme.yellow).toBe(XTERM_LIGHT_THEME.yellow);
  });

  it("baseMode=light 且 bg_terminal=#f3f7f8（非纯白）时仍为浅色 ANSI", () => {
    // 这是禁止用 bg_terminal === "#ffffff" 推断的核心测试用例
    const theme = buildCustomXtermTheme(lightColors, 0.82, "light");
    expect(theme.red).toBe(XTERM_LIGHT_THEME.red);
    expect(theme.green).toBe(XTERM_LIGHT_THEME.green);
  });

  it("baseMode 默认值 dark（未传参时）", () => {
    const theme = buildCustomXtermTheme(darkColors, 0.82);
    expect(theme.red).toBe(XTERM_DARK_THEME.red);
  });

  it("baseMode 变化时 background 的 RGB 不变（仅 ANSI 预设不同）", () => {
    const dark = buildCustomXtermTheme(darkColors, 0.82, "dark");
    const light = buildCustomXtermTheme(darkColors, 0.82, "light");
    // background 都是 rgba(R, G, B, alpha)，RGB 来自 bg_terminal
    expect(dark.background).toBe(light.background);
    // 但 ANSI red 不同
    expect(dark.red).not.toBe(light.red);
  });
});
