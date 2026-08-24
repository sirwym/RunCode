import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import type { ITheme as XTermTheme, ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import type { CustomThemeColors } from "../types";
import { hexToRgb } from "../utils/colorExtract";
import { formatStderrWithTranslation } from "../utils/compileErrors";
import { useI18n } from "../hooks/useI18n";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Copy, ClipboardPaste, BoxSelect, Eraser } from "lucide-react";

// 平台检测（与 App.tsx / SettingsPanel.tsx / Editor.tsx 一致的内联表达式）
const isMac =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

// xterm 深色主题：背景与 global.css 中 --bg-terminal 深色值一致（#0a0a0a），
// 避免与周围 panel-bg（#141414）产生色差；光标/选区/ANSI blue 与 RunCode 主题协调
// 注：xterm 主题需直接提供颜色字符串（运行时适配层），无法消费 CSS 变量；
// 颜色值必须与 global.css / ADR-0006 中的品牌令牌保持一致，并由 Terminal.test.ts 验证
export const XTERM_DARK_THEME: XTermTheme = {
  background: "#0a0a0a",
  foreground: "#d4d4d4",
  cursor: "#6f91d5",
  cursorAccent: "#0a0a0a",
  selectionBackground: "rgba(74, 116, 198, 0.30)",
  black: "#000000",
  red: "#f48771",
  green: "#4ec9b0",
  yellow: "#dcdcaa",
  blue: "#3b65b8",
  magenta: "#c586c0",
  cyan: "#9cdcfe",
  white: "#d4d4d4",
  brightBlack: "#808080",
  brightRed: "#f48771",
  brightGreen: "#4ec9b0",
  brightYellow: "#dcdcaa",
  brightBlue: "#4a74c6",
  brightMagenta: "#c586c0",
  brightCyan: "#9cdcfe",
  brightWhite: "#ffffff",
};

// xterm 浅色主题：背景与 CSS 浅色主题、Monaco vs 主题协调，光标/选区/ANSI blue 使用 RunCode Slate
export const XTERM_LIGHT_THEME: XTermTheme = {
  background: "#ffffff",
  foreground: "#1e1e1e",
  cursor: "#365eaa",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(54, 94, 170, 0.25)",
  black: "#000000",
  red: "#c0392b",
  green: "#2e8b57",
  yellow: "#b8860b",
  blue: "#365eaa",
  magenta: "#8e44ad",
  cyan: "#16a085",
  white: "#1e1e1e",
  brightBlack: "#6c6c6c",
  brightRed: "#c0392b",
  brightGreen: "#2e8b57",
  brightYellow: "#b8860b",
  brightBlue: "#2f5498",
  brightMagenta: "#8e44ad",
  brightCyan: "#16a085",
  brightWhite: "#000000",
};

// 由 custom_theme.colors + panel_alpha + base_mode 构造 xterm 主题
// 背景/光标/选区/blue 用提取色；ANSI 其他色沿用 base_mode 对应预设（不从图片提取，保证可读性）
// panel_alpha 控制终端背景透明度（与面板透明度一致）
// xterm 的 ITheme 接受 rgba() 和 HEX 两种字符串（与 Monaco 不同），无需 HEX 8 位转换
// baseMode 决定 ANSI 预设（light → XTERM_LIGHT_THEME，dark → XTERM_DARK_THEME）
// 禁止用 bg_terminal === "#ffffff" 推断（浅色图可能提取出 #f3f7f8 等非纯白）
export function buildCustomXtermTheme(
  c: CustomThemeColors,
  panelAlpha: number = 0.82,
  baseMode: "light" | "dark" = "dark",
): XTermTheme {
  const [pr, pg, pb] = hexToRgb(c.primary);
  const [br, bgg, bb] = hexToRgb(c.bg_terminal);
  const base = baseMode === "light" ? XTERM_LIGHT_THEME : XTERM_DARK_THEME;
  return {
    ...base,
    background: `rgba(${br}, ${bgg}, ${bb}, ${panelAlpha})`,
    foreground: c.text,
    cursor: c.primary,
    cursorAccent: c.bg_terminal,
    selectionBackground: `rgba(${pr}, ${pg}, ${pb}, 0.30)`,
    blue: c.primary,
    brightBlue: c.primary_hover,
  };
}

/// 选区保活时的缓冲积压上限（512KB）。
/// 超过此大小强制 flush，防止死循环输出导致 buffer 无限增长。
const MAX_DEFERRED_BUFFER_BYTES = 512 * 1024;

/// 判断是否应推迟 flush 以保留 xterm 选区。
///
/// xterm.js 的 Terminal.write() 会清除当前选区。当用户选中文本（如准备复制）
/// 时，若此时有新输出到达，write() 会清除选区导致用户操作中断。
/// 此函数在"有选区"且"缓冲未超限"时返回 true，让调用方推迟一帧再写入。
///
/// @param hasSelection - xterm 当前是否有选区
/// @param bufferSize   - 当前积压的缓冲大小（buffer.length）
/// @returns true 表示应推迟 flush，false 表示应立即 flush
export function shouldDeferFlush(hasSelection: boolean, bufferSize: number): boolean {
    return hasSelection && bufferSize > 0 && bufferSize < MAX_DEFERRED_BUFFER_BYTES;
}

/// 将文本中的换行符统一为 \r\n（CRLF）。
///
/// xterm 配置 convertEol: false 时，\n 只下移行不回列首，
/// 会导致非 PTY 来源的文本（如 gcc/clang 的 stderr，行尾为 \n）
/// 在终端中错位显示。此函数将 \n 和 \r\n 统一转为 \r\n，
/// 供 compileError 等直接写入路径使用。
///
/// @param text - 原始文本（可能含 \n、\r\n 或混合）
/// @returns 行尾全部为 \r\n 的文本
export function normalizeEol(text: string): string {
    return text.replace(/\r?\n/g, "\r\n");
}

/// 终端键盘快捷键动作判定。
/// 在 document capture phase keydown 监听器中调用，根据按键事件 + 平台 + 选区状态
/// 判定应执行的操作。纯函数，便于单元测试。
///
/// 平台差异：
/// - 共享：Ctrl+C（无 Shift）有选区时复制，无选区时放行让 xterm 发送 SIGINT
/// - Mac：Ctrl+Shift+C 强制复制 / Ctrl+Shift+V 粘贴
/// - Windows：Ctrl+V 粘贴 / Ctrl+A 全选
///
/// @param e            - KeyboardEvent 子集（ctrlKey/shiftKey/altKey/metaKey/key）
/// @param isMac        - 是否 macOS 平台
/// @param hasSelection - xterm 当前是否有选区
/// @returns "copy" | "paste" | "selectAll" | "none"（none = 不拦截，放行给 xterm）
export function resolveTerminalKeyAction(
  e: Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "key">,
  isMac: boolean,
  hasSelection: boolean,
): "copy" | "paste" | "selectAll" | "none" {
  const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;

  // Ctrl+C（无 Shift）：有选区时复制，无选区时放行（xterm 发送 \x03 SIGINT）
  if (ctrl && !e.shiftKey && (e.key === "c" || e.key === "C")) {
    return hasSelection ? "copy" : "none";
  }

  if (isMac) {
    // Mac：Ctrl+Shift+C 强制复制 / Ctrl+Shift+V 粘贴
    if (ctrl && e.shiftKey) {
      if (e.key === "c" || e.key === "C") return "copy";
      if (e.key === "v" || e.key === "V") return "paste";
    }
  } else {
    // Windows：Ctrl+V 粘贴 / Ctrl+A 全选
    // Ctrl+V 默认发送 \x16（readline verbatim），Ctrl+A 默认发送 \x01（readline 行首），
    // 需在 document capture phase 拦截
    if (ctrl && !e.shiftKey) {
      if (e.key === "v" || e.key === "V") return "paste";
      if (e.key === "a" || e.key === "A") return "selectAll";
    }
  }

  return "none";
}

// 构建 PTY 退出时写入终端的控制序列（纯函数，便于单测）。
// - killed_by === "signal"：前置红色信号终止提示行
// - 末尾统一隐藏光标（\x1b[?25l）：程序结束后（正常退出 / 手动停止 / 输出超限）
//   光标无存在意义，避免学员误以为仍可输入。此处的 ?25l 与 runId effect
//   （runId 变 null 时）的双写互为兜底——本序列走 buffer/rAF 延迟，可能被
//   cleanup 取消；runId effect 的直写才是可靠路径。下次运行就绪时由
//   autoFocusSeq effect 写 \x1b[?25h 恢复（RIS 不重置 isCursorHidden）。
export function buildPtyExitSequence(killedBy: string | null, signalTerminatedText: string): string {
  let seq = "";
  if (killedBy === "signal") {
    seq += `\r\n\x1b[31m${signalTerminatedText}\x1b[0m\r\n`;
  }
  seq += "\x1b[?25l";
  return seq;
}

interface TerminalProps {
  runId: string | null; // PTY 会话 ID
  // 当前活动 tab id：变化时清空终端（终端 = 当前 tab 的草稿区，不跨 tab 保留输出）
  tabId: string | null;
  onExit: (exitCode: number | null, killedBy: string | null, maxRssKb: number | null) => void;
  fontSize?: number;
  theme?: "dark" | "light" | "custom";
  // 自定义图片主题颜色（仅 theme === "custom" 时使用）
  customColors?: CustomThemeColors;
  // 面板背景透明度 0.50~0.95（仅 theme === "custom" 时使用）
  panelAlpha?: number;
  // 自定义主题 base_mode（仅 theme === "custom" 时使用，决定 ANSI 浅色/深色预设）
  baseMode?: "light" | "dark";
  // 编译失败时的 stderr（PTY 交互模式下编译失败不创建 PTY 会话，
  // 由父组件传入 stderr 直接显示）
  compileError?: string | null;
  onFocusChange?: (focused: boolean) => void;
  visible?: boolean;
  // PTY 就绪信号（来自 useRunManager.ptyReadySeq，单调递增）。
  // 变化时（编译完成、PTY 建立）自动聚焦终端，光标立即闪烁提示可输入。
  // 0 表示尚未就绪（含应用启动首次渲染），不聚焦。
  autoFocusSeq?: number;
}

// 根据 theme + customColors + panelAlpha + baseMode 选择生效的 xterm 主题
function resolveXtermTheme(
  theme: "dark" | "light" | "custom" | undefined,
  customColors?: CustomThemeColors,
  panelAlpha?: number,
  baseMode?: "light" | "dark",
): XTermTheme {
  if (theme === "custom" && customColors) {
    return buildCustomXtermTheme(customColors, panelAlpha, baseMode ?? "dark");
  }
  if (theme === "light") return XTERM_LIGHT_THEME;
  return XTERM_DARK_THEME;
}

// 构建 xterm 初始化选项（纯函数，便于单测）
export function buildXtermOptions(
  fontSize: number | undefined,
  theme: XTermTheme,
): ITerminalOptions {
  return {
    fontFamily:
      "'JetBrains Mono Variable', 'JetBrains Mono', 'SF Mono', Menlo, 'Cascadia Code', monospace",
    fontSize: fontSize ?? 13,
    cursorBlink: true,
    // 活跃光标为 2px 竖条（默认 1px 远距离不易察觉，教学场景加宽），
    // 失焦时降级为方块以便区分聚焦状态
    cursorStyle: "bar",
    cursorWidth: 2,
    cursorInactiveStyle: "block",
    convertEol: false,
    scrollback: 5000,
    theme,
  };
}

// xterm.js 终端组件。
// - runId 非空时监听 pty_output / pty_exit 事件
// - 用户输入通过 onData → write_pty_stdin
// - 容器大小变化通过 ResizeObserver → resize_pty
// - fontSize 仅在初始化时读取，运行中改设置需重启应用生效
function Terminal({ runId, tabId, onExit, fontSize, theme, customColors, panelAlpha, baseMode, compileError, onFocusChange, visible = true, autoFocusSeq }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // 保存最新的 onExit 到 ref，避免 effect 频繁重建
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  // 保存最新的 fontSize，初始化时读取，后续通过 effect 运行时更新
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  // 保存最新的 theme，初始化时读取，后续通过 effect 运行时更新
  const themeRef = useRef(theme);
  themeRef.current = theme;
  // 保存最新的 customColors，初始化时读取，后续通过 effect 运行时更新
  const customColorsRef = useRef(customColors);
  customColorsRef.current = customColors;
  // 保存最新的 panelAlpha，初始化时读取，后续通过 effect 运行时更新
  const panelAlphaRef = useRef(panelAlpha);
  panelAlphaRef.current = panelAlpha;
  // 保存最新的 baseMode，初始化时读取，后续通过 effect 运行时更新
  const baseModeRef = useRef(baseMode);
  baseModeRef.current = baseMode;
  // 保存最新的 onFocusChange，避免 effect 频繁重建
  const onFocusChangeRef = useRef(onFocusChange);
  onFocusChangeRef.current = onFocusChange;
  // 保存最新的 runId，供 ResizeObserver 在拖拽分屏后同步 resize_pty
  const runIdRef = useRef(runId);
  runIdRef.current = runId;
  // 保存最新的 visible，供 autoFocusSeq effect 读取（避免 effect 依赖 visible 导致多余触发）
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // 右键菜单状态
  const t = useI18n((s) => s.t);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [hasSelection, setHasSelection] = useState(false);

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const term = termRef.current;
    setHasSelection(!!term?.hasSelection());
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setMenuOpen(true);
  };

  const handleCopy = async () => {
    const term = termRef.current;
    if (!term) return;
    const sel = term.getSelection();
    if (!sel) return;
    // WebView2 中 navigator.clipboard 可能因安全上下文或权限问题失败，
    // 使用 execCommand fallback 确保复制可靠工作
    try {
      await navigator.clipboard.writeText(sel);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = sel;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
  };

  const handlePaste = async () => {
    const term = termRef.current;
    if (!term) return;
    let text: string | null = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // WebView2 中 clipboard API 可能不可用，尝试 execCommand fallback
      const ta = document.createElement("textarea");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      try {
        if (document.execCommand("paste")) {
          text = ta.value;
        }
      } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    if (text) term.paste(text);
  };

  const handleSelectAll = () => {
    termRef.current?.selectAll();
  };

  const handleClear = () => {
    const term = termRef.current;
    if (!term) return;
    term.clear();
    term.scrollToBottom();
  };

  // 保存最新的 handleCopy / handlePaste 到 ref，供 keydown 监听器使用
  const handleCopyRef = useRef(handleCopy);
  handleCopyRef.current = handleCopy;
  const handlePasteRef = useRef(handlePaste);
  handlePasteRef.current = handlePaste;

  // 初始化终端（只执行一次）
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm(
      buildXtermOptions(
        fontSizeRef.current,
        resolveXtermTheme(themeRef.current, customColorsRef.current, panelAlphaRef.current, baseModeRef.current),
      ),
    );
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    term.blur();

    termRef.current = term;
    fitRef.current = fit;

    // 上报焦点变化：xterm 6 移除了 onFocusChange API，改用 textarea DOM 事件
    const textarea = containerRef.current.querySelector("textarea");
    const handleFocus = () => onFocusChangeRef.current?.(true);
    const handleBlur = () => onFocusChangeRef.current?.(false);
    textarea?.addEventListener("focus", handleFocus);
    textarea?.addEventListener("blur", handleBlur);

    // 终端键盘快捷键（document 级 capture phase）：
    // 必须在 document 层级拦截，因为 xterm.js 在 term.open() 时注册了 textarea 级
    // capture-phase keydown 处理器，比后注册的 textarea 级处理器先执行。
    // document capture phase 在所有元素之前触发，确保能在 xterm.js 之前拦截。
    // - Ctrl+C（两平台）：有选区时复制（stopImmediatePropagation 阻止 xterm 发送 \x03），
    //                     无选区时放行让 xterm 发送 SIGINT（^C）给子进程
    // - Mac：Ctrl+Shift+C 强制复制 / Ctrl+Shift+V 粘贴
    // - Windows：Ctrl+V 粘贴 / Ctrl+A 全选
    //   （Ctrl+V 默认发送 \x16 readline verbatim，Ctrl+A 默认发送 \x01 readline 行首，
    //    均需在 capture phase 拦截）
    const handleTerminalKeydown = (e: KeyboardEvent) => {
      // 只拦截终端 textarea 的键盘事件
      if (e.target !== textarea) return;
      const action = resolveTerminalKeyAction(e, isMac, term.hasSelection());
      if (action === "none") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (action === "copy") {
        void handleCopyRef.current();
      } else if (action === "paste") {
        void handlePasteRef.current();
      } else if (action === "selectAll") {
        term.selectAll();
      }
    };
    document.addEventListener("keydown", handleTerminalKeydown, true);

    // 容器大小变化时自动 fit + 通知后端 resize（rAF 防抖避免同帧多次调用）
    let rafId: number | null = null;
    const ro = new ResizeObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!fitRef.current || !termRef.current) return;
        try {
          fitRef.current.fit();
          // 拖拽分屏后同步 PTY 尺寸，防止后端按旧 cols 输出导致前端二次软换行
          const rid = runIdRef.current;
          if (rid) {
            void invoke("resize_pty", { runId: rid, cols: termRef.current.cols, rows: termRef.current.rows }).catch(() => {});
          }
        } catch {
          // 忽略 fit 错误（容器未挂载等）
        }
      });
    });
    ro.observe(containerRef.current);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
      document.removeEventListener("keydown", handleTerminalKeydown, true);
      textarea?.removeEventListener("focus", handleFocus);
      textarea?.removeEventListener("blur", handleBlur);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // fontSize 变化时运行时更新终端字号（无需重建终端）
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    if (fontSize === undefined) return;
    term.options.fontSize = fontSize;
    try {
      fit.fit();
    } catch {
      // 忽略
    }
  }, [fontSize]);

  // autoFocusSeq 变化（编译完成、PTY 就绪）时聚焦终端：
  // 光标立即闪烁，提示学生"程序已就绪，可以输入"（方案 B）。
  // 编译期间不聚焦——此时 PTY 未建立，输入会静默丢失。
  useEffect(() => {
    if (!autoFocusSeq) return;
    const term = termRef.current;
    if (!term) return;
    // 恢复光标可见：上一程序退出时被 buildPtyExitSequence 的 ?25l 隐藏，
    // 且 term.reset()（RIS）不重置 isCursorHidden，必须显式恢复。
    // 无论终端 tab 是否可见都写入（光标可见性是状态而非像素），
    // 否则编译期间切走 tab 的会话切回后光标永久消失。
    term.write("\x1b[?25h");
    // 终端 tab 不可见时（编译期间用户手动切走面板 tab）不抢焦点
    if (visibleRef.current) term.focus();
  }, [autoFocusSeq]);

  // theme / customColors / panelAlpha / baseMode 变化时运行时更新终端主题（无需重建终端）
  // 用 JSON.stringify(customColors) 作为依赖键，避免对象引用变化导致无限循环
  const customColorsKey = customColors ? JSON.stringify(customColors) : "";
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = resolveXtermTheme(theme, customColors, panelAlpha, baseMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, customColorsKey, panelAlpha, baseMode]);

  // visible 变化时（从 display:none 切回显示）重新计算尺寸
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit || !visible) return;
    try {
      fit.fit();
    } catch {
      // 忽略
    }
  }, [visible]);

  // compileError 变化时显示编译错误（PTY 交互模式下编译失败不创建 PTY 会话，
  // 直接把 stderr 写入终端显示）
  useEffect(() => {
    const term = termRef.current;
    if (!term || !compileError) return;
    term.reset();
    term.write(`\r\n\x1b[31m${normalizeEol(formatStderrWithTranslation(compileError))}\x1b[0m\r\n`);
  }, [compileError]);

  // 切换 tab 时清空终端（含回滚缓冲）：终端是当前 tab 的草稿区，不跨 tab 保留输出。
  // reset（RIS）不清 isCursorHidden，光标可见性由 runId effect 统一管理。
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.reset();
  }, [tabId]);

  // runId 变化时绑定/解绑事件 + onData
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    if (!runId) {
      // 会话结束（正常退出 / 停止 / 编译失败 → store ptyRunId → null）时隐藏光标。
      // 不能依赖 pty_exit 监听器经 buffer/rAF 写入 ?25l：
      // - 退出路径：onExit 同步触发 ptyRunId → null → 本 effect cleanup
      //   cancelAnimationFrame，pending 的 ?25l 会被整体丢弃；
      // - 停止路径：stopInteractive 先清空 ptyRunId 解绑监听器，pty_exit 根本收不到。
      // 在此统一写入可覆盖所有路径；?25l 是纯模式切换，不会清除用户选区，
      // 且 term 实例独立于本 effect 存活。下次会话就绪由 autoFocusSeq 写 ?25h 恢复。
      term.write("\x1b[?25l");
      return;
    }

    // 清空终端（新会话）
    term.reset();

    // 监听 PTY 输出
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;
    // disposed 标志：防止 cleanup 在 setup 的 await listen 完成前调用导致监听器泄漏
    let disposed = false;

    // 输出节流：用 rAF 批量 write，避免死循环刷屏程序淹没事件循环
    // buffer / rafId 声明在 setup 外部，以便 cleanup 能 cancelAnimationFrame
    let buffer = "";
    let rafId: number | null = null;
    const flush = () => {
      // 有选区时推迟写入，避免 term.write() 清除用户选区
      if (shouldDeferFlush(term.hasSelection(), buffer.length)) {
        rafId = requestAnimationFrame(flush);
        return;
      }
      rafId = null;
      if (buffer) {
        term.write(buffer);
        buffer = "";
      }
    };

    const setup = async () => {
      unlistenOutput = await listen<{ run_id: string; data: string }>(
        "pty_output",
        (e) => {
          if (e.payload.run_id === runId) {
            buffer += e.payload.data;
            if (rafId === null) {
              rafId = requestAnimationFrame(flush);
            }
          }
        },
      );
      // cleanup 已在 await 期间调用，立即清理刚注册的监听器
      if (disposed) {
        unlistenOutput();
        unlistenOutput = null;
        return;
      }

      unlistenExit = await listen<{
        run_id: string;
        exit_code: number | null;
        killed_by: string | null;
        max_rss_kb: number;
      }>("pty_exit", (e) => {
        if (e.payload.run_id === runId) {
          // 将退出序列追加到 buffer，由 flush 统一写入。
          // flush 会在有选区时推迟写入（shouldDeferFlush），
          // 避免 pty_exit 延迟到达时 term.write() 清除用户选区。
          // Windows ConPTY 子进程退出后不返回 EOF，drain_reader_with_timeout
          // 有 500ms 超时，期间用户可能已开始选中输出文本。
          // 退出序列含 ?25l 隐藏光标（所有退出路径：正常 / 停止 / 超限 / 信号）。
          buffer += buildPtyExitSequence(e.payload.killed_by, t("killed.signalTerminated"));
          // 确保有 flush 被调度（可能已有 rAF 在等待）
          if (rafId === null) {
            rafId = requestAnimationFrame(flush);
          }
          // 立即通知 UI 退出状态（不涉及终端写入，不影响选区）
          onExitRef.current(e.payload.exit_code, e.payload.killed_by, e.payload.max_rss_kb || null);
        }
      });
      if (disposed) {
        unlistenExit();
        unlistenExit = null;
      }
    };
    void setup();

    // 用户输入 → 写入 PTY stdin
    const dataDisposable = term.onData((data) => {
      void invoke("write_pty_stdin", { runId, data }).catch(() => {
        // PTY 会话可能已结束，忽略写入失败
      });
    });

    // 初始 resize 通知后端
    if (fitRef.current) {
      try {
        fitRef.current.fit();
        const cols = term.cols;
        const rows = term.rows;
        void invoke("resize_pty", { runId, cols, rows }).catch(() => {});
      } catch {
        // 忽略
      }
    }

    return () => {
      disposed = true;
      // 取消未完成的 rAF，防止 cleanup 后仍有无尽循环写入旧 terminal
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (unlistenOutput) unlistenOutput();
      if (unlistenExit) unlistenExit();
      dataDisposable.dispose();
    };
  }, [runId]);

  return (
    <div
      className="terminal-container relative"
      ref={containerRef}
      onContextMenu={handleContextMenu}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <span
            style={{
              position: "absolute",
              left: menuPos.x,
              top: menuPos.y,
              width: 0,
              height: 0,
              pointerEvents: "none",
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem disabled={!hasSelection} onClick={handleCopy}>
            <Copy className="h-3 w-3" />
            {t("panel.terminalMenu.copy")}
            <kbd className="menu-shortcut">{isMac ? "⌘C" : "Ctrl+C"}</kbd>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handlePaste}>
            <ClipboardPaste className="h-3 w-3" />
            {t("panel.terminalMenu.paste")}
            <kbd className="menu-shortcut">{isMac ? "⌘V" : "Ctrl+V"}</kbd>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSelectAll}>
            <BoxSelect className="h-3 w-3" />
            {t("panel.terminalMenu.selectAll")}
            <kbd className="menu-shortcut">{isMac ? "⌘A" : "Ctrl+A"}</kbd>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleClear}>
            <Eraser className="h-3 w-3" />
            {t("panel.terminalMenu.clear")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default Terminal;
