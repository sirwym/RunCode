import { describe, it, expect } from "vitest";
import { mapMonacoTheme, RUNCODE_DARK_COLORS, RUNCODE_LIGHT_COLORS } from "./Editor";

// 验证持久化 settings.editor.theme → 渲染层 Monaco 主题映射
// 持久化值仍保存 vs-dark / vs / hc-black，渲染层映射到 runcode-* 继承主题
// 详见 ADR-0006
describe("mapMonacoTheme 主题映射", () => {
  it("vs-dark 持久化值映射到 runcode-dark", () => {
    expect(mapMonacoTheme("vs-dark", "dark")).toBe("runcode-dark");
    expect(mapMonacoTheme("vs-dark", "light")).toBe("runcode-dark");
  });

  it("vs 持久化值映射到 runcode-light", () => {
    expect(mapMonacoTheme("vs", "dark")).toBe("runcode-light");
    expect(mapMonacoTheme("vs", "light")).toBe("runcode-light");
  });

  it("hc-black 持久化值保留原样（高对比度主题不品牌化）", () => {
    expect(mapMonacoTheme("hc-black", "dark")).toBe("hc-black");
    expect(mapMonacoTheme("hc-black", "light")).toBe("hc-black");
  });

  it("未显式指定时按软件主题 fallback", () => {
    expect(mapMonacoTheme(undefined, "dark")).toBe("runcode-dark");
    expect(mapMonacoTheme(undefined, "light")).toBe("runcode-light");
  });

  it("未知值按 fallback 推断（默认深色）", () => {
    expect(mapMonacoTheme("unknown-theme", "dark")).toBe("runcode-dark");
    expect(mapMonacoTheme("unknown-theme", "light")).toBe("runcode-light");
    expect(mapMonacoTheme("unknown-theme", undefined)).toBe("runcode-dark");
  });

  it("持久化值优先于 fallback", () => {
    // 即使 fallback 是 light，持久化 vs-dark 仍映射到 runcode-dark
    expect(mapMonacoTheme("vs-dark", "light")).toBe("runcode-dark");
    // 即使 fallback 是 dark，持久化 vs 仍映射到 runcode-light
    expect(mapMonacoTheme("vs", "dark")).toBe("runcode-light");
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

