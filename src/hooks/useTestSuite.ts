import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { CasePreview, ImportResult, TestSuiteManifest } from "../types";

interface TestSuiteState {
  suiteId: string | null;
  manifest: TestSuiteManifest | null;
  previews: CasePreview[];
  loading: boolean;

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

  ensureSuiteForDocPath: async (docPath) => {
    try {
      const id = await invoke<string>("find_or_create_suite_by_doc_path", { docPath });
      const { manifest, previews } = await loadSuite(id);
      set({ suiteId: id, manifest, previews });
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
      set({ suiteId: id, manifest, previews });
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
      set({ suiteId: id, manifest, previews });
    } catch (e) {
      console.error("setSuiteId failed:", e);
    } finally {
      set({ loading: false });
    }
  },

  createSuite: async (docPath) => {
    const id = await invoke<string>("create_test_suite", { docPath: docPath ?? null });
    const { manifest, previews } = await loadSuite(id);
    set({ suiteId: id, manifest, previews });
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
    await get().refresh();
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
}));
