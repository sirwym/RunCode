import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import type { ITheme as XTermTheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

// xterm 深色主题：与原默认黑底一致
const XTERM_DARK_THEME: XTermTheme = {
  background: "#1e1e2e",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  cursorAccent: "#1e1e2e",
  selectionBackground: "rgba(255, 255, 255, 0.2)",
  black: "#000000",
  red: "#f48771",
  green: "#4ec9b0",
  yellow: "#dcdcaa",
  blue: "#569cd6",
  magenta: "#c586c0",
  cyan: "#9cdcfe",
  white: "#d4d4d4",
  brightBlack: "#808080",
  brightRed: "#f48771",
  brightGreen: "#4ec9b0",
  brightYellow: "#dcdcaa",
  brightBlue: "#569cd6",
  brightMagenta: "#c586c0",
  brightCyan: "#9cdcfe",
  brightWhite: "#ffffff",
};

// xterm 浅色主题：与 CSS 浅色主题、Monaco vs 主题协调
const XTERM_LIGHT_THEME: XTermTheme = {
  background: "#ffffff",
  foreground: "#1e1e1e",
  cursor: "#1e1e1e",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(0, 122, 204, 0.2)",
  black: "#000000",
  red: "#c0392b",
  green: "#2e8b57",
  yellow: "#b8860b",
  blue: "#0066b8",
  magenta: "#8e44ad",
  cyan: "#16a085",
  white: "#1e1e1e",
  brightBlack: "#6c6c6c",
  brightRed: "#c0392b",
  brightGreen: "#2e8b57",
  brightYellow: "#b8860b",
  brightBlue: "#0066b8",
  brightMagenta: "#8e44ad",
  brightCyan: "#16a085",
  brightWhite: "#000000",
};

interface TerminalProps {
  runId: string | null; // PTY 会话 ID
  onExit: (exitCode: number | null, killedBy: string | null) => void;
  fontSize?: number;
  theme?: "dark" | "light";
  // 编译失败时的 stderr（PTY 交互模式下编译失败不创建 PTY 会话，
  // 由父组件传入 stderr 直接显示）
  compileError?: string | null;
}

// xterm.js 终端组件。
// - runId 非空时监听 pty_output / pty_exit 事件
// - 用户输入通过 onData → write_pty_stdin
// - 容器大小变化通过 ResizeObserver → resize_pty
// - fontSize 仅在初始化时读取，运行中改设置需重启应用生效
function Terminal({ runId, onExit, fontSize, theme, compileError }: TerminalProps) {
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

  // 初始化终端（只执行一次）
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      fontFamily:
        "'JetBrains Mono Variable', 'JetBrains Mono', 'SF Mono', Menlo, 'Cascadia Code', monospace",
      fontSize: fontSizeRef.current ?? 13,
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      theme: themeRef.current === "light" ? XTERM_LIGHT_THEME : XTERM_DARK_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

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

  // theme 变化时运行时更新终端主题（无需重建终端）
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = theme === "light" ? XTERM_LIGHT_THEME : XTERM_DARK_THEME;
  }, [theme]);

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

    // 监听 PTY 输出
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;

    const setup = async () => {
      unlistenOutput = await listen<{ run_id: string; data: string }>(
        "pty_output",
        (e) => {
          if (e.payload.run_id === runId) {
            term.write(e.payload.data);
          }
        },
      );

      unlistenExit = await listen<{
        run_id: string;
        exit_code: number | null;
        killed_by: string | null;
      }>("pty_exit", (e) => {
        if (e.payload.run_id === runId) {
          onExitRef.current(e.payload.exit_code, e.payload.killed_by);
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

  return <div className="terminal-container" ref={containerRef} />;
}

export default Terminal;
