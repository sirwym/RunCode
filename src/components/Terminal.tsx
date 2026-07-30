import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import type { ITheme as XTermTheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import type { CustomThemeColors } from "../types";
import { hexToRgb } from "../utils/colorExtract";
import { useI18n } from "../hooks/useI18n";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Copy, ClipboardPaste, BoxSelect, Eraser } from "lucide-react";

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

interface TerminalProps {
  runId: string | null; // PTY 会话 ID
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
  // 编译成功但有 warning 时的 stderr（PTY 交互模式下编译成功仍启动 PTY，
  // 在 PTY 交互输出前以黄色显示，不阻止程序启动，不触发错误状态）
  compileWarning?: string | null;
  onFocusChange?: (focused: boolean) => void;
  visible?: boolean;
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

// xterm.js 终端组件。
// - runId 非空时监听 pty_output / pty_exit 事件
// - 用户输入通过 onData → write_pty_stdin
// - 容器大小变化通过 ResizeObserver → resize_pty
// - fontSize 仅在初始化时读取，运行中改设置需重启应用生效
function Terminal({ runId, onExit, fontSize, theme, customColors, panelAlpha, baseMode, compileError, compileWarning, onFocusChange, visible = true }: TerminalProps) {
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
  // 保存最新的 compileWarning，runId effect 在 term.reset() 后写入（避免被 reset 清除）
  const compileWarningRef = useRef(compileWarning);
  compileWarningRef.current = compileWarning;

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

  const handleCopy = () => {
    const term = termRef.current;
    if (!term) return;
    const sel = term.getSelection();
    if (sel) void navigator.clipboard.writeText(sel).catch(() => {});
  };

  const handlePaste = async () => {
    const term = termRef.current;
    if (!term) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) term.paste(text);
    } catch {
      // 剪贴板读取失败（权限受限等），静默忽略
    }
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

  // 初始化终端（只执行一次）
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      fontFamily:
        "'JetBrains Mono Variable', 'JetBrains Mono', 'SF Mono', Menlo, 'Cascadia Code', monospace",
      fontSize: fontSizeRef.current ?? 13,
      cursorBlink: true,
      // 活跃光标为细竖条（接近编辑器光标），失焦时降级为方块以便区分聚焦状态
      cursorStyle: "bar",
      cursorInactiveStyle: "block",
      convertEol: false,
      scrollback: 5000,
      theme: resolveXtermTheme(themeRef.current, customColorsRef.current, panelAlphaRef.current, baseModeRef.current),
    });
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

    // 容器大小变化时自动 fit + 通知后端 resize
    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return;
      try {
        fitRef.current.fit();
      } catch {
        // 忽略 fit 错误（容器未挂载等）
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
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
    term.write(`\r\n\x1b[31m${compileError}\x1b[0m\r\n`);
  }, [compileError]);

  // runId 变化时绑定/解绑事件 + onData
  useEffect(() => {
    const term = termRef.current;
    if (!term || !runId) return;

    // 清空终端（新会话）
    term.reset();

    // 编译成功但有 warning 时，在 PTY 交互输出前显示 warning（黄色 \x1b[33m）。
    // 必须在 term.reset() 之后、PTY 输出事件 setup 之前同步写入，
    // 否则会被 reset 清除或被后续 PTY 输出覆盖时序混乱。
    // warning 不阻止程序启动，PTY 会话正常建立，用户仍可输入交互。
    const warning = compileWarningRef.current;
    if (warning) {
      term.write(`\r\n\x1b[33m${warning}\x1b[0m\r\n`);
    }

    // 监听 PTY 输出
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;

    const setup = async () => {
      // 输出节流：用 rAF 批量 write，避免死循环刷屏程序淹没事件循环
      let buffer = "";
      let rafId: number | null = null;
      const flush = () => {
        rafId = null;
        if (buffer) {
          term.write(buffer);
          buffer = "";
        }
      };

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

      unlistenExit = await listen<{
        run_id: string;
        exit_code: number | null;
        killed_by: string | null;
        max_rss_kb: number;
      }>("pty_exit", (e) => {
        if (e.payload.run_id === runId) {
          // 退出前冲刷残留缓冲
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          if (buffer) {
            term.write(buffer);
            buffer = "";
          }
          term.write("\x1b[?25h");
          onExitRef.current(e.payload.exit_code, e.payload.killed_by, e.payload.max_rss_kb || null);
        }
      });
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
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handlePaste}>
            <ClipboardPaste className="h-3 w-3" />
            {t("panel.terminalMenu.paste")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSelectAll}>
            <BoxSelect className="h-3 w-3" />
            {t("panel.terminalMenu.selectAll")}
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
