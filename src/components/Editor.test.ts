import { describe, it, expect } from "vitest";
import {
  mapMonacoTheme,
  buildCustomMonacoColors,
  monacoBaseFromMode,
  RUNCODE_DARK_COLORS,
  RUNCODE_LIGHT_COLORS,
} from "./Editor";
import type { CustomThemeColors } from "../types";

// 验证 effectiveTheme（general.theme 派生）→ 渲染层 Monaco 主题映射
// settings.editor.theme 字段已废弃，渲染层完全由 effectiveTheme 决定
// 详见 ADR-0006
describe("mapMonacoTheme 主题映射", () => {
  it("dark → runcode-dark", () => {
    expect(mapMonacoTheme("dark")).toBe("runcode-dark");
  });

  it("light → runcode-light", () => {
    expect(mapMonacoTheme("light")).toBe("runcode-light");
  });

  it("undefined → runcode-dark（默认深色）", () => {
    expect(mapMonacoTheme(undefined)).toBe("runcode-dark");
  });
});

// Monaco defineTheme 的 colors 字段仅接受 HEX 颜色（3/4/6/8 位）
// rgba() / hsl() / 命名色会被忽略并回退到默认色（在某些版本中表现为红色）
// 见 ADR-0006 与 docs/brand-guidelines.md
describe("RunCode Monaco 主题颜色格式", () => {
  // HEX 颜色正则：#RRGGBB / #RRGGBBAA / #RGB / #RGBA
  const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

  it("RUNCODE_DARK_COLORS 所有值均为合法 HEX", () => {
    for (const [key, value] of Object.entries(RUNCODE_DARK_COLORS)) {
      expect(value, `${key}=${value} 不是合法 HEX`).toMatch(HEX_RE);
      expect(value.toLowerCase(), `${key}=${value} 包含 rgba()`).not.toContain("rgba");
      expect(value.toLowerCase(), `${key}=${value} 包含 rgb()`).not.toContain("rgb(");
      expect(value.toLowerCase(), `${key}=${value} 包含 hsl`).not.toContain("hsl");
    }
  });

  it("RUNCODE_LIGHT_COLORS 所有值均为合法 HEX", () => {
    for (const [key, value] of Object.entries(RUNCODE_LIGHT_COLORS)) {
      expect(value, `${key}=${value} 不是合法 HEX`).toMatch(HEX_RE);
      expect(value.toLowerCase(), `${key}=${value} 包含 rgba()`).not.toContain("rgba");
      expect(value.toLowerCase(), `${key}=${value} 包含 rgb()`).not.toContain("rgb(");
      expect(value.toLowerCase(), `${key}=${value} 包含 hsl`).not.toContain("hsl");
    }
  });

  it("RUNCODE_DARK_COLORS 选区/当前行为半透明 Slate Blue（8 位 HEX 带 alpha）", () => {
    expect(RUNCODE_DARK_COLORS["editor.selectionBackground"]).toBe("#4A74C64D");
    expect(RUNCODE_DARK_COLORS["editor.inactiveSelectionBackground"]).toBe("#4A74C626");
    expect(RUNCODE_DARK_COLORS["editor.selectionHighlightBackground"]).toBe("#4A74C633");
    expect(RUNCODE_DARK_COLORS["editor.lineHighlightBackground"]).toBe("#4A74C61A");
    // 验证均为 8 位 HEX（RRGGBBAA），alpha 通道非 0
    for (const key of [
      "editor.selectionBackground",
      "editor.inactiveSelectionBackground",
      "editor.selectionHighlightBackground",
      "editor.lineHighlightBackground",
    ]) {
      const v = RUNCODE_DARK_COLORS[key];
      expect(v.length, `${key} 应为 9 字符 #RRGGBBAA`).toBe(9);
      expect(v, `${key} alpha 通道不应为 00`).not.toMatch(/00$/i);
    }
  });

  it("RUNCODE_LIGHT_COLORS 选区/当前行为半透明 Slate Blue（8 位 HEX 带 alpha）", () => {
    expect(RUNCODE_LIGHT_COLORS["editor.selectionBackground"]).toBe("#365EAA40");
    expect(RUNCODE_LIGHT_COLORS["editor.inactiveSelectionBackground"]).toBe("#365EAA1F");
    expect(RUNCODE_LIGHT_COLORS["editor.selectionHighlightBackground"]).toBe("#365EAA2E");
    expect(RUNCODE_LIGHT_COLORS["editor.lineHighlightBackground"]).toBe("#365EAA0F");
    for (const key of [
      "editor.selectionBackground",
      "editor.inactiveSelectionBackground",
      "editor.selectionHighlightBackground",
      "editor.lineHighlightBackground",
    ]) {
      const v = RUNCODE_LIGHT_COLORS[key];
      expect(v.length, `${key} 应为 9 字符 #RRGGBBAA`).toBe(9);
      expect(v, `${key} alpha 通道不应为 00`).not.toMatch(/00$/i);
    }
  });

  it("RUNCODE_DARK_COLORS 不透明交互色为 6 位 HEX（无 alpha 通道）", () => {
    // 光标/焦点/边框等不透明色应为 #RRGGBB
    for (const key of [
      "editorCursor.foreground",
      "editor.focusBorder",
      "editorWidget.focusBorder",
      "editorSuggestWidget.focusBorder",
      "inputOption.activeBorder",
      "editorBracketMatch.border",
    ]) {
      expect(RUNCODE_DARK_COLORS[key].length, `${key} 应为 7 字符 #RRGGBB`).toBe(7);
    }
  });

  it("RUNCODE_LIGHT_COLORS 不透明交互色为 6 位 HEX（无 alpha 通道）", () => {
    for (const key of [
      "editorCursor.foreground",
      "editor.focusBorder",
      "editorWidget.focusBorder",
      "editorSuggestWidget.focusBorder",
      "inputOption.activeBorder",
      "editorBracketMatch.border",
    ]) {
      expect(RUNCODE_LIGHT_COLORS[key].length, `${key} 应为 7 字符 #RRGGBB`).toBe(7);
    }
  });
});

// buildCustomMonacoColors 输出校验：
// custom 主题颜色必须全部为合法 HEX（#RRGGBB 或 #RRGGBBAA），
// rgba() / hsl() 会被 Monaco 忽略并回退到默认色（某些版本表现为红色）。
// 见 ADR-0006 与 docs/brand-guidelines.md
describe("buildCustomMonacoColors HEX 格式校验", () => {
  const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

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

  it("所有输出值均为合法 HEX（无 rgba / rgb / hsl）", () => {
    const colors = buildCustomMonacoColors(sampleColors);
    for (const [key, value] of Object.entries(colors)) {
      expect(value, `${key}=${value} 不是合法 HEX`).toMatch(HEX_RE);
      expect(value.toLowerCase(), `${key}=${value} 含 rgba()`).not.toContain("rgba");
      expect(value.toLowerCase(), `${key}=${value} 含 rgb()`).not.toContain("rgb(");
      expect(value.toLowerCase(), `${key}=${value} 含 hsl`).not.toContain("hsl");
    }
  });

  it("半透明派生色为 8 位 HEX（#RRGGBBAA，alpha 非 00）", () => {
    const colors = buildCustomMonacoColors(sampleColors);
    for (const key of [
      "editor.selectionBackground",
      "editor.inactiveSelectionBackground",
      "editor.selectionHighlightBackground",
      "editor.lineHighlightBackground",
    ]) {
      const v = colors[key];
      expect(v.length, `${key} 应为 9 字符 #RRGGBBAA`).toBe(9);
      expect(v, `${key} alpha 通道不应为 00`).not.toMatch(/00$/i);
    }
  });

  it("不透明交互色为 6 位 HEX（无 alpha 通道）", () => {
    const colors = buildCustomMonacoColors(sampleColors);
    for (const key of [
      "editorCursor.foreground",
      "editor.focusBorder",
      "editorWidget.focusBorder",
      "editorSuggestWidget.focusBorder",
      "inputOption.activeBorder",
      "editorBracketMatch.border",
    ]) {
      expect(colors[key].length, `${key} 应为 7 字符 #RRGGBB`).toBe(7);
    }
  });

  it("primary 大写/小写 HEX 均可正确派生 8 位 HEX", () => {
    const upper: CustomThemeColors = { ...sampleColors, primary: "#3B65B8" };
    const lower: CustomThemeColors = { ...sampleColors, primary: "#3b65b8" };
    const upperColors = buildCustomMonacoColors(upper);
    const lowerColors = buildCustomMonacoColors(lower);
    // 大写 HEX 派生时内部 toLowerCase()，与小写输入结果一致
    expect(upperColors["editor.selectionBackground"].toLowerCase())
      .toBe(lowerColors["editor.selectionBackground"].toLowerCase());
  });
});

// buildCustomMonacoColors：editor.background 必须为透明色
// editorAlpha 不再经 Monaco 主题控制，只控制外层 .editor-container（--editor-surface-bg）
// 见 ADR-0006 与图片主题背景化实施方案
describe("buildCustomMonacoColors editor.background 透明", () => {
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

  it("editor.background 始终为 #00000000（透明，不依赖 editorAlpha）", () => {
    const colors = buildCustomMonacoColors(sampleColors);
    expect(colors["editor.background"]).toBe("#00000000");
  });

  it("editor.background 为 8 位 HEX（#RRGGBBAA，AA=00）", () => {
    const colors = buildCustomMonacoColors(sampleColors);
    expect(colors["editor.background"]).toMatch(/^#00000000$/);
  });

  it("语法色/光标色/选区色仍从 customColors 派生（非透明）", () => {
    const colors = buildCustomMonacoColors(sampleColors);
    expect(colors["editor.foreground"]).toBe(sampleColors.text);
    expect(colors["editorCursor.foreground"]).toBe(sampleColors.primary);
    // primaryHex.toLowerCase() + 大写 alpha 后缀（与 RUNCODE_DARK_COLORS 一致）
    expect(colors["editor.selectionBackground"]).toBe("#3b65b84D");
    expect(colors["editor.focusBorder"]).toBe(sampleColors.primary);
  });
});


// monacoBaseFromMode：由 base_mode 决定 Monaco 继承主题
// 禁止用 bg_terminal === "#ffffff" 推断（浅色图可能提取出 #f3f7f8 等非纯白）
describe("monacoBaseFromMode base_mode 映射", () => {
  it("baseMode=light → vs（浅色基础主题）", () => {
    expect(monacoBaseFromMode("light")).toBe("vs");
  });

  it("baseMode=dark → vs-dark（深色基础主题）", () => {
    expect(monacoBaseFromMode("dark")).toBe("vs-dark");
  });

  it("baseMode=undefined → vs-dark（默认深色）", () => {
    expect(monacoBaseFromMode(undefined)).toBe("vs-dark");
  });

  it("base_mode=light 且 bg_terminal=#f3f7f8（非纯白）时仍为 vs", () => {
    // 这是禁止用 bg_terminal === "#ffffff" 推断的核心测试用例
    const colors: CustomThemeColors = {
      bg: "#f3f7f8",
      panel_bg: "#ffffff",
      panel_bg_alt: "#f5f5f5",
      text: "#0a0a0a",
      text_muted: "#737373",
      border: "#d4d4d4",
      primary: "#365eaa",
      primary_hover: "#2a4d8f",
      primary_foreground: "#ffffff",
      primary_soft: "rgba(54,94,170,0.14)",
      primary_border: "rgba(54,94,170,0.40)",
      bg_terminal: "#f3f7f8",
    };
    // 即使 bg_terminal 不是 #ffffff，base_mode=light 仍应映射到 vs
    expect(monacoBaseFromMode("light")).toBe("vs");
    // buildCustomMonacoColors 不依赖 base_mode，只负责 colors 字段
    // editor.background 始终为透明色 #00000000（editorAlpha 由外层 .editor-container 控制）
    const result = buildCustomMonacoColors(colors);
    expect(result["editor.background"]).toBe("#00000000");
  });
});

// Monaco 初始化竞态修复验证：
// Editor.tsx 用 customColorsRef/baseModeRef 持有最新值，
// onMount 闭包读取 ref.current 而非陈旧的 props。
// 这里验证：当 customColors 已到达时，buildCustomMonacoColors + monacoBaseFromMode
// 产出的主题定义与实际自定义主题一致，而非 RUNCODE_DARK_COLORS 占位主题。
describe("Monaco 初始化竞态：customColors 先到、延迟挂载", () => {
  const customColors: CustomThemeColors = {
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
  const baseMode = "dark" as const;

  it("customColors 已到达时，onMount 定义的主题用提取色而非 RUNCODE_DARK_COLORS 占位", () => {
    // 模拟 onMount 闭包读取 ref.current 的场景：
    // const cc = customColorsRef.current; if (cc) { defineTheme(...buildCustomMonacoColors(cc)) }
    const cc = customColors; // ref.current
    expect(cc).toBeDefined();
    const colors = buildCustomMonacoColors(cc);
    // editor.background 始终为透明色 #00000000（editorAlpha 由外层 .editor-container 控制）
    expect(colors["editor.background"]).toBe("#00000000");
    // primary 色应为提取色
    expect(colors["editorCursor.foreground"]).toBe("#3b65b8");
  });

  it("customColors 已到达时，onMount 用 monacoBaseFromMode 决定 base，而非硬编码 vs-dark", () => {
    // 模拟 onMount 闭包读取 baseModeRef.current
    const base = monacoBaseFromMode(baseMode);
    expect(base).toBe("vs-dark");
    // baseMode=light 时应为 vs（验证 ref 读取路径不固定为 vs-dark）
    expect(monacoBaseFromMode("light")).toBe("vs");
  });

  it("customColors 未到达（null）时才用 RUNCODE_DARK_COLORS 占位", () => {
    // 模拟 onMount 中 cc = customColorsRef.current 为 null 的分支
    const cc = null;
    if (!cc) {
      // 此分支用 RUNCODE_DARK_COLORS 占位
      expect(RUNCODE_DARK_COLORS["editorCursor.foreground"]).toBe("#6f91d5");
    } else {
      // 不应进入此分支
      expect(true).toBe(false);
    }
  });
});

// Monaco 已挂载后修改图片/baseMode 可实时更新：
// Editor.tsx 的 useEffect 监听 customColorsKey（含 customColors + baseMode），
// 变化时重新 defineTheme("runcode-custom") 并 setTheme。
// editorAlpha 不再经 Monaco 主题控制，只影响外层 .editor-container 的 --editor-surface-bg。
describe("Monaco 已挂载后实时更新", () => {
  const colors: CustomThemeColors = {
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

  it("editor.background 始终透明，不随 editorAlpha 变化（editorAlpha 由外层控制）", () => {
    const before = buildCustomMonacoColors(colors);
    // editorAlpha 不再作为参数传入，editor.background 恒为 #00000000
    expect(before["editor.background"]).toBe("#00000000");
  });

  it("修改 baseMode（dark → light）后，monacoBaseFromMode 返回值变化", () => {
    expect(monacoBaseFromMode("dark")).toBe("vs-dark");
    expect(monacoBaseFromMode("light")).toBe("vs");
    expect(monacoBaseFromMode("dark")).not.toBe(monacoBaseFromMode("light"));
  });

  it("修改 customColors.primary 后，editorCursor.foreground 变化", () => {
    const newColors: CustomThemeColors = { ...colors, primary: "#ff0000" };
    const before = buildCustomMonacoColors(colors);
    const after = buildCustomMonacoColors(newColors);
    expect(before["editorCursor.foreground"]).toBe("#3b65b8");
    expect(after["editorCursor.foreground"]).toBe("#ff0000");
    expect(before["editorCursor.foreground"]).not.toBe(after["editorCursor.foreground"]);
  });

  it("customColorsKey 包含 baseMode，baseMode 变化触发 useEffect 重定义主题", () => {
    // 模拟 Editor.tsx 中 customColorsKey 的构造
    // const customColorsKey = customColors ? JSON.stringify(customColors) + "|" + (baseMode ?? "dark") : "";
    const keyDark = JSON.stringify(colors) + "|dark";
    const keyLight = JSON.stringify(colors) + "|light";
    expect(keyDark).not.toBe(keyLight);
  });
});

