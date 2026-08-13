import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useTabs, AUTOSAVE_PREFIX, AUTOSAVE_MAX_BYTES, saveAutosave, loadAllAutosaves } from "./useTabs";

// Mock @tauri-apps/api/core 的 invoke
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Mock @tauri-apps/plugin-dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

// Mock useI18n：getT 返回简单 t 函数，useI18n.getState().t 同理
vi.mock("./useI18n", () => ({
  getT: () => (key: string) => key,
  useI18n: {
    getState: () => ({
      t: (key: string) => key,
      locale: "zh",
      setLocale: vi.fn(),
    }),
    subscribe: vi.fn(),
  },
}));

// Mock useSettings：返回带 compiler.template 的 settings
vi.mock("./useSettings", () => ({
  useSettings: {
    getState: () => ({
      settings: {
        compiler: { template: "// template\n" },
      },
    }),
    subscribe: vi.fn(),
  },
}));

// Mock useRunManager：clearTab 为空函数
vi.mock("./useRunManager", () => ({
  useRunManager: {
    getState: () => ({
      clearTab: vi.fn(),
    }),
    subscribe: vi.fn(),
  },
}));

function resetStore() {
  useTabs.setState({
    tabs: [],
    activeId: null,
    pendingRecovery: null,
  });
}

describe("useTabs autosave 防抖快照（功能2a）", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
    invokeMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("setContent 后 500ms localStorage 出现 autosave 条目", () => {
    const id = useTabs.getState().newTab("cpp");
    useTabs.getState().setContent(id, "new content");

    // 未到 500ms：无 autosave
    vi.advanceTimersByTime(499);
    expect(localStorage.getItem(AUTOSAVE_PREFIX + id)).toBeNull();

    // 到 500ms：出现 autosave
    vi.advanceTimersByTime(1);
    const raw = localStorage.getItem(AUTOSAVE_PREFIX + id);
    expect(raw).not.toBeNull();
    const entry = JSON.parse(raw!);
    expect(entry.content).toBe("new content");
  });

  it("setContent 后立即（未到 500ms）localStorage 无 autosave", () => {
    const id = useTabs.getState().newTab("cpp");
    useTabs.getState().setContent(id, "new content");

    expect(localStorage.getItem(AUTOSAVE_PREFIX + id)).toBeNull();
  });

  it("连续 setContent 在 500ms 内只触发一次 autosave（防抖验证）", () => {
    const id = useTabs.getState().newTab("cpp");
    useTabs.getState().setContent(id, "v1");
    vi.advanceTimersByTime(300);
    useTabs.getState().setContent(id, "v2");
    // 第二次 timer 在 300ms 时设置，需推进完整 500ms 才触发
    vi.advanceTimersByTime(500);

    const raw = localStorage.getItem(AUTOSAVE_PREFIX + id);
    expect(raw).not.toBeNull();
    const entry = JSON.parse(raw!);
    // 最终保存的是 v2（防抖后最后一次 setContent 的内容）
    expect(entry.content).toBe("v2");
  });

  it("saveTab 成功后 autosave 被清理", async () => {
    const id = useTabs.getState().newTab("cpp");
    // 模拟有 path 的 tab（saveTab 需要 path）
    useTabs.setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, path: "/test/main.cpp", savedContent: "// template\n" } : t,
      ),
    }));
    useTabs.getState().setContent(id, "dirty content");
    vi.advanceTimersByTime(500);
    expect(localStorage.getItem(AUTOSAVE_PREFIX + id)).not.toBeNull();

    // saveTab 成功
    invokeMock.mockResolvedValueOnce(undefined);
    invokeMock.mockResolvedValueOnce(undefined); // add_recent_file
    await useTabs.getState().saveTab(id);

    expect(localStorage.getItem(AUTOSAVE_PREFIX + id)).toBeNull();
  });

  it("closeTab 后 autosave 被清理", async () => {
    const id = useTabs.getState().newTab("cpp");
    // tab 不 dirty，closeTab 不会弹确认框
    useTabs.getState().setContent(id, useTabs.getState().tabs[0].savedContent);
    // 手动写入 autosave 模拟之前编辑过
    saveAutosave(id, {
      content: "old content",
      timestamp: Date.now(),
      fileName: "test",
      language: "cpp",
      path: null,
    });
    expect(localStorage.getItem(AUTOSAVE_PREFIX + id)).not.toBeNull();

    await useTabs.getState().closeTab(id);

    expect(localStorage.getItem(AUTOSAVE_PREFIX + id)).toBeNull();
  });

  it("超过 1MB 的 content 不触发 autosave", () => {
    const id = useTabs.getState().newTab("cpp");
    const huge = "x".repeat(AUTOSAVE_MAX_BYTES + 1);
    useTabs.getState().setContent(id, huge);
    vi.advanceTimersByTime(500);

    expect(localStorage.getItem(AUTOSAVE_PREFIX + id)).toBeNull();
  });
});

describe("loadAllAutosaves（功能2a 辅助函数）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loadAllAutosaves 正确读取所有 autosave 条目", () => {
    saveAutosave("tab-1", {
      content: "content-1",
      timestamp: 1000,
      fileName: "f1",
      language: "cpp",
      path: null,
    });
    saveAutosave("tab-2", {
      content: "content-2",
      timestamp: 2000,
      fileName: "f2",
      language: "cpp",
      path: "/path/f2",
    });

    const all = loadAllAutosaves();
    expect(all).toHaveLength(2);
    const tab1 = all.find((a) => a.tabId === "tab-1");
    const tab2 = all.find((a) => a.tabId === "tab-2");
    expect(tab1?.entry.content).toBe("content-1");
    expect(tab2?.entry.content).toBe("content-2");
    expect(tab2?.entry.path).toBe("/path/f2");
  });
});

describe("useTabs 启动恢复检测（功能2b）", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
    invokeMock.mockReset();
    vi.useRealTimers();
  });

  it("restore 检测到 autosave 与文件内容不同时设置 pendingRecovery", async () => {
    // 预置持久化 tab 元数据
    const tabId = "recovery-tab-1";
    localStorage.setItem("runcode:tabs", JSON.stringify([
      { id: tabId, path: null, fileName: "未命名.cpp", language: "cpp", suiteId: null },
    ]));
    localStorage.setItem("runcode:activeTabId", tabId);
    // 预置 autosave（与模板内容不同）
    saveAutosave(tabId, {
      content: "recovered content",
      timestamp: Date.now(),
      fileName: "未命名.cpp",
      language: "cpp",
      path: null,
    });

    await useTabs.getState().restore();

    const s = useTabs.getState();
    expect(s.pendingRecovery).not.toBeNull();
    expect(s.pendingRecovery).toHaveLength(1);
    expect(s.pendingRecovery![0].tabId).toBe(tabId);
    expect(s.pendingRecovery![0].autosaveContent).toBe("recovered content");
  });

  it("restore 检测到 autosave 与文件内容相同时清理 autosave", async () => {
    const tabId = "recovery-tab-2";
    const template = "// template\n";
    localStorage.setItem("runcode:tabs", JSON.stringify([
      { id: tabId, path: null, fileName: "未命名.cpp", language: "cpp", suiteId: null },
    ]));
    localStorage.setItem("runcode:activeTabId", tabId);
    // autosave 与模板内容相同
    saveAutosave(tabId, {
      content: template,
      timestamp: Date.now(),
      fileName: "未命名.cpp",
      language: "cpp",
      path: null,
    });

    await useTabs.getState().restore();

    expect(useTabs.getState().pendingRecovery).toBeNull();
    // autosave 被清理
    expect(localStorage.getItem(AUTOSAVE_PREFIX + tabId)).toBeNull();
  });

  it("restore 检测到 autosave 但 tab 已不存在时清理 autosave", async () => {
    const tabId = "recovery-tab-3";
    const orphanId = "orphan-tab";
    localStorage.setItem("runcode:tabs", JSON.stringify([
      { id: tabId, path: null, fileName: "未命名.cpp", language: "cpp", suiteId: null },
    ]));
    localStorage.setItem("runcode:activeTabId", tabId);
    // 孤儿 autosave（对应的 tab 不在持久化列表中）
    saveAutosave(orphanId, {
      content: "orphan content",
      timestamp: Date.now(),
      fileName: "orphan",
      language: "cpp",
      path: null,
    });

    await useTabs.getState().restore();

    expect(useTabs.getState().pendingRecovery).toBeNull();
    expect(localStorage.getItem(AUTOSAVE_PREFIX + orphanId)).toBeNull();
  });
});

describe("useTabs applyRecovery / dismissRecovery（功能2b）", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it("applyRecovery 恢复 content 并清理对应 autosave", () => {
    const tabId = "apply-tab-1";
    // 预置 tab 和 pendingRecovery
    useTabs.setState({
      tabs: [{
        id: tabId,
        path: null,
        fileName: "test.cpp",
        content: "original",
        savedContent: "original",
        dirty: false,
        language: "cpp",
        suiteId: null,
      }],
      activeId: tabId,
      pendingRecovery: [{
        tabId,
        fileName: "test.cpp",
        savedContent: "original",
        autosaveContent: "recovered",
        timestamp: Date.now(),
      }],
    });
    // 预置 autosave
    saveAutosave(tabId, {
      content: "recovered",
      timestamp: Date.now(),
      fileName: "test.cpp",
      language: "cpp",
      path: null,
    });

    useTabs.getState().applyRecovery([tabId]);

    const s = useTabs.getState();
    expect(s.tabs[0].content).toBe("recovered");
    expect(s.tabs[0].dirty).toBe(true);
    // autosave 被清理
    expect(localStorage.getItem(AUTOSAVE_PREFIX + tabId)).toBeNull();
  });

  it("applyRecovery 后 pendingRecovery 为 null", () => {
    const tabId = "apply-tab-2";
    useTabs.setState({
      tabs: [{
        id: tabId,
        path: null,
        fileName: "test.cpp",
        content: "original",
        savedContent: "original",
        dirty: false,
        language: "cpp",
        suiteId: null,
      }],
      activeId: tabId,
      pendingRecovery: [{
        tabId,
        fileName: "test.cpp",
        savedContent: "original",
        autosaveContent: "recovered",
        timestamp: Date.now(),
      }],
    });

    useTabs.getState().applyRecovery([tabId]);

    expect(useTabs.getState().pendingRecovery).toBeNull();
  });

  it("dismissRecovery 清理所有 pending autosave", () => {
    const tabId1 = "dismiss-tab-1";
    const tabId2 = "dismiss-tab-2";
    useTabs.setState({
      tabs: [],
      activeId: null,
      pendingRecovery: [
        { tabId: tabId1, fileName: "f1", savedContent: "a", autosaveContent: "b", timestamp: 1 },
        { tabId: tabId2, fileName: "f2", savedContent: "c", autosaveContent: "d", timestamp: 2 },
      ],
    });
    saveAutosave(tabId1, { content: "b", timestamp: 1, fileName: "f1", language: "cpp", path: null });
    saveAutosave(tabId2, { content: "d", timestamp: 2, fileName: "f2", language: "cpp", path: null });

    useTabs.getState().dismissRecovery();

    expect(localStorage.getItem(AUTOSAVE_PREFIX + tabId1)).toBeNull();
    expect(localStorage.getItem(AUTOSAVE_PREFIX + tabId2)).toBeNull();
  });

  it("dismissRecovery 后 pendingRecovery 为 null", () => {
    useTabs.setState({
      tabs: [],
      activeId: null,
      pendingRecovery: [
        { tabId: "x", fileName: "f", savedContent: "a", autosaveContent: "b", timestamp: 1 },
      ],
    });

    useTabs.getState().dismissRecovery();

    expect(useTabs.getState().pendingRecovery).toBeNull();
  });
});
