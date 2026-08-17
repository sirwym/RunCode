import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { X } from "lucide-react";
import EditorPane, { type EditorHandle } from "./components/Editor";
import TabBar from "./components/TabBar";
import TestCasesPanel from "./components/TestCasesPanel";
import Terminal from "./components/Terminal";
import FlowchartPanel from "./components/FlowchartPanel";
import StatusBar from "./components/StatusBar";
import SettingsPanel from "./components/SettingsPanel";
import RecentFilesDialog from "./components/RecentFilesDialog";
import CheatsheetDialog from "./components/CheatsheetDialog";
import RecoveryDialog from "./components/RecoveryDialog";
import ConfirmCloseDialog from "./components/ConfirmCloseDialog";
import TitleBar from "./components/TitleBar";
import { useRunManager } from "./hooks/useRunManager";
import { useTestOptions } from "./hooks/useTestOptions";
import { useTestSuite } from "./hooks/useTestSuite";
import { useTabs } from "./hooks/useTabs";
import type { ConfirmCloseCtx, ConfirmCloseDecision } from "./hooks/useTabs";
import { useSettings } from "./hooks/useSettings";
import { useI18n, getT } from "./hooks/useI18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { message } from "@tauri-apps/plugin-dialog";
import type { AppErrorPayload, AppSettings, CustomThemeConfig, FormatResult } from "./types";
import {
  getEffectiveTheme,
  type EffectiveTheme,
  type SettingsTheme,
} from "./utils/theme";
import { parseGccErrors } from "./utils/compileErrors";
import { hexToRgb, isVideoFile } from "./utils/colorExtract";

type PanelTab = "tests" | "terminal" | "flowchart";

/**
 * 解析运行快捷键：根据按键事件和平台返回 "terminal" | "tests" | null。
 *
 * 纯函数，便于单元测试 macOS/Windows 双平台映射。
 * 规则：
 * - 必须是 Enter 键
 * - 拒绝 Alt 组合（避免与其他快捷键冲突）
 * - macOS 主修饰键为 Cmd，Windows 主修饰键为 Ctrl
 * - 拒绝另一平台修饰键同时按下
 * - Shift 区分终端运行（无 Shift）与多样例运行（有 Shift）
 */
export function resolveRunShortcut(
  key: string,
  metaKey: boolean,
  ctrlKey: boolean,
  shiftKey: boolean,
  altKey: boolean,
  isMac: boolean,
): "terminal" | "tests" | null {
  if (key !== "Enter") return null;
  if (altKey) return null;
  if (isMac) {
    if (!metaKey || ctrlKey) return null;
  } else {
    if (!ctrlKey || metaKey) return null;
  }
  return shiftKey ? "tests" : "terminal";
}

// 编辑器字号范围
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 32;
const FONT_SIZE_STEP = 2;
const FONT_SIZE_DEFAULT = 14;

/**
 * 构建 custom 主题的动态 CSS 变量文本（注入到 <style id="custom-theme-vars">）。
 *
 * 纯函数，便于单元测试。关键约束：
 * - 编辑器 surface 用独立变量 `--editor-surface-bg`（单层合成），
 *   不得借用或循环覆盖 `--bg-terminal` / `--bg-terminal-alpha`。
 * - `--bg-terminal` 仍按纯色注入（供非编辑器场景兜底），但 `.editor-container`
 *   在 global.css 中只读 `--editor-surface-bg`。
 * - editorAlpha 仅经 `--editor-surface-bg` 一次应用，Monaco editor.background 保持透明。
 */
export function buildCustomThemeCssText(
  custom: CustomThemeConfig,
  bgImageUrl: string | null,
): string {
  const c = custom.colors;
  const [pr, pg, pb] = hexToRgb(c.primary);
  // c.bg 直接以 hex 字符串使用，无需分解 RGB
  const [pbr, pbg, pbb] = hexToRgb(c.panel_bg);
  const [tr, tg, tb] = hexToRgb(c.bg_terminal);
  const panelA = custom.panel_alpha / 100;
  const editorA = custom.editor_alpha / 100;
  const maskA = custom.mask_opacity / 100;

  return `:root[data-theme="custom"] {
  --primary: ${c.primary};
  --primary-hover: ${c.primary_hover};
  --primary-foreground: ${c.primary_foreground};
  --primary-soft: rgba(${pr}, ${pg}, ${pb}, 0.14);
  --primary-border: rgba(${pr}, ${pg}, ${pb}, 0.40);
  --focus-ring: ${c.primary};
  --selection: rgba(${pr}, ${pg}, ${pb}, 0.30);
  --bg: ${c.bg};
  --border: ${c.border};
  --text: ${c.text};
  --text-muted: ${c.text_muted};
  --bg-terminal: ${c.bg_terminal};
  --panel-bg-alpha: rgba(${pbr}, ${pbg}, ${pbb}, ${panelA});
  --panel-bg-alt-alpha: rgba(${pbr}, ${pbg}, ${pbb}, ${Math.min(panelA + 0.03, 1)});
  --editor-surface-bg: rgba(${tr}, ${tg}, ${tb}, ${editorA});
  --bg-image: ${bgImageUrl ? `url("${bgImageUrl}")` : "none"};
  --mask-opacity: ${maskA};
}`;
}

function App() {
  const t = useI18n((s) => s.t);

  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const newTab = useTabs((s) => s.newTab);
  const openTab = useTabs((s) => s.openTab);
  const openTabDialog = useTabs((s) => s.openTabDialog);
  const closeTab = useTabs((s) => s.closeTab);
  const closeAll = useTabs((s) => s.closeAll);
  const switchTab = useTabs((s) => s.switchTab);
  const saveTab = useTabs((s) => s.saveTab);
  const saveTabAs = useTabs((s) => s.saveTabAs);
  const setContent = useTabs((s) => s.setContent);
  const setSuiteId = useTabs((s) => s.setSuiteId);
  const restoreTabs = useTabs((s) => s.restore);
  const pendingRecovery = useTabs((s) => s.pendingRecovery);
  const applyRecovery = useTabs((s) => s.applyRecovery);
  const dismissRecovery = useTabs((s) => s.dismissRecovery);

  const suiteId = useTestSuite((s) => s.suiteId);

  // 首次加载设置（用于 StatusBar 显示编译参数）
  const loadSettings = useSettings((s) => s.load);

  const editorRef = useRef<EditorHandle>(null);

  // 崩溃恢复：applyRecovery 更新 store，但 Monaco model 独立，需手动同步
  const handleApplyRecovery = useCallback((tabIds: string[]) => {
    applyRecovery(tabIds);
    const tabs = useTabs.getState().tabs;
    for (const tabId of tabIds) {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        editorRef.current?.syncModelContent(tabId, tab.content);
      }
    }
  }, [applyRecovery]);

  // Fix P1-3：关联中的 tabId 集合，防止并发重复创建套件
  const associatingRef = useRef<Set<string>>(new Set());

  const startInteractive = useRunManager((s) => s.startInteractive);
  const runTests = useRunManager((s) => s.runTests);
  const onPtyExit = useRunManager((s) => s.onPtyExit);
  const ptyRunId = useRunManager((s) => s.ptyRunId);
  const compileError = useRunManager((s) => s.compileError);
  const strict = useTestOptions((s) => s.strict);

  // 读取设置（用于 StatusBar / Editor / Terminal 等）
  const settings = useSettings((s) => s.settings);

  const [tab, setTab] = useState<PanelTab>("terminal");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState<{
    open: boolean;
    ctx: ConfirmCloseCtx;
  }>({ open: false, ctx: { kind: "single", name: "" } });
  const closeResolverRef = useRef<((r: ConfirmCloseDecision) => void) | null>(null);

  // 关闭确认弹窗：由 useTabs 在 dirty tab 关闭时调用，返回用户决策
  const onConfirmClose = useCallback((ctx: ConfirmCloseCtx) => {
    setCloseConfirm({ open: true, ctx });
    return new Promise<ConfirmCloseDecision>((resolve) => {
      closeResolverRef.current = resolve;
    });
  }, []);

  const handleCloseConfirmResult = useCallback((r: ConfirmCloseDecision) => {
    closeResolverRef.current?.(r);
    closeResolverRef.current = null;
    setCloseConfirm((s) => ({ ...s, open: false }));
  }, []);
  // 输出面板折叠状态（由 collapse()/expand() 触发，由 onCollapse/onExpand 同步）
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  // 光标位置（用于 StatusBar 显示 Ln/Col）
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorColumn, setCursorColumn] = useState(1);

  // 右侧面板 imperative ref（用于折叠/展开）
  const rightPanelRef = useRef<ImperativePanelHandle>(null);

  // 持有最新 panelCollapsed，避免菜单事件 useEffect 闭包陈旧
  const panelCollapsedRef = useRef(false);
  panelCollapsedRef.current = panelCollapsed;

  // 持有终端焦点状态，供字号缩放菜单事件分发使用
  const terminalFocusedRef = useRef(false);

  // 持有最新运行回调与当前 tab，供跨平台 keydown 监听器读取（避免陈旧闭包）
  const runHandlersRef = useRef<{
    handleRun: () => void;
    handleRunTests: () => void;
    tab: PanelTab;
  }>({ handleRun: () => {}, handleRunTests: () => {}, tab: "terminal" });

  // 布局方向 & 自动隐藏
  const layout = settings?.general.layout ?? "horizontal";
  const autoHide = settings?.general.auto_hide_panel ?? false;

  // 光标位置变化回调
  const handleCursorPositionChange = useCallback((line: number, col: number) => {
    setCursorLine(line);
    setCursorColumn(col);
  }, []);

  // 系统主题状态：仅 system 模式下使用，系统切换时触发重渲染
  const [systemTheme, setSystemTheme] = useState<EffectiveTheme>(() =>
    getEffectiveTheme(settings?.general.theme as SettingsTheme | undefined),
  );

  // 监听系统主题变化（仅 system 模式生效，但始终注册监听避免切换时漏接）
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "light" : "dark");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // settings 主题变化时同步 systemTheme（确保切换到 system 模式时立即拿到当前系统值）
  useEffect(() => {
    setSystemTheme(getEffectiveTheme(settings?.general.theme as SettingsTheme | undefined));
  }, [settings?.general.theme]);

  // 临时主题预览（来自 SettingsPanel 滑块拖动 / 新导入图片预览）
  // 优先于持久化 settings 读取，让主界面立即反映未保存的主题变化
  const themePreview = useSettings((s) => s.themePreview);

  // 计算最终生效的主题（传给 Monaco / xterm）
  // 预览激活时强制 custom（用户在 SettingsPanel 调整 custom 主题或预览新图片）
  const effectiveTheme: EffectiveTheme = themePreview
    ? "custom"
    : settings?.general.theme === "system"
      ? systemTheme
      : (settings?.general.theme as EffectiveTheme) ?? "dark";

  // 计算实际生效的 custom 主题配置（预览优先，无预览时回退持久化）
  const effectiveCustomTheme = themePreview?.customTheme ?? settings?.general.custom_theme ?? null;

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  // 持有最新 handler，避免菜单事件 useEffect 闭包陈旧
  const handlersRef = useRef({ newTab, openTabDialog, saveTab, saveTabAs, closeTab, closeAll });
  handlersRef.current = { newTab, openTabDialog, saveTab, saveTabAs, closeTab, closeAll };

  // 启动：drain pending 文件 → 传给 restore
  // - 有 pending：restore 不创建默认"未命名"tab，末尾 openTab(pending) 打开关联文件
  // - 无 pending：restore 恢复持久化 tabs 或创建默认 tab
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      let pendingPath: string | null = null;
      try {
        pendingPath = await invoke<string | null>("get_pending_open_file");
      } catch {
        // command 不存在或调用失败，忽略
      }
      if (cancelled) return;
      await restoreTabs(pendingPath);
      void loadSettings();
    };
    void init();
    return () => { cancelled = true; };
  }, [restoreTabs, loadSettings]);

  // 文件关联打开：仅监听 open-file 事件（"打开方式"热启动，已运行实例收到新文件）
  // - 冷启动 pending 由上方启动 useEffect drain 并交给 restore 处理
  // - openTab 内部 inflight 去重，重复送达不会重复打开
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    const setup = async () => {
      const ul = await listen<string>("open-file", (e) => {
        if (e.payload) void openTab(e.payload);
      });
      if (disposed) { ul(); return; }
      unlisten = ul;
    };
    void setup();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [openTab]);

  // 同步 Rust settings 的 locale 到前端 i18n store
  useEffect(() => {
    const locale = settings?.general.locale;
    if (locale === "zh" || locale === "en") {
      useI18n.getState().setLocale(locale);
    }
  }, [settings?.general.locale]);

  // Fix P1-2：注册 dispose 回调，tab 删除成功后由 useTabs 通知清理 Monaco model
  useEffect(() => {
    useTabs.getState().setOnCloseTabs((ids) => {
      for (const id of ids) {
        editorRef.current?.disposeModel(id);
      }
    });
    useTabs.getState().setOnConfirmClose(onConfirmClose);
    return () => {
      useTabs.getState().setOnCloseTabs(null);
      useTabs.getState().setOnConfirmClose(null);
    };
  }, [onConfirmClose]);

  // 更新设置并持久化（用 getState 读最新 settings，避免闭包陈旧）
  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    const current = useSettings.getState().settings;
    if (!current) return;
    const next = { ...current, ...partial };
    void useSettings.getState().save(next);
  }, []);

  // settings 变化时同步视图菜单的勾选状态
  useEffect(() => {
    if (!settings) return;
    void invoke("update_view_menu_state", {
      layout: settings.general.layout,
      autoHide: settings.general.auto_hide_panel,
    });
  }, [settings?.general.layout, settings?.general.auto_hide_panel]);

  // autoHide 切换联动：开启时折叠面板（非运行中），关闭时展开面板
  useEffect(() => {
    const ref = rightPanelRef.current;
    if (!ref) return;
    if (autoHide) {
      // 开启自动隐藏：若当前无运行任务，折叠面板
      if (useRunManager.getState().status !== "running") {
        ref.collapse();
      }
    } else {
      // 关闭自动隐藏：展开面板
      ref.expand();
    }
  }, [autoHide]);

  // 窗口标题（格式：filename — RunCode，不带 dirty 标记）
  useEffect(() => {
    const name = activeTab?.fileName ?? "";
    const title = name ? `${name} — ${t("app.windowSuffix")}` : t("app.windowSuffix");
    void getCurrentWindow().setTitle(title);
  }, [activeTab?.fileName, t]);

  // 切换 active tab 时，切换 Monaco model + 关联测试套件
  // Fix P1-3：依赖改为 [activeId]，避免每次输入触发；从 getState 读 tab 信息；防并发 + 串台校验
  useEffect(() => {
    if (!activeId) return;
    // 同步当前 tab id 到 run manager，切换展示的运行结果快照（per-tab 隔离）
    useRunManager.getState().setActiveTab(activeId);
    const tab = useTabs.getState().tabs.find((t) => t.id === activeId);
    if (!tab) return;
    editorRef.current?.switchModel(tab.id, tab.content, tab.language);

    const testSuite = useTestSuite.getState();
    if (tab.suiteId) {
      // 已关联套件
      if (testSuite.suiteId !== tab.suiteId) {
        void testSuite.setSuiteId(tab.suiteId);
      }
      return;
    }

    // 防并发：标记此 tab 正在关联，避免重复创建
    const requestId = activeId;
    if (associatingRef.current.has(requestId)) return;
    associatingRef.current.add(requestId);

    const task = tab.path
      ? testSuite.ensureSuiteForDocPath(tab.path)
      : testSuite.ensureSuiteForUntitled();

    void task.then((id) => {
      associatingRef.current.delete(requestId);
      // 串台校验：若 activeId 已变或 tab 已被关闭，丢弃结果
      const current = useTabs.getState();
      if (current.activeId !== requestId) return;
      const stillExists = current.tabs.find((t) => t.id === requestId);
      if (!stillExists) return;
      if (id) setSuiteId(requestId, id);
    });
  }, [activeId, setSuiteId]);

  // 格式化代码（三级回退：clang-format → 内置 → 原始）
  const handleFormat = useCallback(async () => {
    if (!activeTab) return;
    const code = editorRef.current?.getCode() ?? activeTab.content;
    try {
      const result = await invoke<FormatResult>("format_code", { code, style: "LLVM" });
      editorRef.current?.setValue(result.code);
      setContent(activeTab.id, result.code);
    } catch (e) {
      const err = e as AppErrorPayload;
      const tt = getT();
      const msg = err && typeof err === "object" && typeof err.code === "string"
        ? tt(`errors.${err.code}`, err.params)
        : typeof e === "string" ? e : String(e);
      alert(msg);
    }
  }, [activeTab, setContent]);

  // 持有最新 handleFormat
  const formatRef = useRef(handleFormat);
  formatRef.current = handleFormat;

  // 统一菜单 handler（macOS listen 和 Windows 前端菜单共用）
  const triggerEditorAction = useCallback((action: string) => {
    const handle = editorRef.current;
    if (!handle) return;
    handle.focus();
    handle.trigger(action);
  }, []);

  const menuHandlers: Record<string, (val?: string) => void> = useMemo(() => ({
    settings: () => setSettingsOpen(true),
    file_new: () => handlersRef.current.newTab("cpp"),
    file_open: () => void handlersRef.current.openTabDialog(),
    file_save: () => {
      const id = useTabs.getState().activeId;
      if (id) void handlersRef.current.saveTab(id);
    },
    file_save_as: () => {
      const id = useTabs.getState().activeId;
      if (id) void handlersRef.current.saveTabAs(id);
    },
    file_recent: () => setRecentOpen(true),
    file_close: () => {
      const id = useTabs.getState().activeId;
      if (id) void handlersRef.current.closeTab(id);
    },
    file_close_all: () => void handlersRef.current.closeAll(),
    edit_undo: () => triggerEditorAction("undo"),
    edit_redo: () => triggerEditorAction("redo"),
    edit_cut: () => triggerEditorAction("editor.action.clipboardCutAction"),
    edit_copy: () => triggerEditorAction("editor.action.clipboardCopyAction"),
    edit_paste: () => triggerEditorAction("editor.action.clipboardPasteAction"),
    edit_select_all: () => triggerEditorAction("editor.action.selectAll"),
    edit_format: () => void formatRef.current(),
    find: () => triggerEditorAction("actions.find"),
    find_next: () => triggerEditorAction("editor.action.nextMatchFindAction"),
    find_prev: () => triggerEditorAction("editor.action.previousMatchFindAction"),
    replace: () => triggerEditorAction("editor.action.startFindReplaceAction"),
    goto_line: () => triggerEditorAction("editor.action.gotoLine"),
    set_layout: (val) => {
      if (val) updateSettings({ general: { ...useSettings.getState().settings!.general, layout: val } });
    },
    toggle_auto_hide: () => {
      const cur = useSettings.getState().settings!.general.auto_hide_panel;
      updateSettings({ general: { ...useSettings.getState().settings!.general, auto_hide_panel: !cur } });
    },
    font_inc: () => {
      const s = useSettings.getState().settings!;
      if (terminalFocusedRef.current) {
        const cur = s.editor.terminal_font_size ?? FONT_SIZE_DEFAULT;
        const next = Math.min(FONT_SIZE_MAX, cur + FONT_SIZE_STEP);
        updateSettings({ editor: { ...s.editor, terminal_font_size: next } });
      } else {
        const cur = s.editor.font_size ?? FONT_SIZE_DEFAULT;
        const next = Math.min(FONT_SIZE_MAX, cur + FONT_SIZE_STEP);
        updateSettings({ editor: { ...s.editor, font_size: next } });
      }
    },
    font_dec: () => {
      const s = useSettings.getState().settings!;
      if (terminalFocusedRef.current) {
        const cur = s.editor.terminal_font_size ?? FONT_SIZE_DEFAULT;
        const next = Math.max(FONT_SIZE_MIN, cur - FONT_SIZE_STEP);
        updateSettings({ editor: { ...s.editor, terminal_font_size: next } });
      } else {
        const cur = s.editor.font_size ?? FONT_SIZE_DEFAULT;
        const next = Math.max(FONT_SIZE_MIN, cur - FONT_SIZE_STEP);
        updateSettings({ editor: { ...s.editor, font_size: next } });
      }
    },
    font_reset: () => {
      const s = useSettings.getState().settings!;
      if (terminalFocusedRef.current) {
        updateSettings({ editor: { ...s.editor, terminal_font_size: FONT_SIZE_DEFAULT } });
      } else {
        updateSettings({ editor: { ...s.editor, font_size: FONT_SIZE_DEFAULT } });
      }
    },
    toggle_panel: () => {
      const ref = rightPanelRef.current;
      if (!ref) return;
      if (panelCollapsedRef.current) ref.expand();
      else ref.collapse();
    },
    toggle_devtools: () => {
      void invoke("toggle_devtools");
    },
    about: () => {
      void getVersion().then((version) => {
        const msg = `RunCode\n${t("about.version")}: ${version}\n${t("about.author")}: YuanMing\n${t("about.license")}: MIT License\n${t("about.copyright")}: \u00A9 2026 YuanMing\n${t("about.website")}: https://github.com/YuanMing/RunCode`;
        void message(msg, { title: t("menu.about"), kind: "info" });
      });
    },
    help: () => setCheatsheetOpen(true),
  }), [t, updateSettings, triggerEditorAction]);

  const menuHandlersRef = useRef(menuHandlers);
  menuHandlersRef.current = menuHandlers;

  // 平台检测（仅 Windows 渲染前端标题栏）
  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  // 应用主题到根元素
  // 预览存在时强制用 "custom"（即使持久化 settings 还没切到 custom）
  useEffect(() => {
    const theme = themePreview
      ? "custom"
      : settings?.general.theme ?? "dark";
    document.documentElement.setAttribute("data-theme", theme);
  }, [settings?.general.theme, themePreview]);

  // 动态注入 custom 主题 CSS 变量 + 同步 data-base-mode
  // - effectiveCustomTheme 存在：注入 <style id="custom-theme-vars">
  // - 否则：移除 <style>，清除 data-base-mode
  // 用 JSON.stringify(effectiveCustomTheme) 作为依赖键，避免对象引用变化导致无限循环
  const customThemeKey = effectiveCustomTheme
    ? JSON.stringify(effectiveCustomTheme) + "|" + (themePreview?.imageUrl ?? "")
    : "";

  // 图片背景 URL：
  // - 预览阶段：直接用 themePreview.imageUrl（blob: URL，新导入未保存的图片）
  // - 持久化阶段：后端 get_custom_theme_image_path → convertFileSrc 转 asset:// URL
  const [persistedBgImageUrl, setPersistedBgImageUrl] = useState<string | null>(null);
  useEffect(() => {
    const custom = settings?.general.custom_theme;
    if (settings?.general.theme === "custom" && custom) {
      void invoke<string>("get_custom_theme_image_path", {
        imageFile: custom.image_file,
      })
        .then((path) => setPersistedBgImageUrl(convertFileSrc(path)))
        .catch(() => setPersistedBgImageUrl(null));
    } else {
      setPersistedBgImageUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.general.theme, settings?.general.custom_theme?.image_file]);

  // 实际生效的背景图 URL（预览 blob URL 优先）
  const bgImageUrl = themePreview?.imageUrl ?? persistedBgImageUrl;
  // 视频壁纸：走 <video> 元素层，CSS --bg-image 置 none 避免重叠
  const isVideoBg = bgImageUrl ? isVideoFile(effectiveCustomTheme?.image_file ?? "") : false;
  const cssBgImageUrl = isVideoBg ? null : bgImageUrl;

  useEffect(() => {
    const custom = effectiveCustomTheme;
    const styleId = "custom-theme-vars";
    const existing = document.getElementById(styleId);

    if (custom) {
      // 复用纯函数 buildCustomThemeCssText，避免运行时与单元测试脱钩
      const cssText = buildCustomThemeCssText(custom, cssBgImageUrl);
      if (existing) {
        existing.textContent = cssText;
      } else {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = cssText;
        document.head.appendChild(style);
      }
      // 同步 data-base-mode（global.css 中 :root[data-theme="custom"][data-base-mode="light"] 依赖此属性）
      document.documentElement.setAttribute("data-base-mode", custom.base_mode);
    } else {
      // 切回预设或 custom_theme 缺失：移除动态 style + 清除 data-base-mode
      if (existing) existing.remove();
      document.documentElement.removeAttribute("data-base-mode");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.general.theme, customThemeKey, bgImageUrl]);

  // 视频壁纸 ref + 窗口失焦/聚焦暂停恢复（省电）
  const videoBgRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoBgRef.current;
    if (!video || !isVideoBg) return;
    const handleBlur = () => video.pause();
    const handleFocus = () => video.play().catch(() => {});
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, [bgImageUrl, isVideoBg]);

  // 监听菜单事件（macOS 原生菜单触发；Windows 无原生菜单不触发）
  useEffect(() => {
    const unlistens: UnlistenFn[] = [];
    let disposed = false;
    const setup = async () => {
      // 事件名 → handler key 映射
      const eventMap: Record<string, string> = {
        "menu-settings": "settings",
        "menu-file-new": "file_new",
        "menu-file-open": "file_open",
        "menu-file-save": "file_save",
        "menu-file-save-as": "file_save_as",
        "menu-file-recent": "file_recent",
        "menu-file-close": "file_close",
        "menu-file-close-all": "file_close_all",
        "menu-edit-format": "edit_format",
        "menu-find": "find",
        "menu-find-next": "find_next",
        "menu-find-prev": "find_prev",
        "menu-replace": "replace",
        "menu-goto-line": "goto_line",
        "menu-toggle-auto-hide": "toggle_auto_hide",
        "menu-toggle-devtools": "toggle_devtools",
        "menu-font-inc": "font_inc",
        "menu-font-dec": "font_dec",
        "menu-font-reset": "font_reset",
        "menu-toggle-panel": "toggle_panel",
        "menu-help": "help",
      };

      for (const [event, key] of Object.entries(eventMap)) {
        const unlisten = await listen(event, () => menuHandlersRef.current[key]());
        if (disposed) { unlisten(); return; }
        unlistens.push(unlisten);
      }

      // layout 事件需要 payload（"horizontal"/"vertical"）
      const unlistenLayout = await listen<string>("menu-layout", (e) => {
        menuHandlersRef.current["set_layout"](e.payload);
      });
      if (disposed) { unlistenLayout(); return; }
      unlistens.push(unlistenLayout);
    };
    void setup();
    return () => {
      disposed = true;
      unlistens.forEach((u) => u());
    };
  }, []);

  // 窗口标题栏激活：macOS 直接显示；Windows 激活插件后显示
  useEffect(() => {
    if (isMac) {
      void invoke("activate_custom_titlebar").catch(() => {});
      void getCurrentWindow().show().catch(() => {});
      return;
    }

    // Windows：激活自定义标题栏，等 data-tauri-plugin-decoration-active 属性出现后再 show
    let disposed = false;
    let settled = false;
    let timeoutId: number | undefined;

    const revealActive = async () => {
      if (disposed || settled) return;
      settled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      try {
        await getCurrentWindow().show();
      } catch {
        // show 失败，忽略
      }
    };

    const showWindow = async () => {
      if (disposed || settled) return;
      settled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      try {
        await getCurrentWindow().show();
      } catch {
        // show 失败，忽略
      }
    };

    // 观察插件激活属性
    const observer = new MutationObserver(() => {
      if (document.querySelector("[data-tauri-plugin-decoration-active]")) {
        void revealActive();
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    // 8 秒超时兜底：仅 show 窗口，不取消插件（插件样式表超时 4s + 余量）
    timeoutId = window.setTimeout(() => {
      void showWindow();
    }, 8000);

    // 发起激活请求，失败时直接 show 窗口
    void invoke("activate_custom_titlebar").catch(() => {
      void showWindow();
    });

    return () => {
      disposed = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, []);

  // Windows 快捷键接管：WebView2 劫持键盘事件导致原生菜单 accelerator 不触发（wry#451）
  // 在 webview 内用 capture 阶段 keydown 接管，macOS 原生 accelerator 正常无需注册
  useEffect(() => {
    if (isMac) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey) return;
      const ctrl = e.ctrlKey;
      const shift = e.shiftKey;
      const alt = e.altKey;
      const key = e.key.toLowerCase();

      const match = (c: boolean, s: boolean, a: boolean, k: string) =>
        ctrl === c && shift === s && alt === a && key === k;

      // 文件菜单
      if (match(true, false, false, "n")) {
        e.preventDefault(); e.stopPropagation();
        handlersRef.current.newTab("cpp");
        return;
      }
      if (match(true, false, false, "o")) {
        e.preventDefault(); e.stopPropagation();
        void handlersRef.current.openTabDialog();
        return;
      }
      if (match(true, false, false, "s")) {
        e.preventDefault(); e.stopPropagation();
        const id = useTabs.getState().activeId;
        if (id) void handlersRef.current.saveTab(id);
        return;
      }
      if (match(true, true, false, "s")) {
        e.preventDefault(); e.stopPropagation();
        const id = useTabs.getState().activeId;
        if (id) void handlersRef.current.saveTabAs(id);
        return;
      }
      // Ctrl+W：终端焦点时放行（保留删除单词）
      if (match(true, false, false, "w") && !terminalFocusedRef.current) {
        e.preventDefault(); e.stopPropagation();
        const id = useTabs.getState().activeId;
        if (id) void handlersRef.current.closeTab(id);
        return;
      }
      if (match(true, true, false, "w")) {
        e.preventDefault(); e.stopPropagation();
        void handlersRef.current.closeAll();
        return;
      }

      // 编辑菜单：格式化
      if (match(false, true, true, "f")) {
        e.preventDefault(); e.stopPropagation();
        void formatRef.current();
        return;
      }

      // 查找菜单 → Monaco 触发
      if (match(true, false, false, "f")) {
        e.preventDefault(); e.stopPropagation();
        triggerEditorAction("actions.find");
        return;
      }
      if (match(true, true, false, "g")) {
        e.preventDefault(); e.stopPropagation();
        triggerEditorAction("editor.action.previousMatchFindAction");
        return;
      }
      if (match(true, false, true, "f")) {
        e.preventDefault(); e.stopPropagation();
        triggerEditorAction("editor.action.startFindReplaceAction");
        return;
      }
      if (match(true, false, false, "g")) {
        e.preventDefault(); e.stopPropagation();
        triggerEditorAction("editor.action.gotoLine");
        return;
      }

      // 设置
      if (match(true, false, false, ",")) {
        e.preventDefault(); e.stopPropagation();
        setSettingsOpen(true);
        return;
      }

      // 速查表
      if (match(true, true, false, "h")) {
        e.preventDefault(); e.stopPropagation();
        setCheatsheetOpen(true);
        return;
      }

      // 视图菜单：字号缩放
      if (match(true, false, false, "=")) {
        e.preventDefault(); e.stopPropagation();
        const s = useSettings.getState().settings;
        if (!s) return;
        if (terminalFocusedRef.current) {
          const cur = s.editor.terminal_font_size ?? FONT_SIZE_DEFAULT;
          const next = Math.min(FONT_SIZE_MAX, cur + FONT_SIZE_STEP);
          updateSettings({ editor: { ...s.editor, terminal_font_size: next } });
        } else {
          const cur = s.editor.font_size ?? FONT_SIZE_DEFAULT;
          const next = Math.min(FONT_SIZE_MAX, cur + FONT_SIZE_STEP);
          updateSettings({ editor: { ...s.editor, font_size: next } });
        }
        return;
      }
      if (match(true, false, false, "-")) {
        e.preventDefault(); e.stopPropagation();
        const s = useSettings.getState().settings;
        if (!s) return;
        if (terminalFocusedRef.current) {
          const cur = s.editor.terminal_font_size ?? FONT_SIZE_DEFAULT;
          const next = Math.max(FONT_SIZE_MIN, cur - FONT_SIZE_STEP);
          updateSettings({ editor: { ...s.editor, terminal_font_size: next } });
        } else {
          const cur = s.editor.font_size ?? FONT_SIZE_DEFAULT;
          const next = Math.max(FONT_SIZE_MIN, cur - FONT_SIZE_STEP);
          updateSettings({ editor: { ...s.editor, font_size: next } });
        }
        return;
      }
      if (match(true, false, false, "0")) {
        e.preventDefault(); e.stopPropagation();
        const s = useSettings.getState().settings;
        if (!s) return;
        if (terminalFocusedRef.current) {
          updateSettings({ editor: { ...s.editor, terminal_font_size: FONT_SIZE_DEFAULT } });
        } else {
          updateSettings({ editor: { ...s.editor, font_size: FONT_SIZE_DEFAULT } });
        }
        return;
      }

      // Ctrl+\：终端焦点时放行（保留 SIGQUIT）
      if (match(true, false, false, "\\") && !terminalFocusedRef.current) {
        e.preventDefault(); e.stopPropagation();
        const ref = rightPanelRef.current;
        if (!ref) return;
        if (panelCollapsedRef.current) {
          ref.expand();
        } else {
          ref.collapse();
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  // 跨平台运行快捷键：Cmd/Ctrl+Enter（终端运行）、Shift+Cmd/Ctrl+Enter（多样例运行）
  // capture 阶段接管，焦点限定在编辑器、测试面板或当前 tests 标签的右侧面板内
  useEffect(() => {
    const handleRunKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.isComposing) return;
      const action = resolveRunShortcut(e.key, e.metaKey, e.ctrlKey, e.shiftKey, e.altKey, isMac);
      if (!action) return;
      const ae = document.activeElement;
      if (!ae) return;
      const { tab: currentTab, handleRun, handleRunTests } = runHandlersRef.current;
      const inEditor = ae.closest(".editor-container");
      const inTestCases = ae.closest(".testcases-panel");
      const inRightPanel = currentTab === "tests" && ae.closest(".right-panel");
      if (!inEditor && !inTestCases && !inRightPanel) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === "terminal") {
        handleRun();
      } else {
        handleRunTests();
      }
    };
    window.addEventListener("keydown", handleRunKeyDown, true);
    return () => window.removeEventListener("keydown", handleRunKeyDown, true);
  }, [isMac]);

  // 监听 PTY 首次输入事件：重置计时起点为用户首次输入时刻
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    const setup = async () => {
      const ul = await listen<string>("pty_first_input", (e) => {
        if (e.payload === useRunManager.getState().activeRunId) {
          useRunManager.getState().markPtyFirstInput();
        }
      });
      if (disposed) { ul(); return; }
      unlisten = ul;
    };
    void setup();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  // 统一面板显示：切换 tab 并无条件展开（expand 幂等，无需 autoHide 判断）
  const revealPanel = useCallback((targetTab: PanelTab) => {
    setTab(targetTab);
    rightPanelRef.current?.expand();
  }, []);

  const handleRun = useCallback(() => {
    if (!activeTab) return;
    revealPanel("terminal");
    const current = editorRef.current?.getCode() ?? activeTab.content;
    void startInteractive(current);
  }, [activeTab, startInteractive, revealPanel]);

  const handleRunTests = useCallback(() => {
    if (!activeTab) return;
    revealPanel("tests");
    if (!suiteId) return;
    const current = editorRef.current?.getCode() ?? activeTab.content;
    // 从 useTestSuite 读取当前选中 id 列表（点击时一次性读取，避免订阅导致 useCallback 频繁失效）
    const selectedIds = useTestSuite.getState().getSelectedIds();
    void runTests(current, suiteId, strict, selectedIds);
  }, [activeTab, suiteId, runTests, strict, revealPanel]);

  // 同步最新运行回调与 tab 到 ref，供 keydown 监听器读取
  runHandlersRef.current = { handleRun, handleRunTests, tab };

  const handlePtyExit = useCallback(
    (exitCode: number | null, killedBy: string | null, maxRssKb: number | null) => {
      onPtyExit({ exitCode, killedBy }, maxRssKb);
    },
    [onPtyExit],
  );

  // 编译错误变化时：解析 stderr → Editor 高亮 + 跳转；清空时移除高亮
  useEffect(() => {
    if (compileError) {
      const errors = parseGccErrors(compileError);
      if (errors.length > 0) {
        editorRef.current?.setCompileErrors(errors);
      }
    } else {
      editorRef.current?.clearCompileErrors();
    }
  }, [compileError]);

  const handleCloseTab = useCallback(
    (id: string) => {
      // Fix P1-2：dispose 由 closeTab 内部回调触发，避免取消关闭后 model 已销毁
      void closeTab(id);
    },
    [closeTab],
  );

  const handleOpenRecentPath = useCallback(
    (path: string) => {
      void openTab(path);
    },
    [openTab],
  );

  return (
    <div className="app-layout">
      {isVideoBg &&
        bgImageUrl &&
        // Portal 到 body：脱离 #root 层叠上下文（z-index 2147483001），避免视频遮挡
        // tauri-plugin-decoration 的窗口控制按钮（z-index 2147483000，Windows 平台）
        createPortal(
          <video
            ref={videoBgRef}
            src={bgImageUrl}
            autoPlay
            loop
            muted
            playsInline
            className="video-bg-layer"
          />,
          document.body,
        )}
      {!isMac && (
        <TitleBar
          menuHandlers={menuHandlers}
          layout={layout}
          autoHide={autoHide}
        />
      )}
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onSwitch={switchTab}
        onClose={handleCloseTab}
        onNew={() => newTab("cpp")}
      />

      <PanelGroup
        direction={layout === "vertical" ? "vertical" : "horizontal"}
        className="app-panels"
      >
        <Panel defaultSize={50} minSize={20} className="editor-container">
          <EditorPane
            ref={editorRef}
            onContentChange={(tabId, content) => {
              setContent(tabId, content);
              // 用户编辑代码时清除编译错误高亮
              if (useRunManager.getState().compileError) {
                useRunManager.setState({ compileError: null });
              }
            }}
            onCursorPositionChange={handleCursorPositionChange}
            settings={settings?.editor}
            theme={effectiveTheme}
            customColors={effectiveCustomTheme?.colors}
            baseMode={
              effectiveCustomTheme
                ? (effectiveCustomTheme.base_mode as "light" | "dark")
                : undefined
            }
            syntaxOverrides={effectiveCustomTheme?.syntax_overrides}
            onFormat={formatRef.current}
          />
        </Panel>
        <PanelResizeHandle
          className={
            "panel-resize-handle" + (panelCollapsed ? " collapsed" : "")
          }
          hitAreaMargins={{ coarse: 20, fine: 10 }}
        />
        <Panel
          ref={rightPanelRef}
          defaultSize={50}
          minSize={20}
          collapsible
          collapsedSize={0}
          onCollapse={() => setPanelCollapsed(true)}
          onExpand={() => setPanelCollapsed(false)}
          className="right-panel"
        >
          <div className="panel-tabs">
            <button
              className={"panel-tab" + (tab === "terminal" ? " active" : "")}
              onClick={() => setTab("terminal")}
            >
              {t("panel.terminal")}
            </button>
            <button
              className={"panel-tab" + (tab === "tests" ? " active" : "")}
              onClick={() => setTab("tests")}
            >
              {t("panel.tests")}
            </button>
            {activeTab?.language === "cpp" && (
              <button
                className={"panel-tab" + (tab === "flowchart" ? " active" : "")}
                onClick={() => setTab("flowchart")}
              >
                {t("panel.flowchart")}
              </button>
            )}
            <button
              className="panel-close"
              title={t("panel.close")}
              aria-label={t("panel.close")}
              onClick={() => {
                // 方案 A：面板关闭按钮联动 auto_hide_panel 设置
                // - 设置 auto_hide_panel=true 触发菜单对号同步（useEffect 监听 settings 变化）
                // - 同时调用 collapse()，覆盖 autoHide 之前已为 true 的情况（updateSettings 不会触发 useEffect）
                const cur = useSettings.getState().settings;
                if (!cur) return;
                updateSettings({ general: { ...cur.general, auto_hide_panel: true } });
                rightPanelRef.current?.collapse();
              }}
            >
              <X size={14} />
            </button>
          </div>
          <div className="panel-body">
            <section style={{ display: tab === "tests" ? undefined : "none" }}>
              <TestCasesPanel onRunTests={handleRunTests} />
            </section>
            <section style={{ display: tab === "terminal" ? undefined : "none" }}>
              <Terminal
                runId={ptyRunId}
                onExit={handlePtyExit}
                fontSize={settings?.editor.terminal_font_size}
                theme={effectiveTheme}
                customColors={effectiveCustomTheme?.colors}
                panelAlpha={
                  effectiveCustomTheme
                    ? effectiveCustomTheme.panel_alpha / 100
                    : undefined
                }
                baseMode={
                  effectiveCustomTheme
                    ? (effectiveCustomTheme.base_mode as "light" | "dark")
                    : undefined
                }
                compileError={compileError}
                onFocusChange={(focused) => { terminalFocusedRef.current = focused; }}
                visible={tab === "terminal"}
              />
            </section>
            <section style={{ display: tab === "flowchart" ? undefined : "none" }}>
              <FlowchartPanel
                code={activeTab?.content ?? ""}
                onNodeClick={(line) => editorRef.current?.revealLine(line)}
                visible={tab === "flowchart"}
                theme={effectiveTheme}
                baseMode={
                  effectiveCustomTheme
                    ? (effectiveCustomTheme.base_mode as "light" | "dark")
                    : undefined
                }
              />
            </section>
          </div>
        </Panel>
      </PanelGroup>

      <StatusBar
        onRun={handleRun}
        onFormat={handleFormat}
        cursorLine={cursorLine}
        cursorColumn={cursorColumn}
      />

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <RecentFilesDialog
        open={recentOpen}
        onClose={() => setRecentOpen(false)}
        onOpenPath={handleOpenRecentPath}
      />
      <CheatsheetDialog open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
      <ConfirmCloseDialog
        open={closeConfirm.open}
        mode={closeConfirm.ctx.kind}
        fileName={closeConfirm.ctx.kind === "single" ? closeConfirm.ctx.name : undefined}
        count={closeConfirm.ctx.kind === "all" ? closeConfirm.ctx.count : undefined}
        onResult={handleCloseConfirmResult}
      />
      {pendingRecovery && pendingRecovery.length > 0 && (
        <RecoveryDialog
          tabs={pendingRecovery}
          onApply={handleApplyRecovery}
          onDismiss={dismissRecovery}
        />
      )}
    </div>
  );
}

export default App;
