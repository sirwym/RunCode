import { create } from "zustand";
import { zh } from "../locales/zh";
import { en } from "../locales/en";

export type Locale = "zh" | "en";

// 字典结构类型：递归把字面量拓宽为 string，使 zh/en 互相兼容
type Loose<T> = {
  [K in keyof T]: T[K] extends string ? string : Loose<T[K]>;
};
type Dict = Loose<typeof zh>;

const DICTS: Record<Locale, Dict> = { zh, en };
const STORAGE_KEY = "cppteach:locale";

function detectInitial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    // localStorage 不可用时回退
  }
  return navigator.language.startsWith("zh") ? "zh" : "en";
}

// 按点分路径取文案，找不到时返回 key 本身（便于发现遗漏）
function translate(
  dict: Dict,
  key: string,
  params?: Record<string, string | number>,
): string {
  const parts = key.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  let s = typeof cur === "string" ? cur : key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}

// 工厂：为指定 locale 生成 t 函数
function makeT(locale: Locale) {
  return (key: string, params?: Record<string, string | number>) =>
    translate(DICTS[locale], key, params);
}

interface I18nState {
  locale: Locale;
  t: (key: string, params?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

// t 引用随 locale 变化而更新，订阅 t 的组件会重渲染。
const initialLocale = detectInitial();
export const useI18n = create<I18nState>((set) => ({
  locale: initialLocale,
  t: makeT(initialLocale),
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // 忽略
    }
    set({ locale, t: makeT(locale) });
  },
}));

// 非 React 代码（如其他 zustand store）取 t 的便捷方法
export function getT() {
  return useI18n.getState().t;
}
