import { useEffect, useState } from "react";
import * as monaco from "monaco-editor";

/**
 * 把 C++ 代码片段通过 Monaco colorize 转成带语法高亮的 HTML 字符串。
 *
 * - 依赖 Monaco 全局单例（main.tsx 已 loader.config 注入）
 * - 复用主编辑器已 defineTheme 的 runcode-* 主题
 * - colorize 用当前全局 Monaco 主题，themeKey 变化时重新 colorize
 * - 异步竞态保护：依赖变化时丢弃旧 Promise 结果
 * - 失败回退空字符串，组件层用原 code 兜底
 *
 * @param code 待高亮的 C++ 代码
 * @param themeKey 主题标识（"dark" | "light" | "custom"），变化时触发重新 colorize
 * @returns HTML 字符串；未完成或失败时返回 ""
 */
export function useColorizedCode(code: string, themeKey: string): string {
  const [html, setHtml] = useState("");

  useEffect(() => {
    let cancelled = false;
    monaco.editor
      .colorize(code, "cpp", { tabSize: 4 })
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        // colorize 失败（极少见）：保持空字符串，组件层用原 code 兜底
        if (!cancelled) setHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [code, themeKey]);

  return html;
}
