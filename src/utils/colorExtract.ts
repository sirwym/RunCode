// 图片主题色提取工具
//
// 算法：采样 → K-means 聚类 → 选主背景 + 派生色组 → 对比度保障
// 不引入新依赖，全部用 Canvas 2D + 纯函数实现
//
// 与后端 settings.rs CustomThemeColors 对应（12 个 HEX 字符串 + baseMode）

import type { CustomThemeColors } from "../types";

export interface ExtractedColors {
  bg: string;
  panel_bg: string;
  panel_bg_alt: string;
  text: string;
  text_muted: string;
  border: string;
  primary: string;
  primary_hover: string;
  primary_foreground: string;
  primary_soft: string;
  primary_border: string;
  bg_terminal: string;
  baseMode: "dark" | "light";
}

// ============ 纯函数（便于单测） ============

/**
 * 相对亮度（WCAG 2.1）
 * 输入 0-255 的 RGB，输出 0-1 的亮度值
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * 对比度比（1~21），输入两个亮度值
 */
export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** RGB → HEX（6 位，小写） */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number): string => {
    const v = Math.max(0, Math.min(255, Math.round(n)));
    return v.toString(16).padStart(2, "0");
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** HEX → RGB，仅接受 6 位或 8 位 HEX（#rrggbb / #rrggbbaa） */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  if (h.length !== 6 && h.length !== 8) {
    throw new Error(`hexToRgb 仅接受 6/8 位 HEX，收到: ${hex}`);
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

/** RGB → HSL */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rN:
        h = ((gN - bN) / d + (gN < bN ? 6 : 0)) / 6;
        break;
      case gN:
        h = ((bN - rN) / d + 2) / 6;
        break;
      default:
        h = ((rN - gN) / d + 4) / 6;
    }
  }
  return [h * 360, s, l];
}

/** HSL → RGB */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hueToRgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const hN = h / 360;
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, hN + 1 / 3);
    g = hueToRgb(p, q, hN);
    b = hueToRgb(p, q, hN - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * 调整 HEX 颜色的亮度（HSL L 分量）
 * @param hex 输入 HEX（6 位）
 * @param amount 亮度增量（-100~100，负数变暗，正数变亮）
 */
export function adjustLightness(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const newL = Math.max(0, Math.min(1, l + amount / 100));
  const [nr, ng, nb] = hslToRgb(h, s, newL);
  return rgbToHex(nr, ng, nb);
}

/**
 * 从 5 个可编辑色 + baseMode 派生出完整 12 色。
 * 用户改任一可编辑色后调用此函数重算派生色，保证一致性。
 */
export function rederiveColors(
  editable: { bg: string; panel_bg: string; text: string; border: string; primary: string },
  baseMode: "dark" | "light",
): CustomThemeColors {
  const panelBgAlt = adjustLightness(editable.panel_bg, baseMode === "dark" ? 4 : -3);
  const primaryHover = adjustLightness(editable.primary, baseMode === "dark" ? 8 : -8);
  const [pr, pg, pb] = hexToRgb(editable.primary);
  return {
    bg: editable.bg,
    panel_bg: editable.panel_bg,
    panel_bg_alt: panelBgAlt,
    text: editable.text,
    text_muted: baseMode === "dark" ? "#a3a3a3" : "#737373",
    border: editable.border,
    primary: editable.primary,
    primary_hover: primaryHover,
    primary_foreground: "#ffffff",
    primary_soft: `rgba(${pr}, ${pg}, ${pb}, 0.14)`,
    primary_border: `rgba(${pr}, ${pg}, ${pb}, 0.40)`,
    bg_terminal: editable.bg,
  };
}

// ============ 语法高亮色派生 ============

/** 语法高亮色组（6 个 token，与 buildCustomMonacoRules / SyntaxColorPicker 对应） */
export interface SyntaxColors {
  keyword: string;
  type: string;
  string: string;
  number: string;
  comment: string;
  preprocessor: string;
}

// VS dark+ / light+ 标准语法配色锚点（观感熟悉）
// comment 门槛放宽到 3.0（WCAG AA 大字级），保留注释"次级"视觉层级
const SYNTAX_ANCHORS: Record<"dark" | "light", SyntaxColors> = {
  dark: {
    keyword: "#569cd6",
    type: "#4ec9b0",
    string: "#ce9178",
    number: "#b5cea8",
    comment: "#6a9955",
    preprocessor: "#c586c0",
  },
  light: {
    keyword: "#0000ff",
    type: "#267f99",
    string: "#a31515",
    number: "#098658",
    comment: "#008000",
    preprocessor: "#af00db",
  },
};

/**
 * 单个 token 的对比度保障：
 * 循环调亮度（保色相）直到达标；中灰背景等数学上不可达的情况，
 * 在调整结果与极值色（dark→白 / light→黑）中选对比度更高者 best-effort 返回
 */
function ensureSyntaxContrast(
  hex: string,
  bgLum: number,
  baseMode: "dark" | "light",
  target: number,
): string {
  let current = hex;
  for (let i = 0; i < 10; i++) {
    const [r, g, b] = hexToRgb(current);
    if (contrastRatio(bgLum, relativeLuminance(r, g, b)) >= target) {
      return current;
    }
    current = adjustLightness(current, baseMode === "dark" ? 6 : -6);
  }
  const extreme = baseMode === "dark" ? "#ffffff" : "#000000";
  const [cr, cg, cb] = hexToRgb(current);
  const [er, eg, eb] = hexToRgb(extreme);
  return contrastRatio(bgLum, relativeLuminance(er, eg, eb)) >
    contrastRatio(bgLum, relativeLuminance(cr, cg, cb))
    ? extreme
    : current;
}

/**
 * 由编辑器底色（bg_terminal）+ baseMode 自动派生 6 个语法高亮色。
 * 纯函数、确定性，每次 defineTheme 现算，不持久化：
 * 换背景图后未覆盖的 token 自动适配新背景。
 */
export function deriveSyntaxColors(
  bgTerminal: string,
  baseMode: "dark" | "light",
): SyntaxColors {
  const [br, bg, bb] = hexToRgb(bgTerminal);
  const bgLum = relativeLuminance(br, bg, bb);
  const anchors = SYNTAX_ANCHORS[baseMode];
  const derive = (hex: string, target: number) =>
    ensureSyntaxContrast(hex, bgLum, baseMode, target);
  return {
    keyword: derive(anchors.keyword, 4.5),
    type: derive(anchors.type, 4.5),
    string: derive(anchors.string, 4.5),
    number: derive(anchors.number, 4.5),
    comment: derive(anchors.comment, 3.0),
    preprocessor: derive(anchors.preprocessor, 4.5),
  };
}

// ============ K-means 聚类 ============

type Pixel = [number, number, number];

/**
 * K-means 聚类
 * @param pixels 像素数组
 * @param k 聚类数
 * @param iterations 迭代次数
 * @returns 聚类中心数组（长度 ≤ k）
 */
export function kMeans(
  pixels: Pixel[],
  k: number,
  iterations: number,
): Pixel[] {
  if (pixels.length === 0) return [];
  // 初始化：均匀采样作为初始中心
  const centers: Pixel[] = [];
  const step = Math.max(1, Math.floor(pixels.length / k));
  for (let i = 0; i < k && i * step < pixels.length; i++) {
    centers.push([...pixels[i * step]] as Pixel);
  }

  for (let iter = 0; iter < iterations; iter++) {
    // 分配每个像素到最近的中心
    const clusters: Pixel[][] = Array.from({ length: centers.length }, () => []);
    for (const px of pixels) {
      let minDist = Infinity;
      let minIdx = 0;
      for (let i = 0; i < centers.length; i++) {
        const [cr, cg, cb] = centers[i];
        const dr = px[0] - cr;
        const dg = px[1] - cg;
        const db = px[2] - cb;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < minDist) {
          minDist = dist;
          minIdx = i;
        }
      }
      clusters[minIdx].push(px);
    }
    // 更新中心
    let changed = false;
    for (let i = 0; i < centers.length; i++) {
      if (clusters[i].length === 0) continue;
      const sum = clusters[i].reduce(
        (acc, px) => [acc[0] + px[0], acc[1] + px[1], acc[2] + px[2]],
        [0, 0, 0],
      );
      const n = clusters[i].length;
      const newCenter: Pixel = [
        Math.round(sum[0] / n),
        Math.round(sum[1] / n),
        Math.round(sum[2] / n),
      ];
      if (
        newCenter[0] !== centers[i][0] ||
        newCenter[1] !== centers[i][1] ||
        newCenter[2] !== centers[i][2]
      ) {
        centers[i] = newCenter;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return centers;
}

// ============ 主入口 ============

/**
 * 从 ImageData 的 data 字段提取主题色组
 * @param data Canvas getImageData().data（RGBA 字节流）
 */
export function extractThemeColors(data: Uint8ClampedArray): ExtractedColors {
  // 1. 采样：步长 4（每 4 像素取 1），跳过半透明像素
  const pixels: Pixel[] = [];
  for (let i = 0; i + 3 < data.length; i += 16) {
    // RGBA 共 4 字节，步长 16 = 4 像素 × 4 字节
    const a = data[i + 3];
    if (a < 125) continue;
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (pixels.length === 0) {
    // 兜底：全透明图片，返回深色默认值
    return fallbackColors("dark");
  }

  // 2. K-means 聚类
  const centers = kMeans(pixels, 5, 10);
  if (centers.length === 0) {
    return fallbackColors("dark");
  }

  // 3. 统计每个聚类的像素数（重新分配一次）
  const counts = new Array(centers.length).fill(0);
  for (const px of pixels) {
    let minDist = Infinity;
    let minIdx = 0;
    for (let i = 0; i < centers.length; i++) {
      const [cr, cg, cb] = centers[i];
      const dr = px[0] - cr;
      const dg = px[1] - cg;
      const db = px[2] - cb;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < minDist) {
        minDist = dist;
        minIdx = i;
      }
    }
    counts[minIdx]++;
  }

  // 4. 选主背景：像素数最多的聚类
  let bgIdx = 0;
  for (let i = 1; i < centers.length; i++) {
    if (counts[i] > counts[bgIdx]) bgIdx = i;
  }
  const bgRgb = centers[bgIdx];
  const bgHex = rgbToHex(bgRgb[0], bgRgb[1], bgRgb[2]);

  // 5. 判定 baseMode
  const bgLuminance = relativeLuminance(bgRgb[0], bgRgb[1], bgRgb[2]);
  const baseMode: "dark" | "light" = bgLuminance < 0.5 ? "dark" : "light";

  // 6. 派生 bg 系列
  const panelBg = adjustLightness(bgHex, baseMode === "dark" ? 4 : -3);
  const panelBgAlt = adjustLightness(bgHex, baseMode === "dark" ? 8 : -6);
  const border = adjustLightness(bgHex, baseMode === "dark" ? 12 : -12);
  const bgTerminal = bgHex;

  // 7. text / text_muted：不从图片提取，保证可读性
  const text = baseMode === "dark" ? "#fafafa" : "#0a0a0a";
  const textMuted = baseMode === "dark" ? "#a3a3a3" : "#737373";

  // 8. primary：取饱和度最高且与 bg 对比度 ≥ 4.5 的聚类；都不满足则回退品牌色
  // 以下 fallback HEX（#3b65b8/#365eaa/#fafafa/#0a0a0a/#a3a3a3/#737373）与 global.css 的
  // --primary / --text / --text-muted 令牌保持一致，改品牌色时需同步更新两处
  let primaryHex = baseMode === "dark" ? "#3b65b8" : "#365eaa";
  let bestSat = -1;
  for (let i = 0; i < centers.length; i++) {
    if (i === bgIdx) continue;
    const [r, g, b] = centers[i];
    const [, s] = rgbToHsl(r, g, b);
    if (s < 0.2) continue; // 过滤接近灰色的聚类
    const lum = relativeLuminance(r, g, b);
    const ratio = contrastRatio(bgLuminance, lum);
    if (ratio >= 4.5 && s > bestSat) {
      bestSat = s;
      primaryHex = rgbToHex(r, g, b);
    }
  }

  // 9. primary 派生
  const primaryHover = adjustLightness(primaryHex, baseMode === "dark" ? 8 : -8);
  const primaryForeground = baseMode === "dark" ? "#ffffff" : "#ffffff";
  const [pr, pg, pb] = hexToRgb(primaryHex);
  const primarySoft = `rgba(${pr}, ${pg}, ${pb}, 0.14)`;
  const primaryBorder = `rgba(${pr}, ${pg}, ${pb}, 0.40)`;

  // 10. 对比度保障：text 与 bg 对比度 < 4.5 时，强制切换
  const textLum = relativeLuminance(...hexToRgb(text));
  if (contrastRatio(bgLuminance, textLum) < 4.5) {
    // 中灰背景等极端情况：选对比度更高的黑或白
    const blackRatio = contrastRatio(bgLuminance, 0);
    const whiteRatio = contrastRatio(bgLuminance, 1);
    const fallbackText = blackRatio > whiteRatio ? "#000000" : "#ffffff";
    return {
      bg: bgHex,
      panel_bg: panelBg,
      panel_bg_alt: panelBgAlt,
      text: fallbackText,
      text_muted: textMuted,
      border,
      primary: primaryHex,
      primary_hover: primaryHover,
      primary_foreground: primaryForeground,
      primary_soft: primarySoft,
      primary_border: primaryBorder,
      bg_terminal: bgTerminal,
      baseMode,
    };
  }

  return {
    bg: bgHex,
    panel_bg: panelBg,
    panel_bg_alt: panelBgAlt,
    text,
    text_muted: textMuted,
    border,
    primary: primaryHex,
    primary_hover: primaryHover,
    primary_foreground: primaryForeground,
    primary_soft: primarySoft,
    primary_border: primaryBorder,
    bg_terminal: bgTerminal,
    baseMode,
  };
}

/** 兜底颜色（图片全透明或无像素时） */
function fallbackColors(baseMode: "dark" | "light"): ExtractedColors {
  const bg = baseMode === "dark" ? "#0a0a0a" : "#ffffff";
  const primary = baseMode === "dark" ? "#3b65b8" : "#365eaa";
  const [pr, pg, pb] = hexToRgb(primary);
  return {
    bg,
    panel_bg: adjustLightness(bg, baseMode === "dark" ? 4 : -3),
    panel_bg_alt: adjustLightness(bg, baseMode === "dark" ? 8 : -6),
    text: baseMode === "dark" ? "#fafafa" : "#0a0a0a",
    text_muted: baseMode === "dark" ? "#a3a3a3" : "#737373",
    border: adjustLightness(bg, baseMode === "dark" ? 12 : -12),
    primary,
    primary_hover: adjustLightness(primary, baseMode === "dark" ? 8 : -8),
    primary_foreground: "#ffffff",
    primary_soft: `rgba(${pr}, ${pg}, ${pb}, 0.14)`,
    primary_border: `rgba(${pr}, ${pg}, ${pb}, 0.40)`,
    bg_terminal: bg,
    baseMode,
  };
}

// ============ Canvas 加载辅助（DOM 耦合，不导出） ============

/**
 * 从 Blob URL 加载图片到 Canvas，返回 ImageData 的 data 字段
 * 缩放到 64x64 上限，降低 K-means 计算量
 */
export async function loadImageToImageData(url: string): Promise<Uint8ClampedArray> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const max = 64;
  const scale = Math.min(max / img.width, max / img.height, 1);
  const w = Math.max(1, Math.floor(img.width * scale));
  const h = Math.max(1, Math.floor(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法获取 Canvas 2D 上下文");
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/**
 * 从视频 URL 加载首帧到 Canvas，返回 ImageData 的 data 字段
 * 缩放到 64x64 上限，与 loadImageToImageData 一致，复用 extractThemeColors
 */
export async function loadVideoFirstFrameToImageData(url: string): Promise<Uint8ClampedArray> {
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.crossOrigin = "anonymous";
  // 等待首帧可绘制
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("视频首帧加载失败"));
  });
  // seek 到 0 确保取首帧
  video.currentTime = 0;
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve();
  });
  const max = 64;
  const scale = Math.min(max / video.videoWidth, max / video.videoHeight, 1);
  const w = Math.max(1, Math.floor(video.videoWidth * scale));
  const h = Math.max(1, Math.floor(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法获取 Canvas 2D 上下文");
  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/**
 * 判断文件名是否为视频（mp4）
 */
export function isVideoFile(filename: string): boolean {
  return filename.toLowerCase().endsWith(".mp4");
}
