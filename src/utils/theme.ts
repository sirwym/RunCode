// 主题工具函数：根据设置主题 + 系统偏好计算实际生效主题

export type EffectiveTheme = "dark" | "light" | "custom";
export type SettingsTheme = "dark" | "light" | "system" | "custom";

/**
 * 根据设置主题 + 当前系统偏好，计算实际生效的主题
 * - "dark" → "dark"
 * - "light" → "light"
 * - "custom" → "custom"（由 custom_theme 配置提供颜色）
 * - "system" → 匹配 prefers-color-scheme
 */
export function getEffectiveTheme(
  settingsTheme: SettingsTheme | undefined,
): EffectiveTheme {
  if (settingsTheme === "light") return "light";
  if (settingsTheme === "dark") return "dark";
  if (settingsTheme === "custom") return "custom";
  // system 或 undefined
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return "dark";
}
