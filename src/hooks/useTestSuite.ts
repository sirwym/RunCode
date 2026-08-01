import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { CasePreview, ImportResult, TestSuiteManifest } from "../types";

interface TestSuiteState {
  suiteId: string | null;
  manifest: TestSuiteManifest | null;
  previews: CasePreview[];
  loading: boolean;

  // 选中状态：按 suiteId 缓存被取消选中的 case id 集合（per-tab 隔离）
  // 选中 = previews.filter(p => !deselectedIds.has(p.id))
  // 新增/导入的用例天然不在 deselectedIds 中 → 自动选中
  deselectedBySuite: Record<string, string[]>;
  // 当前 suite 的取消选中集合（派生自 deselectedBySuite[suiteId]）
  deselectedIds: string[];

  // 按 doc_path 查找或创建套件（已保存文件）
  ensureSuiteForDocPath: (docPath: string) => Promise<string | null>;
  // 为未保存文件创建临时套件
  ensureSuiteForUntitled: () => Promise<string | null>;
  // 切换到指定套件（tab 切换时）
  setSuiteId: (id: string) => Promise<void>;
  // 创建新套件
  createSuite: (docPath?: string) => Promise<void>;
  // 添加用例
  addCase: (name: string, input: string, expected: string, strict: boolean) => Promise<void>;
  // 更新用例（inline 小样例编辑）
  updateCase: (id: string, patch: { name?: string; input?: string; expected?: string; strict?: boolean }) => Promise<void>;
  // 删除用例
  removeCase: (id: string) => Promise<void>;
  // 批量导入（source 为文件夹或 ZIP 路径）
  importCases: (source: string, strict: boolean) => Promise<ImportResult>;
  // 重新加载 previews
  refresh: () => Promise<void>;
  // 只刷新单个用例的 preview（编辑后用，避免全量重载引起竞态）
  refreshCase: (caseId: string) => Promise<void>;
  // 获取用例完整期望输出（用于 diff Modal 按需加载）
  getFullExpected: (caseId: string) => Promise<string>;

  // 选中操作
  toggleCaseSelection: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  getSelectedIds: () => string[];
  isAllSelected: () => boolean;
}

async function loadSuite(id: string): Promise<{ manifest: TestSuiteManifest; previews: CasePreview[] }> {
  const manifest = await invoke<TestSuiteManifest>("load_test_suite", { suiteId: id });
  const previews = await invoke<CasePreview[]>("get_all_case_previews", { suiteId: id });
  return { manifest, previews };
}

export const useTestSuite = create<TestSuiteState>((set, get) => ({
  suiteId: null,
  manifest: null,
  previews: [],
  loading: false,
  deselectedBySuite: {},
  deselectedIds: [],

  ensureSuiteForDocPath: async (docPath) => {
    try {
      const id = await invoke<string>("find_or_create_suite_by_doc_path", { docPath });
      const { manifest, previews } = await loadSuite(id);
      set({
        suiteId: id,
        manifest,
        previews,
        deselectedIds: get().deselectedBySuite[id] ?? [],
      });
      return id;
    } catch (e) {
      console.error("ensureSuiteForDocPath failed:", e);
      return null;
    }
  },

  ensureSuiteForUntitled: async () => {
    try {
      const id = await invoke<string>("create_test_suite", { docPath: null });
      const { manifest, previews } = await loadSuite(id);
      set({
        suiteId: id,
        manifest,
        previews,
        deselectedIds: get().deselectedBySuite[id] ?? [],
      });
      return id;
    } catch (e) {
      console.error("ensureSuiteForUntitled failed:", e);
      return null;
    }
  },

  setSuiteId: async (id) => {
    set({ loading: true });
    try {
      const { manifest, previews } = await loadSuite(id);
      set({
        suiteId: id,
        manifest,
        previews,
        deselectedIds: get().deselectedBySuite[id] ?? [],
      });
    } catch (e) {
      console.error("setSuiteId failed:", e);
    } finally {
      set({ loading: false });
    }
  },

  createSuite: async (docPath) => {
    const id = await invoke<string>("create_test_suite", { docPath: docPath ?? null });
    const { manifest, previews } = await loadSuite(id);
    set({
      suiteId: id,
      manifest,
      previews,
      deselectedIds: get().deselectedBySuite[id] ?? [],
    });
  },

  addCase: async (name, input, expected, strict) => {
    const { suiteId } = get();
    if (!suiteId) return;
    await invoke("add_test_case", { suiteId, name, input, expected, strict });
    await get().refresh();
  },

  updateCase: async (id, patch) => {
    const { suiteId } = get();
    if (!suiteId) return;
    await invoke("update_test_case", {
      suiteId,
      caseId: id,
      name: patch.name ?? null,
      input: patch.input ?? null,
      expected: patch.expected ?? null,
      strict: patch.strict ?? null,
    });
    // 单卡刷新：避免全量 refresh 引发多请求乱序覆盖
    await get().refreshCase(id);
  },

  removeCase: async (id) => {
    const { suiteId } = get();
    if (!suiteId) return;
    await invoke("remove_test_case", { suiteId, caseId: id });
    await get().refresh();
  },

  importCases: async (source, strict) => {
    const { suiteId } = get();
    if (!suiteId) throw new Error("套件未初始化");
    const result = await invoke<ImportResult>("import_test_cases", {
      suiteId,
      source,
      strict,
    });
    await get().refresh();
    return result;
  },

  refresh: async () => {
    const { suiteId } = get();
    if (!suiteId) return;
    try {
      const { manifest, previews } = await loadSuite(suiteId);
      set({ manifest, previews });
    } catch {
      // 忽略
    }
  },

  refreshCase: async (caseId) => {
    const { suiteId } = get();
    if (!suiteId) return;
    try {
      const preview = await invoke<CasePreview>("get_case_preview", { suiteId, caseId });
      set((state) => ({
        previews: state.previews.map((p) => (p.id === caseId ? preview : p)),
      }));
    } catch {
      // 忽略：编辑后刷新失败不阻塞用户继续编辑
    }
  },

  getFullExpected: async (caseId) => {
    const { suiteId } = get();
    if (!suiteId) throw new Error("套件未初始化");
    return await invoke<string>("get_case_full_expected", { suiteId, caseId });
  },

  toggleCaseSelection: (id) => {
    const { deselectedIds, suiteId } = get();
    if (!suiteId) return;
    const s = new Set(deselectedIds);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    const next = Array.from(s);
    set((state) => ({
      deselectedIds: next,
      deselectedBySuite: { ...state.deselectedBySuite, [suiteId]: next },
    }));
  },

  selectAll: () => {
    const { suiteId } = get();
    if (!suiteId) return;
    set((state) => ({
      deselectedIds: [],
      deselectedBySuite: { ...state.deselectedBySuite, [suiteId]: [] },
    }));
  },

  deselectAll: () => {
    const { suiteId, previews } = get();
    if (!suiteId) return;
    const next = previews.map((p) => p.id);
    set((state) => ({
      deselectedIds: next,
      deselectedBySuite: { ...state.deselectedBySuite, [suiteId]: next },
    }));
  },

  getSelectedIds: () => {
    const { previews, deselectedIds } = get();
    const s = new Set(deselectedIds);
    return previews.filter((p) => !s.has(p.id)).map((p) => p.id);
  },

  isAllSelected: () => get().deselectedIds.length === 0,
}));
