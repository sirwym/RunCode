import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getT } from "./useI18n";
import { useI18n } from "./useI18n";
import { useSettings } from "./useSettings";
import { useRunManager } from "./useRunManager";
import type { AppErrorPayload, Tab, TabLanguage } from "../types";

// 生成唯一 ID（浏览器内置 crypto.randomUUID，回退到时间戳）
function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const STORAGE_KEY = "runcode:tabs";
const ACTIVE_KEY = "runcode:activeTabId";

// ============ 崩溃恢复 autosave（功能2） ============
export const AUTOSAVE_PREFIX = "runcode:autosave:";
export const AUTOSAVE_DEBOUNCE_MS = 500;
export const AUTOSAVE_MAX_BYTES = 1024 * 1024; // 1MB 单 tab 上限

// 防抖计时器（按 tabId 分隔，模块级）
const autosaveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export interface AutosaveEntry {
  content: string;
  timestamp: number;
  fileName: string;
  language: string;
  path: string | null;
}

export interface RecoverableTab {
  tabId: string;
  fileName: string;
  savedContent: string;    // 文件/模板当前内容
  autosaveContent: string; // autosave 快照内容
  timestamp: number;
}

export function saveAutosave(tabId: string, entry: AutosaveEntry): void {
  try {
    // 超过 1MB 不保存（依赖手动保存，避免 localStorage 溢出）
    if (entry.content.length > AUTOSAVE_MAX_BYTES) return;
    localStorage.setItem(AUTOSAVE_PREFIX + tabId, JSON.stringify(entry));
  } catch {
    // localStorage 满或禁用，静默忽略
  }
}

export function clearAutosave(tabId: string): void {
  try {
    localStorage.removeItem(AUTOSAVE_PREFIX + tabId);
  } catch {
    // 忽略
  }
  if (autosaveTimers[tabId]) {
    clearTimeout(autosaveTimers[tabId]);
    delete autosaveTimers[tabId];
  }
}

export function loadAllAutosaves(): Array<{ tabId: string; entry: AutosaveEntry }> {
  const result: Array<{ tabId: string; entry: AutosaveEntry }> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(AUTOSAVE_PREFIX)) {
        try {
          const tabId = key.slice(AUTOSAVE_PREFIX.length);
          const entry = JSON.parse(localStorage.getItem(key)!) as AutosaveEntry;
          result.push({ tabId, entry });
        } catch {
          // 损坏的 autosave，删除
          localStorage.removeItem(key);
        }
      }
    }
  } catch {
    // localStorage 禁用，返回空
  }
  return result;
}

// 默认 C++ 模板：当 settings.compiler.template 缺失时回退使用
const DEFAULT_CPP_TEMPLATE = `#include <bits/stdc++.h>
using namespace std;

int main() {
    cout << "Hello, RunCode!" << endl;
    return 0;
}
`;

function alertError(e: unknown) {
  const t = getT();
  const err = e as AppErrorPayload;
  const msg =
    err && typeof err === "object" && typeof err.code === "string"
      ? t(`errors.${err.code}`, err.params)
      : typeof e === "string"
      ? e
      : String(e);
  alert(msg);
}

function basename(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || p;
}

interface PersistedTabMeta {
  id: string;
  path: string | null;
  fileName: string;
  language: TabLanguage;
  suiteId: string | null;
}

function loadPersistedTabs(): PersistedTabMeta[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PersistedTabMeta[];
  } catch {
    return [];
  }
}

function persistTabs(tabs: Tab[]) {
  try {
    const meta: PersistedTabMeta[] = tabs.map((t) => ({
      id: t.id,
      path: t.path,
      fileName: t.fileName,
      language: t.language,
      suiteId: t.suiteId,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // 忽略
  }
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function saveActiveId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // 忽略
  }
}

// dispose 回调：tab 删除成功后由 useTabs 通知外部（Editor）清理 Monaco model
let onCloseTabsCb: ((ids: string[]) => void) | null = null;

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  pendingRecovery: RecoverableTab[] | null;

  newTab: (language?: TabLanguage) => string;
  openTab: (path: string) => Promise<string | null>;
  openTabDialog: () => Promise<string | null>;
  closeTab: (id: string) => Promise<void>;
  closeAll: () => Promise<void>;
  switchTab: (id: string) => void;
  saveTab: (id: string) => Promise<boolean>;
  saveTabAs: (id: string) => Promise<boolean>;
  setContent: (id: string, content: string) => void;
  setSuiteId: (id: string, suiteId: string) => void;
  activeTab: () => Tab | null;
  restore: () => Promise<void>;
  // 设置 closeTab/closeAll 成功删除 tab 后的回调，外部用于 dispose Monaco model
  setOnCloseTabs: (cb: ((ids: string[]) => void) | null) => void;
  // 崩溃恢复（功能2）
  applyRecovery: (tabIds: string[]) => void;
  dismissRecovery: () => void;
}

export const useTabs = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,
  pendingRecovery: null,

  newTab: (language = "cpp") => {
    const id = uuid();
    // Fix P2-1：从 settings 读取代码模板，回退到默认
    const settingsState = useSettings.getState().settings;
    const template = language === "cpp"
      ? (settingsState?.compiler.template ?? DEFAULT_CPP_TEMPLATE)
      : "";
    // Fix P2-4：未命名文件名从 i18n 读取
    const i18nState = useI18n.getState();
    const fileName = language === "cpp"
      ? i18nState.t("app.untitled")
      : i18nState.t("app.untitledPython");
    const tab: Tab = {
      id,
      path: null,
      fileName,
      content: template,
      savedContent: template,
      dirty: false,
      language,
      suiteId: null,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
    persistTabs(get().tabs);
    saveActiveId(id);
    return id;
  },

  openTab: async (path) => {
    // 复用同 path 的 tab
    const existing = get().tabs.find((t) => t.path === path);
    if (existing) {
      set({ activeId: existing.id });
      saveActiveId(existing.id);
      return existing.id;
    }
    try {
      const result = await invoke<{ path: string; content: string }>("open_file", { path });
      const id = uuid();
      const tab: Tab = {
        id,
        path: result.path,
        fileName: basename(result.path),
        content: result.content,
        savedContent: result.content,
        dirty: false,
        language: "cpp",
        suiteId: null,
      };
      set((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
      persistTabs(get().tabs);
      saveActiveId(id);
      // Fix P2-2：打开文件成功后写入最近文件
      try {
        await invoke("add_recent_file", { path: result.path, name: basename(result.path) });
      } catch {
        // 最近文件写入失败不影响主流程
      }
      return id;
    } catch (e) {
      alertError(e);
      return null;
    }
  },

  openTabDialog: async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: "C++", extensions: ["cpp", "cc", "cxx", "h", "hpp"] }],
      });
      if (typeof selected !== "string") return null;
      return await get().openTab(selected);
    } catch (e) {
      alertError(e);
      return null;
    }
  },

  closeTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.dirty) {
      const t = getT();
      const confirmed = confirm(t("tabs.closeConfirmMsg", { name: tab.fileName }));
      if (!confirmed) return;
      // Fix P1-1：检查保存结果，失败或取消另存为则中止关闭
      const ok = await get().saveTab(id);
      if (!ok) return;
    }
    // Fix P1-2：tab 删除成功后才通过回调通知外部 dispose model
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const newTabs = s.tabs.filter((t) => t.id !== id);
      let newActive = s.activeId;
      if (s.activeId === id) {
        if (newTabs.length === 0) {
          newActive = null;
        } else if (idx >= newTabs.length) {
          newActive = newTabs[newTabs.length - 1].id;
        } else {
          newActive = newTabs[Math.max(0, idx)].id;
        }
      }
      return { tabs: newTabs, activeId: newActive };
    });
    persistTabs(get().tabs);
    saveActiveId(get().activeId);
    // 通知外部 dispose 已删除 tab 的 model
    onCloseTabsCb?.([id]);
    // 清理该 tab 的运行结果快照，避免内存泄漏
    useRunManager.getState().clearTab(id);
    // 清理该 tab 的 autosave（功能2a）
    clearAutosave(id);
  },

  closeAll: async () => {
    const dirtyCount = get().tabs.filter((t) => t.dirty).length;
    if (dirtyCount > 0) {
      const t = getT();
      const confirmed = confirm(t("tabs.closeAllConfirmMsg", { count: dirtyCount }));
      if (!confirmed) return;
      // Fix P1-1：任一保存失败则中止关闭所有
      for (const tab of get().tabs) {
        if (tab.dirty) {
          const ok = await get().saveTab(tab.id);
          if (!ok) return;
        }
      }
    }
    // Fix P1-2：先收集所有 tabId，删除后通知外部统一 dispose
    const closedIds = get().tabs.map((t) => t.id);
    set({ tabs: [], activeId: null });
    persistTabs([]);
    saveActiveId(null);
    onCloseTabsCb?.(closedIds);
    // 清理所有关闭 tab 的运行结果快照
    for (const id of closedIds) {
      useRunManager.getState().clearTab(id);
      clearAutosave(id);
    }
  },

  switchTab: (id) => {
    set({ activeId: id });
    saveActiveId(id);
  },

  saveTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return false;
    if (!tab.path) {
      return await get().saveTabAs(id);
    }
    try {
      await invoke("save_file", { path: tab.path, content: tab.content });
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id ? { ...t, savedContent: t.content, dirty: false } : t,
        ),
      }));
      persistTabs(get().tabs);
      // 保存成功后清理 autosave（功能2a）
      clearAutosave(id);
      // Fix P2-2：保存成功后写入最近文件
      try {
        await invoke("add_recent_file", { path: tab.path, name: tab.fileName });
      } catch {
        // 最近文件写入失败不影响主流程
      }
      return true;
    } catch (e) {
      alertError(e);
      return false;
    }
  },

  saveTabAs: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return false;
    try {
      const selected = await saveDialog({
        defaultPath: tab.fileName,
        filters: [{ name: "C++", extensions: ["cpp"] }],
      });
      if (!selected) return false; // 用户取消另存为
      await invoke("save_file", { path: selected, content: tab.content });
      const newName = basename(selected);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                path: selected,
                fileName: newName,
                savedContent: t.content,
                dirty: false,
              }
            : t,
        ),
      }));
      persistTabs(get().tabs);
      // 另存为成功后清理 autosave（功能2a）
      clearAutosave(id);
      // Fix P2-2：另存为成功后写入最近文件
      try {
        await invoke("add_recent_file", { path: selected, name: newName });
      } catch {
        // 忽略
      }
      return true;
    } catch (e) {
      alertError(e);
      return false;
    }
  },

  setContent: (id, content) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, content, dirty: content !== t.savedContent }
          : t,
      ),
    }));

    // 防抖 autosave dirty content（功能2a：仅 dirty 时保存）
    const tab = get().tabs.find((t) => t.id === id);
    if (tab && tab.dirty) {
      if (autosaveTimers[id]) clearTimeout(autosaveTimers[id]);
      autosaveTimers[id] = setTimeout(() => {
        saveAutosave(id, {
          content: tab.content,
          timestamp: Date.now(),
          fileName: tab.fileName,
          language: tab.language,
          path: tab.path,
        });
      }, AUTOSAVE_DEBOUNCE_MS);
    }
  },

  setSuiteId: (id, suiteId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, suiteId } : t)),
    }));
    persistTabs(get().tabs);
  },

  activeTab: () => {
    const { tabs, activeId } = get();
    return tabs.find((t) => t.id === activeId) ?? null;
  },

  restore: async () => {
    const persisted = loadPersistedTabs();
    if (persisted.length === 0) {
      // 首次：创建默认 tab，清理所有孤儿 autosave
      loadAllAutosaves().forEach(({ tabId }) => clearAutosave(tabId));
      get().newTab("cpp");
      return;
    }
    // Fix P2-1：从 settings 读取模板
    const settingsState = useSettings.getState().settings;
    const i18nState = useI18n.getState();
    const tabs: Tab[] = [];
    for (const meta of persisted) {
      let content = meta.language === "cpp"
        ? (settingsState?.compiler.template ?? DEFAULT_CPP_TEMPLATE)
        : "";
      let savedContent = content;
      // path 类 tab 重新读取文件内容
      if (meta.path) {
        try {
          const result = await invoke<{ path: string; content: string }>("open_file", {
            path: meta.path,
          });
          content = result.content;
          savedContent = result.content;
        } catch {
          // 文件读取失败：跳过该 tab
          continue;
        }
      }
      tabs.push({
        id: meta.id,
        path: meta.path,
        // Fix P2-4：恢复时也使用 i18n 的未命名文件名
        fileName: meta.path ? meta.fileName : i18nState.t("app.untitled"),
        content,
        savedContent,
        dirty: false,
        language: meta.language,
        suiteId: meta.suiteId,
      });
    }
    if (tabs.length === 0) {
      // 所有文件读取失败：创建默认 tab，清理所有孤儿 autosave
      loadAllAutosaves().forEach(({ tabId }) => clearAutosave(tabId));
      get().newTab("cpp");
      return;
    }
    const savedActive = loadActiveId();
    const activeId = savedActive && tabs.find((t) => t.id === savedActive)
      ? savedActive
      : tabs[0].id;

    // 检测 autosave：与当前 content 不同时加入 pendingRecovery（功能2b）
    const autosaves = loadAllAutosaves();
    const recoverable: RecoverableTab[] = [];
    for (const { tabId, entry } of autosaves) {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab && entry.content !== tab.content) {
        recoverable.push({
          tabId,
          fileName: tab.fileName,
          savedContent: tab.content,
          autosaveContent: entry.content,
          timestamp: entry.timestamp,
        });
      } else {
        // autosave 与当前内容相同，或 tab 已不存在，清理
        clearAutosave(tabId);
      }
    }

    set({ tabs, activeId, pendingRecovery: recoverable.length > 0 ? recoverable : null });
    saveActiveId(activeId);
  },

  setOnCloseTabs: (cb) => {
    onCloseTabsCb = cb;
  },

  applyRecovery: (tabIds) => {
    set((s) => {
      const tabs = s.tabs.map((t) => {
        if (tabIds.includes(t.id)) {
          const recovery = s.pendingRecovery?.find((r) => r.tabId === t.id);
          if (recovery) {
            return { ...t, content: recovery.autosaveContent, dirty: true };
          }
        }
        return t;
      });
      return { tabs, pendingRecovery: null };
    });
    // 清理已恢复的 autosave
    tabIds.forEach(clearAutosave);
  },

  dismissRecovery: () => {
    // 清理所有 pending autosave
    get().pendingRecovery?.forEach((r) => clearAutosave(r.tabId));
    set({ pendingRecovery: null });
  },
}));
