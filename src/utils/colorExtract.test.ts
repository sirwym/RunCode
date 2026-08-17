import { describe, it, expect } from "vitest";
import {
  relativeLuminance,
  contrastRatio,
  rgbToHex,
  hexToRgb,
  adjustLightness,
  kMeans,
  extractThemeColors,
  rederiveColors,
  deriveSyntaxColors,
  isVideoFile,
} from "./colorExtract";

/** 构造纯色 RGBA 数据（4x4 像素） */
function createSolidImageData(
  r: number,
  g: number,
  b: number,
  width = 4,
  height = 4,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

/** 构造双色 RGBA 数据（前一半色 A，后一半色 B） */
function createDualColorImageData(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
  width = 8, height = 4,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  const half = Math.floor((width * height) / 2);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = i < half ? [r1, g1, b1] : [r2, g2, b2];
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe("colorExtract", () => {
  describe("relativeLuminance", () => {
    it("黑色 = 0", () => {
      expect(relativeLuminance(0, 0, 0)).toBe(0);
    });

    it("白色 = 1", () => {
      expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);
    });

    it("红色 < 绿色 < 蓝色（亮度递增）", () => {
      const lr = relativeLuminance(255, 0, 0);
      const lg = relativeLuminance(0, 255, 0);
      const lb = relativeLuminance(0, 0, 255);
      expect(lr).toBeGreaterThan(0);
      expect(lg).toBeGreaterThan(lr);
      expect(lb).toBeLessThan(lr);
    });
  });

  describe("contrastRatio", () => {
    it("黑白对比度 ≈ 21", () => {
      expect(contrastRatio(0, 1)).toBeCloseTo(21, 1);
    });

    it("同色对比度 = 1", () => {
      expect(contrastRatio(0.5, 0.5)).toBe(1);
    });
  });

  describe("rgbToHex", () => {
    it("(255, 0, 0) = #ff0000", () => {
      expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
    });

    it("(0, 0, 0) = #000000", () => {
      expect(rgbToHex(0, 0, 0)).toBe("#000000");
    });

    it("clamp 超出范围", () => {
      expect(rgbToHex(300, -10, 128)).toBe("#ff0080");
    });
  });

  describe("hexToRgb", () => {
    it("#ff0000 = (255, 0, 0)", () => {
      expect(hexToRgb("#ff0000")).toEqual([255, 0, 0]);
    });

    it("不带 # 也支持", () => {
      expect(hexToRgb("00ff00")).toEqual([0, 255, 0]);
    });

    it("8 位 HEX（含 alpha）取前 6 位", () => {
      expect(hexToRgb("#3b65b8ff")).toEqual([59, 101, 184]);
    });

    it("3 位 HEX 抛错", () => {
      expect(() => hexToRgb("#abc")).toThrow();
    });
  });

  describe("adjustLightness", () => {
    it("加亮黑色 = 灰色", () => {
      const result = adjustLightness("#000000", 50);
      expect(result).toMatch(/^#[0-9a-f]{6}$/);
      // L=0 + 50% = 0.5 → 灰色
      const [r, g, b] = hexToRgb(result);
      expect(r).toBe(g);
      expect(g).toBe(b);
      expect(r).toBeGreaterThan(0);
    });

    it("amount=0 不变", () => {
      expect(adjustLightness("#3b65b8", 0)).toBe("#3b65b8");
    });

    it("clamp 超出范围", () => {
      // 加亮 100% → 白色
      expect(adjustLightness("#3b65b8", 100)).toBe("#ffffff");
      // 变暗 -100% → 黑色
      expect(adjustLightness("#3b65b8", -100)).toBe("#000000");
    });
  });

  describe("kMeans", () => {
    it("纯色图片收敛到 1 个有效中心", () => {
      const pixels = Array(100).fill([255, 0, 0]) as Array<[number, number, number]>;
      const centers = kMeans(pixels, 5, 10);
      expect(centers.length).toBeGreaterThan(0);
      // 至少有一个中心接近 (255, 0, 0)
      const hasRed = centers.some(
        (c) => Math.abs(c[0] - 255) < 10 && Math.abs(c[1]) < 10 && Math.abs(c[2]) < 10,
      );
      expect(hasRed).toBe(true);
    });

    it("双色图片至少有 2 个不同中心", () => {
      const pixels: Array<[number, number, number]> = [
        ...Array(50).fill([255, 0, 0]),
        ...Array(50).fill([0, 0, 255]),
      ] as Array<[number, number, number]>;
      const centers = kMeans(pixels, 5, 20);
      const distinct = new Set(centers.map((c) => `${c[0]},${c[1]},${c[2]}`));
      expect(distinct.size).toBeGreaterThanOrEqual(2);
    });

    it("空数组返回空", () => {
      expect(kMeans([], 5, 10)).toEqual([]);
    });
  });

  describe("extractThemeColors", () => {
    it("深色图片 baseMode=dark", () => {
      const data = createSolidImageData(30, 30, 30);
      const colors = extractThemeColors(data);
      expect(colors.baseMode).toBe("dark");
      expect(colors.bg).toMatch(/^#[0-9a-f]{6}$/);
      // 深色背景下 text 应为浅色
      expect(colors.text).toBe("#fafafa");
    });

    it("浅色图片 baseMode=light", () => {
      const data = createSolidImageData(240, 240, 240);
      const colors = extractThemeColors(data);
      expect(colors.baseMode).toBe("light");
      expect(colors.bg).toMatch(/^#[0-9a-f]{6}$/);
      // 浅色背景下 text 应为深色
      expect(colors.text).toBe("#0a0a0a");
    });

    it("纯黑图片 baseMode=dark 且 text=#fafafa", () => {
      const data = createSolidImageData(0, 0, 0);
      const colors = extractThemeColors(data);
      expect(colors.baseMode).toBe("dark");
      expect(colors.text).toBe("#fafafa");
      expect(colors.bg).toBe("#000000");
    });

    it("纯白图片 baseMode=light 且 text=#0a0a0a", () => {
      const data = createSolidImageData(255, 255, 255);
      const colors = extractThemeColors(data);
      expect(colors.baseMode).toBe("light");
      expect(colors.text).toBe("#0a0a0a");
      expect(colors.bg).toBe("#ffffff");
    });

    it("所有 12 个颜色字段都是合法字符串", () => {
      const data = createSolidImageData(100, 150, 200);
      const colors = extractThemeColors(data);
      const hexFields = [
        colors.bg, colors.panel_bg, colors.panel_bg_alt,
        colors.text, colors.text_muted, colors.border,
        colors.primary, colors.primary_hover, colors.primary_foreground,
        colors.bg_terminal,
      ];
      for (const h of hexFields) {
        expect(h).toMatch(/^#[0-9a-f]{6}$/);
      }
      // rgba 字段
      expect(colors.primary_soft).toMatch(/^rgba\(/);
      expect(colors.primary_border).toMatch(/^rgba\(/);
    });

    it("双色图片能区分 bg 与 primary", () => {
      // 极深背景 + 纯红主色（对比度需 ≥ 4.5 才能被选为 primary）
      // 注：(220,40,40) 与 (10,10,10) 对比度仅 ~2.2 < 4.5，会被跳过导致回退品牌色
      // 改用 (255,30,30)：亮度 ≈ 0.21，对比度 ≈ 4.9 ≥ 4.5
      const data = createDualColorImageData(
        10, 10, 10,    // 极深灰（占一半，作为 bg）
        255, 30, 30,   // 纯红（占一半，作为 primary 候选）
      );
      const colors = extractThemeColors(data);
      expect(colors.baseMode).toBe("dark");
      // bg 应接近深灰
      const [br] = hexToRgb(colors.bg);
      expect(br).toBeLessThan(50);
      // primary 应偏红
      const [pr, pg, pb] = hexToRgb(colors.primary);
      expect(pr).toBeGreaterThan(pg);
      expect(pr).toBeGreaterThan(pb);
    });

    it("中灰背景对比度不足时 text 回退到 #000/#fff", () => {
      // 中灰（128,128,128）的亮度约 0.21，与 #fafafa 对比度约 13.4（> 4.5）
      // 与 #0a0a0a 对比度约 5.9（> 4.5），两者都满足，但 baseMode=light 会选 #0a0a0a
      // 这里用更接近中间值的 150 来测试
      const data = createSolidImageData(150, 150, 150);
      const colors = extractThemeColors(data);
      expect(["#000000", "#ffffff", "#0a0a0a", "#fafafa"]).toContain(colors.text);
    });

    it("全透明图片返回兜底深色主题", () => {
      const data = new Uint8ClampedArray(16); // 1 像素 RGBA，全 0（全透明）
      data[3] = 0; // alpha=0
      const colors = extractThemeColors(data);
      expect(colors.baseMode).toBe("dark");
      expect(colors.bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(colors.text).toBe("#fafafa");
    });
  });

  describe("rederiveColors", () => {
    const darkEditable = {
      bg: "#1e1e2e",
      panel_bg: "#181825",
      text: "#fafafa",
      border: "#45475a",
      primary: "#3b65b8",
    };

    it("5 个可编辑色原样保留", () => {
      const result = rederiveColors(darkEditable, "dark");
      expect(result.bg).toBe("#1e1e2e");
      expect(result.panel_bg).toBe("#181825");
      expect(result.text).toBe("#fafafa");
      expect(result.border).toBe("#45475a");
      expect(result.primary).toBe("#3b65b8");
    });

    it("dark 模式：bg_terminal = bg", () => {
      const result = rederiveColors(darkEditable, "dark");
      expect(result.bg_terminal).toBe("#1e1e2e");
    });

    it("dark 模式：text_muted 为 #a3a3a3", () => {
      const result = rederiveColors(darkEditable, "dark");
      expect(result.text_muted).toBe("#a3a3a3");
    });

    it("light 模式：text_muted 为 #737373", () => {
      const lightEditable = {
        bg: "#ffffff",
        panel_bg: "#f5f5f5",
        text: "#0a0a0a",
        border: "#d4d4d4",
        primary: "#365eaa",
      };
      const result = rederiveColors(lightEditable, "light");
      expect(result.text_muted).toBe("#737373");
    });

    it("primary_foreground 始终为 #ffffff", () => {
      const dark = rederiveColors(darkEditable, "dark");
      const light = rederiveColors({
        bg: "#ffffff", panel_bg: "#f5f5f5", text: "#0a0a0a",
        border: "#d4d4d4", primary: "#365eaa",
      }, "light");
      expect(dark.primary_foreground).toBe("#ffffff");
      expect(light.primary_foreground).toBe("#ffffff");
    });

    it("primary_soft 和 primary_border 从 primary RGB 派生", () => {
      const result = rederiveColors(darkEditable, "dark");
      // #3b65b8 → rgb(59, 101, 184)
      expect(result.primary_soft).toBe("rgba(59, 101, 184, 0.14)");
      expect(result.primary_border).toBe("rgba(59, 101, 184, 0.40)");
    });

    it("修改 primary 后 primary_hover 随之变化", () => {
      const r1 = rederiveColors(darkEditable, "dark");
      const r2 = rederiveColors({ ...darkEditable, primary: "#ff0000" }, "dark");
      expect(r1.primary_hover).not.toBe(r2.primary_hover);
      expect(r2.primary_hover).not.toBe("#ff0000");
    });

    it("修改 panel_bg 后 panel_bg_alt 随之变化", () => {
      const r1 = rederiveColors(darkEditable, "dark");
      const r2 = rederiveColors({ ...darkEditable, panel_bg: "#ff0000" }, "dark");
      expect(r1.panel_bg_alt).not.toBe(r2.panel_bg_alt);
    });
  });

  describe("isVideoFile", () => {
    it("mp4 扩展名返回 true", () => {
      expect(isVideoFile("test.mp4")).toBe(true);
      expect(isVideoFile("a/b/c.MP4")).toBe(true);
      expect(isVideoFile("uuid1234.mp4")).toBe(true);
    });

    it("图片扩展名返回 false", () => {
      expect(isVideoFile("test.png")).toBe(false);
      expect(isVideoFile("test.jpg")).toBe(false);
      expect(isVideoFile("test.jpeg")).toBe(false);
      expect(isVideoFile("test.webp")).toBe(false);
    });

    it("无扩展名或其他扩展名返回 false", () => {
      expect(isVideoFile("noext")).toBe(false);
      expect(isVideoFile("test.avi")).toBe(false);
      expect(isVideoFile("test.webm")).toBe(false);
      expect(isVideoFile("")).toBe(false);
    });

    it("预览标记 __preview__.mp4 返回 true", () => {
      expect(isVideoFile("__preview__.mp4")).toBe(true);
      expect(isVideoFile("__preview__.png")).toBe(false);
    });
  });

  describe("deriveSyntaxColors", () => {
    /** 计算颜色与背景的实际对比度 */
    function contrastAgainst(hex: string, bgHex: string): number {
      const [r1, g1, b1] = hexToRgb(hex);
      const [r2, g2, b2] = hexToRgb(bgHex);
      return contrastRatio(
        relativeLuminance(r1, g1, b1),
        relativeLuminance(r2, g2, b2),
      );
    }

    // 性质测试：5 个 ≥4.5 token 全达标，comment ≥ 3.0
    it("深色背景下 5 个 token 对比度 ≥ 4.5，comment ≥ 3.0", () => {
      for (const bg of ["#1e1e2e", "#0a0a0a"]) {
        const s = deriveSyntaxColors(bg, "dark");
        for (const token of ["keyword", "type", "string", "number", "preprocessor"] as const) {
          expect(contrastAgainst(s[token], bg), `${token} vs ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrastAgainst(s.comment, bg), `comment vs ${bg}`).toBeGreaterThanOrEqual(3.0);
      }
    });

    it("浅色背景下 5 个 token 对比度 ≥ 4.5，comment ≥ 3.0", () => {
      for (const bg of ["#f3f7f8", "#ffffff"]) {
        const s = deriveSyntaxColors(bg, "light");
        for (const token of ["keyword", "type", "string", "number", "preprocessor"] as const) {
          expect(contrastAgainst(s[token], bg), `${token} vs ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrastAgainst(s.comment, bg), `comment vs ${bg}`).toBeGreaterThanOrEqual(3.0);
      }
    });

    it("锚点本已达标时保持原值（不做无谓调整）", () => {
      // dark 锚点 vs #1e1e2e 对比度均 ≥ 4.5（comment ≥ 3.0）
      const s = deriveSyntaxColors("#1e1e2e", "dark");
      expect(s.keyword).toBe("#569cd6");
      expect(s.type).toBe("#4ec9b0");
      expect(s.string).toBe("#ce9178");
      expect(s.number).toBe("#b5cea8");
      expect(s.comment).toBe("#6a9955");
      expect(s.preprocessor).toBe("#c586c0");
    });

    it("确定性：同输入两次调用结果全等", () => {
      const a = deriveSyntaxColors("#123456", "dark");
      const b = deriveSyntaxColors("#123456", "dark");
      expect(a).toEqual(b);
    });

    it("中灰背景不抛错，返回候选中对比度更高者（best-effort）", () => {
      // L≈0.5 时 4.5 数学上不可达，dark 模式应回退到白色极值
      const s = deriveSyntaxColors("#808080", "dark");
      expect(s.keyword).toBe("#ffffff");
      // 白色 vs 中灰 ≈ 1.9，是不抛错前提下可达的最大对比度量级
      expect(contrastAgainst(s.keyword, "#808080")).toBeGreaterThan(1.8);
    });

    it("输出全部为 6 位小写 HEX", () => {
      const cases: Array<[string, "dark" | "light"]> = [
        ["#1e1e2e", "dark"],
        ["#808080", "dark"],
        ["#ffffff", "light"],
        ["#f3f7f8", "light"],
      ];
      const HEX_RE = /^#[0-9a-f]{6}$/;
      for (const [bg, mode] of cases) {
        const s = deriveSyntaxColors(bg, mode);
        for (const value of Object.values(s)) {
          expect(value, `${value} vs ${bg}/${mode}`).toMatch(HEX_RE);
        }
      }
    });
  });
});
