import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// NLS 适配模块绝对路径：替换 monaco-editor/esm/vs/nls.js
const NLS_ADAPTER_PATH = path.resolve(__dirname, "./src/monaco/nls.ts");

// 判断相对 import 是否解析到 monaco-editor/esm/vs/nls.js
// 只作用于 monaco-editor/esm/vs 内部，不误伤项目或其他依赖
function isMonacoNls(source: string, importer: string | undefined): boolean {
  if (!source.endsWith("nls.js") || !source.startsWith(".") || !importer) {
    return false;
  }
  // 去除 file:// 前缀（Vite 某些场景使用 URL 格式）
  let imp = importer;
  if (imp.startsWith("file://")) imp = imp.slice(7);
  // 统一路径分隔符为 /，跨平台比较
  const normImp = imp.replace(/\\/g, "/");
  if (!normImp.includes("monaco-editor/esm/vs/")) return false;
  // 解析相对路径并检查是否指向 vs/nls.js
  const resolved = path.resolve(path.dirname(imp), source).replace(/\\/g, "/");
  return resolved.endsWith("monaco-editor/esm/vs/nls.js");
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    // Vite/Rollup 构建：将 monaco-editor 内部 vs/nls.js 重定向到 NLS 适配模块
    {
      name: "monaco-nls-redirect",
      enforce: "pre",
      resolveId(source, importer) {
        if (importer && isMonacoNls(source, importer)) {
          return NLS_ADAPTER_PATH;
        }
        return null;
      },
    },
  ],

  // 路径别名：@/* → src/*
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Monaco worker 用 ES module 格式
  worker: {
    format: "es",
  },

  // 预构建 monaco-editor 避免 worker 加载问题
  // esbuild 插件确保预构建时也使用 NLS 适配模块（dev 与 prod 一致）
  optimizeDeps: {
    include: ["monaco-editor"],
    esbuildOptions: {
      plugins: [
        {
          name: "monaco-nls-redirect",
          setup(build) {
            build.onResolve({ filter: /nls\.js$/ }, (args) => {
              if (isMonacoNls(args.path, args.importer)) {
                return { path: NLS_ADAPTER_PATH };
              }
              return null;
            });
          },
        },
      ],
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
