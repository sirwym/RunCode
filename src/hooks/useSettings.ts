import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../types";

interface SettingsState {
  settings: AppSettings | null;
  loading: boolean;
  saving: boolean;
  error: string | null;

  load: () => Promise<void>;
  save: (settings: AppSettings) => Promise<void>;
  update: (partial: Partial<AppSettings>) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  loading: false,
  saving: false,
  error: null,

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
}));
