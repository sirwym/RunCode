import { create } from "zustand";

interface TestOptionsState {
  // 严格模式：true 时精确比较（含末尾换行）；false 时忽略末尾换行
  strict: boolean;
  toggleStrict: () => void;
}

// 测试选项：仅保留 strict 开关。
// 运行逻辑已迁入 useRunManager，本 store 只管比较模式偏好。
export const useTestOptions = create<TestOptionsState>((set) => ({
  strict: false,
  toggleStrict: () => set((s) => ({ strict: !s.strict })),
}));
