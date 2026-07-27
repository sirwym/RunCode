import { describe, it, expect } from "vitest";
import { XTERM_DARK_THEME, XTERM_LIGHT_THEME } from "./Terminal";

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
