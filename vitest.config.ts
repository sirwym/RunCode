import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Vitest 配置：jsdom 环境 + React 插件 + @ 路径别名
// 与 vite.config.ts 共享 alias 配置
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // monaco-editor 包入口加载所有语言/contrib，jsdom 下无法解析
      // 测试中用 mock 提供最小 colorize 实现
      "monaco-editor": path.resolve(__dirname, "./src/test/monaco-editor-mock.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
  },
});
