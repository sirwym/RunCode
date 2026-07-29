import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, CustomThemeConfig } from "../types";

/**
 * 临时主题预览状态。
 *
 * 用于 SettingsPanel 拖动滑块 / 新导入图片预览时，让主界面立即反映未保存的主题变化。
 *
 * - 仅在设置面板打开且用户正在调整 custom 主题时存在；
 * - 滑动时不得调用 save_settings；
 * - 取消 / 关闭 / Escape 时清除，主界面回退到持久化 settings；
 * - 保存成功后由新持久化配置接管，再清除预览（不闪回旧主题）；
 * - 保存失败时保留预览（让用户可继续调整）。
 *
 * `imageUrl` 用于新导入图片的 blob 预览：持久化图片走后端 get_custom_theme_image_path，
 * 预览图片用 blob URL；当 imageUrl 非空时 App 优先用它作为背景图。
 */
export interface ThemePreviewState {
  /** 临时 custom 主题配置（含滑块值、颜色、base_mode、image_file） */
  customTheme: CustomThemeConfig;
  /** 临时背景图 URL（blob: 或 asset:）；为空表示仍用持久化 image_file 解析 */
  imageUrl?: string;
}

interface SettingsState {
  settings: AppSettings | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  /** 临时主题预览（仅渲染用，不影响持久化 settings） */
  themePreview: ThemePreviewState | null;

  load: () => Promise<void>;
  save: (settings: AppSettings) => Promise<void>;
  update: (partial: Partial<AppSettings>) => void;
  setThemePreview: (preview: ThemePreviewState | null) => void;
  clearThemePreview: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  loading: false,
  saving: false,
  error: null,
  themePreview: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await invoke<AppSettings>("get_settings");
      set({ settings, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: typeof e === "string" ? e : String(e),
      });
    }
  },

  save: async (settings) => {
    set({ saving: true, error: null });
    try {
      await invoke("save_settings", { settings });
      set({ settings, saving: false });
    } catch (e) {
      set({
        saving: false,
        error: typeof e === "string" ? e : String(e),
      });
      throw e;
    }
  },

  update: (partial) => {
    const current = get().settings;
    if (!current) return;
    set({ settings: { ...current, ...partial } });
  },

  setThemePreview: (preview) => set({ themePreview: preview }),
  clearThemePreview: () => set({ themePreview: null }),
}));
