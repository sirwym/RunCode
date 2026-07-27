import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// 字体（仅 Latin 子集，减小打包体积；中文字形 fallback 系统字体）
import "./styles/fonts.css";
import "./styles/tailwind.css";
import "./styles/global.css";

// 配置 Monaco：本地打包，不走 CDN
// @monaco-editor/react 默认通过 @monaco-editor/loader 从 jsDelivr CDN 加载，
// 但 Tauri 打包后 CSP script-src 'self' 会阻止该请求，导致编辑器永远停在 Loading。
// 通过 loader.config({ monaco }) 把 monaco-editor 打入 bundle，完全离线。
// 按需导入：只加载 editor core + cpp/markdown 语言贡献，不打包其他语言和 worker。
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController.js";
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

self.MonacoEnvironment = { getWorker: () => new editorWorker() };
loader.config({ monaco });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
