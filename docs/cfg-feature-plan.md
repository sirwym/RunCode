# C++ 控制流图（CFG）功能实施方案

> **For agentic workers:** 本方案按任务分解，每个任务包含具体文件路径、完整代码和测试命令。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 在 RunCode 编辑器右侧面板新增「控制流图」标签页，将 C++ 函数的控制流（if/else/for/while/do-while/switch）可视化为 Mermaid 流程图，点击节点跳转对应代码行。

**架构：** Rust 后端用 tree-sitter 解析 C++ AST → 遍历生成 CFG 节点/边 → 输出 Mermaid flowchart 文本 + 节点元数据。前端用 mermaid.js 懒加载渲染 SVG，通过 `window.__cfgJump(line)` 回调实现点击跳转。

**技术栈：** Rust + tree-sitter（已有）→ Mermaid.js 11（新增，懒加载）→ React 19 + TypeScript

---

## 已完成

### Task 0: Rust CFG 构建器核心 ✅

**文件：**
- 创建：`src-tauri/src/parser/cfg.rs` ✅
- 修改：`src-tauri/src/parser/mod.rs`（添加 `pub mod cfg;` + `pub(crate) fn extract_function_name`）✅

已完成内容：
- `CfgNode` / `CfgEdge` / `CfgResult` 数据结构
- `CfgBuilder` 实现：if/else、for、while、do-while、switch、break/continue、return
- 嵌套深度限制（5 层）、80 节点阈值警告、宏控制流检测
- Mermaid flowchart 文本生成 + `click` 回调绑定
- 14 个单元测试覆盖所有控制流结构

---

## 文件结构总览

| 文件 | 操作 | 职责 |
|------|------|------|
| `src-tauri/src/commands/parser_cmd.rs` | 修改 | 添加 `generate_cfg` Tauri command |
| `src-tauri/src/commands/mod.rs` | 修改 | re-export `generate_cfg` |
| `src-tauri/src/lib.rs` | 修改 | 注册 `generate_cfg` 到 invoke_handler |
| `package.json` | 修改 | 添加 `mermaid` 依赖 |
| `src/types/index.ts` | 修改 | 添加 `CfgNode` / `CfgResult` 类型 |
| `src/components/Editor.tsx` | 修改 | EditorHandle 添加 `revealLine` 方法 |
| `src/locales/zh.ts` | 修改 | 添加 flowchart i18n key |
| `src/locales/en.ts` | 修改 | 添加 flowchart i18n key |
| `src/locales/i18n.test.ts` | 修改 | 添加 CFG key 完整性测试 |
| `src/components/FlowchartPanel.tsx` | 创建 | Mermaid 渲染 + 点击跳转组件 |
| `src/components/FlowchartPanel.test.ts` | 创建 | 组件单元测试 |
| `src/App.tsx` | 修改 | 添加 flowchart tab + 集成组件 |
| `src/styles/global.css` | 修改 | 添加 flowchart 面板样式 |

---

## Task 1: Rust 命令注册

**文件：**
- 修改：`src-tauri/src/commands/parser_cmd.rs`
- 修改：`src-tauri/src/commands/mod.rs:31`
- 修改：`src-tauri/src/lib.rs:18-27` 和 `lib.rs:78-115`

### 步骤

- [ ] **Step 1: 在 parser_cmd.rs 添加 generate_cfg 命令**

在 `src-tauri/src/commands/parser_cmd.rs` 末尾追加：

```rust
use crate::parser::cfg::{generate_cfg as generate_cfg_impl, CfgResult};

/// 生成 C++ 函数控制流图
/// 输入：C++ 源码字符串
/// 输出：CfgResult（Mermaid 文本 + 节点元数据 + 警告）
#[tauri::command]
pub async fn generate_cfg(code: String) -> Result<CfgResult, AppError> {
    let result = tokio::task::spawn_blocking(move || generate_cfg_impl(&code))
        .await
        .map_err(|e| AppError::Other {
            detail: format!("CFG 生成任务失败: {e}"),
        })?
        .map_err(|e| AppError::Other { detail: e })?;
    Ok(result)
}
```

- [ ] **Step 2: 在 commands/mod.rs 添加 re-export**

在 `src-tauri/src/commands/mod.rs` 第 31 行 `pub use parser_cmd::extract_code_symbols;` 后追加：

```rust
pub use parser_cmd::generate_cfg;
```

- [ ] **Step 3: 在 lib.rs 注册命令**

在 `src-tauri/src/lib.rs` 的 `use commands::{ ... }` 块（第 18-27 行）中，在 `extract_code_symbols,` 后添加 `generate_cfg,`。

修改后的 use 块：

```rust
use commands::{
    add_recent_file, add_test_case, clear_recent_files, compile_and_run, create_test_suite,
    delete_custom_theme_image, delete_test_suite, extract_code_symbols, find_or_create_suite_by_doc_path,
    format_code, generate_cfg, get_all_case_previews, get_case_full_expected,
    get_case_preview, get_custom_theme_image_path, get_recent_files, get_settings,
    import_test_cases, load_test_suite, open_file, read_file_bytes, remove_recent_file,
    remove_test_case, resize_pty, run_tests, save_custom_theme_image, save_file, save_settings,
    start_pty_run, stop_pty_run, stop_run, update_test_case, update_view_menu_state,
    write_pty_stdin,
};
```

在 `invoke_handler` 的 `generate_handler!` 宏中（第 78-115 行），在 `extract_code_symbols,` 后添加 `generate_cfg,`。

- [ ] **Step 4: 运行后端测试验证**

Run: `cd src-tauri && cargo test`
Expected: 所有测试通过（包括 cfg.rs 的 14 个测试）

- [ ] **Step 5: 运行 cargo check 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 无错误

---

## Task 2: 添加 mermaid 依赖

**文件：**
- 修改：`package.json:14-37`（dependencies 块）

### 步骤

- [ ] **Step 1: 安装 mermaid**

Run: `pnpm add mermaid@^11`

这将自动更新 `package.json` 的 dependencies，添加 `"mermaid": "^11.x.x"`。

- [ ] **Step 2: 验证安装**

Run: `pnpm list mermaid`
Expected: 显示 mermaid 版本号

---

## Task 3: 前端类型定义

**文件：**
- 修改：`src/types/index.ts`（在文件末尾追加）

### 步骤

- [ ] **Step 1: 添加 CFG 类型定义**

在 `src/types/index.ts` 末尾追加：

```typescript
// ============ 控制流图（CFG） ============

// 与 Rust 端 parser/cfg.rs CfgNode 对应
export interface CfgNode {
  id: string;
  label: string;
  line: number; // 1-based 行号
  kind: string; // "entry" / "exit" / "statement" / "condition" / "loop" / "switch_case"
}

// 与 Rust 端 parser/cfg.rs CfgResult 对应
export interface CfgResult {
  mermaid: string;
  nodes: CfgNode[];
  warning: string | null;
}
```

- [ ] **Step 2: 验证类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无错误

---

## Task 4: Editor revealLine 方法

**文件：**
- 修改：`src/components/Editor.tsx`（EditorHandle 接口 + useImperativeHandle 实现）

### 步骤

- [ ] **Step 1: 在 EditorHandle 接口添加 revealLine**

在 `src/components/Editor.tsx` 第 161-170 行的 `EditorHandle` interface 中，在 `clearCompileErrors: () => void;` 后添加：

```typescript
  revealLine: (line: number) => void;
```

修改后的 interface：

```typescript
export interface EditorHandle {
  getCode: () => string;
  setValue: (s: string) => void;
  trigger: (action: string) => void;
  focus: () => void;
  switchModel: (tabId: string, content: string, language: string) => void;
  disposeModel: (tabId: string) => void;
  setCompileErrors: (errors: CompileError[]) => void;
  clearCompileErrors: () => void;
  revealLine: (line: number) => void;
}
```

- [ ] **Step 2: 在 useImperativeHandle 中实现 revealLine**

在 `src/components/Editor.tsx` 的 `useImperativeHandle` 回调中（第 307-311 行 `clearCompileErrors` 实现之后），添加：

```typescript
      revealLine: (line: number) => {
        editorRef.current?.revealLineInCenter(line);
        editorRef.current?.focus();
      },
```

修改后的 clearCompileErrors + revealLine 片段：

```typescript
      clearCompileErrors: () => {
        const editor = editorRef.current;
        if (!editor) return;
        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, []);
      },
      revealLine: (line: number) => {
        editorRef.current?.revealLineInCenter(line);
        editorRef.current?.focus();
      },
```

- [ ] **Step 3: 验证类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无错误

---

## Task 5: i18n 文案

**文件：**
- 修改：`src/locales/zh.ts`（panel 块内追加）
- 修改：`src/locales/en.ts`（panel 块内追加）
- 修改：`src/locales/i18n.test.ts`（追加 CFG key 测试）

### 步骤

- [ ] **Step 1: 在 zh.ts 的 panel 块添加 flowchart key**

在 `src/locales/zh.ts` 的 `panel` 对象内（第 96-121 行），在 `editorMenu` 块之后、`panel` 对象闭合 `}` 之前添加：

```typescript
    flowchart: "控制流图",
    flowchartLoading: "生成中…",
    flowchartError: "生成失败：{detail}",
    flowchartNoFunction: "未找到函数定义",
    flowchartNoCode: "请先打开或编写 C++ 代码",
    flowchartWarning: "⚠ {detail}",
    flowchartRefresh: "刷新",
```

- [ ] **Step 2: 在 en.ts 的 panel 块添加 flowchart key**

在 `src/locales/en.ts` 的 `panel` 对象内（第 96-121 行），在 `editorMenu` 块之后、`panel` 对象闭合 `}` 之前添加：

```typescript
    flowchart: "Flowchart",
    flowchartLoading: "Generating…",
    flowchartError: "Failed: {detail}",
    flowchartNoFunction: "No function definition found",
    flowchartNoCode: "Open or write some C++ code first",
    flowchartWarning: "⚠ {detail}",
    flowchartRefresh: "Refresh",
```

- [ ] **Step 3: 在 i18n.test.ts 添加 CFG key 完整性测试**

在 `src/locales/i18n.test.ts` 的最后一个 `describe` 块之后追加：

```typescript
  // CFG 控制流图功能新增的 i18n key
  describe("CFG 控制流图 key", () => {
    const requiredCfgKeys = [
      "panel.flowchart",
      "panel.flowchartLoading",
      "panel.flowchartError",
      "panel.flowchartNoFunction",
      "panel.flowchartNoCode",
      "panel.flowchartWarning",
      "panel.flowchartRefresh",
    ];

    it.each(requiredCfgKeys)("zh 与 en 都包含 %s", (k) => {
      expect(getByPath(zh, k), `zh 缺少 ${k}`).toBeTypeOf("string");
      expect(getByPath(en, k), `en 缺少 ${k}`).toBeTypeOf("string");
    });
  });
```

- [ ] **Step 4: 运行 i18n 测试验证**

Run: `pnpm test src/locales/i18n.test.ts`
Expected: PASS

---

## Task 6: FlowchartPanel 组件

**文件：**
- 创建：`src/components/FlowchartPanel.tsx`
- 创建：`src/components/FlowchartPanel.test.ts`

### 组件设计

```
FlowchartPanel
├── props: code, onJumpToLine, theme
├── 状态: status (idle/loading/rendered/error), cfgResult, error
├── effect: code 变化 → invoke("generate_cfg") → mermaid.render()
├── 全局回调: window.__cfgJump = (line) => onJumpToLine(parseInt(line))
└── 渲染:
    ├── 顶部工具栏: 刷新按钮 + 警告横幅
    ├── 内容区: mermaid SVG（可滚动）
    └── 空状态/错误状态/加载状态
```

### 步骤

- [ ] **Step 1: 创建 FlowchartPanel.tsx 组件**

创建 `src/components/FlowchartPanel.tsx`：

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, AlertTriangle, Workflow } from "lucide-react";
import type { CfgResult } from "../types";
import { useI18n } from "../hooks/useI18n";

type FlowchartStatus = "idle" | "loading" | "rendered" | "error";

interface FlowchartPanelProps {
  /** 当前编辑器中的 C++ 源码 */
  code: string;
  /** 点击节点跳转代码行回调 */
  onJumpToLine: (line: number) => void;
  /** 软件主题（用于 mermaid 主题同步） */
  theme: "dark" | "light" | "custom";
}

// mermaid 模块类型（懒加载）
interface MermaidModule {
  default: {
    initialize: (config: Record<string, unknown>) => void;
    render: (id: string, text: string) => Promise<{ svg: string }>;
  };
}

// 全局 __cfgJump 回调类型声明
declare global {
  interface Window {
    __cfgJump?: (line: string) => void;
  }
}

export default function FlowchartPanel({ code, onJumpToLine, theme }: FlowchartPanelProps) {
  const t = useI18n((s) => s.t);
  const [status, setStatus] = useState<FlowchartStatus>("idle");
  const [cfgResult, setCfgResult] = useState<CfgResult | null>(null);
  const [error, setError] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const mermaidRef = useRef<MermaidModule["default"] | null>(null);
  // 持有最新 onJumpToLine，供 window.__cfgJump 闭包读取
  const jumpRef = useRef(onJumpToLine);
  jumpRef.current = onJumpToLine;
  // 持有最新 code，供手动刷新读取
  const codeRef = useRef(code);
  codeRef.current = code;

  // 注册全局 __cfgJump 回调（mermaid click 事件通过 window 函数调用）
  useEffect(() => {
    window.__cfgJump = (line: string) => {
      const lineNum = parseInt(line, 10);
      if (!isNaN(lineNum) && lineNum > 0) {
        jumpRef.current(lineNum);
      }
    };
    return () => {
      delete window.__cfgJump;
    };
  }, []);

  // 懒加载 mermaid 库
  const loadMermaid = useCallback(async (): Promise<MermaidModule["default"]> => {
    if (mermaidRef.current) return mermaidRef.current;
    const mod = (await import("mermaid")) as unknown as MermaidModule;
    const mermaid = mod.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: theme === "light" ? "light" : "dark",
      flowchart: {
        curve: "basis",
        padding: 12,
      },
    });
    mermaidRef.current = mermaid;
    return mermaid;
  }, [theme]);

  // 生成 + 渲染流程图
  const renderFlowchart = useCallback(async () => {
    const currentCode = codeRef.current;
    if (!currentCode.trim()) {
      setStatus("idle");
      setCfgResult(null);
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const result = await invoke<CfgResult>("generate_cfg", { code: currentCode });
      setCfgResult(result);

      const mermaid = await loadMermaid();

      // 主题变化时重新初始化
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: theme === "light" ? "light" : "dark",
        flowchart: {
          curve: "basis",
          padding: 12,
        },
      });

      const renderId = `cfg-svg-${Date.now()}`;
      const { svg } = await mermaid.render(renderId, result.mermaid);

      if (containerRef.current) {
        containerRef.current.innerHTML = svg;
      }
      setStatus("rendered");
    } catch (e) {
      const msg = typeof e === "string" ? e : String(e);
      // 区分"未找到函数"和其他错误
      if (msg.includes("未找到函数定义") || msg.includes("No function")) {
        setStatus("idle");
        setCfgResult(null);
      } else {
        setError(msg);
        setStatus("error");
      }
    }
  }, [loadMermaid, theme]);

  // code 或 theme 变化时自动重新渲染
  useEffect(() => {
    void renderFlowchart();
  }, [code, theme, refreshKey, renderFlowchart]);

  // 手动刷新
  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // 渲染各状态
  if (status === "idle" && !cfgResult) {
    return (
      <div className="flowchart-panel">
        <div className="flowchart-empty">
          <Workflow size={32} className="flowchart-empty-icon" />
          <p>{code.trim() ? t("panel.flowchartNoFunction") : t("panel.flowchartNoCode")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flowchart-panel">
      <div className="flowchart-toolbar">
        <button
          className="flowchart-refresh-btn"
          onClick={handleRefresh}
          title={t("panel.flowchartRefresh")}
          aria-label={t("panel.flowchartRefresh")}
        >
          <RefreshCw size={12} />
          {t("panel.flowchartRefresh")}
        </button>
      </div>
      {cfgResult?.warning && (
        <div className="flowchart-warning">
          <AlertTriangle size={12} />
          <span>{t("panel.flowchartWarning", { detail: cfgResult.warning })}</span>
        </div>
      )}
      {status === "loading" && (
        <div className="flowchart-loading">{t("panel.flowchartLoading")}</div>
      )}
      {status === "error" && (
        <div className="flowchart-error">
          {t("panel.flowchartError", { detail: error })}
        </div>
      )}
      <div
        ref={containerRef}
        className="flowchart-content"
        style={{ display: status === "rendered" ? "block" : "none" }}
      />
    </div>
  );
}
```

- [ ] **Step 2: 创建 FlowchartPanel.test.ts 测试**

创建 `src/components/FlowchartPanel.test.tsx`：

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FlowchartPanel from "./FlowchartPanel";
import { useI18n } from "../hooks/useI18n";
import { zh } from "../locales/zh";

// 按点分路径取值
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

// mock invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// mock mermaid 动态导入
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg class="mock-mermaid"></svg>' }),
  },
}));

import { invoke } from "@tauri-apps/api/core";

function setupI18n() {
  useI18n.setState({ locale: "zh", t: (key: string, params?: Record<string, string>) => {
    let val = getByPath(zh, key) as string | undefined;
    if (!val) return key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        val = val.replace(`{${k}}`, v);
      }
    }
    return val;
  }});
}

describe("FlowchartPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupI18n();
  });

  it("空代码显示提示", () => {
    render(<FlowchartPanel code="" onJumpToLine={vi.fn()} theme="dark" />);
    expect(screen.getByText(zh.panel.flowchartNoCode)).toBeInTheDocument();
  });

  it("调用 generate_cfg 命令", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue({
      mermaid: "graph TD\n    n0([开始 main])",
      nodes: [{ id: "n0", label: "开始 main", line: 1, kind: "entry" }],
      warning: null,
    });

    render(<FlowchartPanel code="int main() { return 0; }" onJumpToLine={vi.fn()} theme="dark" />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("generate_cfg", { code: "int main() { return 0; }" });
    });
  });

  it("显示警告信息", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue({
      mermaid: "graph TD\n    n0([开始 main])",
      nodes: [{ id: "n0", label: "开始 main", line: 1, kind: "entry" }],
      warning: "检测到含控制流关键字的宏定义",
    });

    render(<FlowchartPanel code="int main() {}" onJumpToLine={vi.fn()} theme="dark" />);

    await waitFor(() => {
      expect(screen.getByText(/检测到含控制流关键字的宏定义/)).toBeInTheDocument();
    });
  });

  it("注册 window.__cfgJump 回调", () => {
    render(<FlowchartPanel code="" onJumpToLine={vi.fn()} theme="dark" />);
    expect(typeof window.__cfgJump).toBe("function");
  });

  it("__cfgJump 调用 onJumpToLine", () => {
    const onJump = vi.fn();
    render(<FlowchartPanel code="" onJumpToLine={onJump} theme="dark" />);
    window.__cfgJump?.("42");
    expect(onJump).toHaveBeenCalledWith(42);
  });

  it("组件卸载时清理 __cfgJump", () => {
    const { unmount } = render(<FlowchartPanel code="" onJumpToLine={vi.fn()} theme="dark" />);
    unmount();
    expect(window.__cfgJump).toBeUndefined();
  });

  it("点击刷新按钮触发重新渲染", async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValue({
      mermaid: "graph TD",
      nodes: [],
      warning: null,
    });

    render(<FlowchartPanel code="int main() {}" onJumpToLine={vi.fn()} theme="dark" />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    const refreshBtn = screen.getByLabelText(zh.panel.flowchartRefresh);
    await userEvent.click(refreshBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 3: 运行组件测试**

Run: `pnpm test src/components/FlowchartPanel.test.tsx`
Expected: 所有测试通过

---

## Task 7: App.tsx 集成

**文件：**
- 修改：`src/App.tsx`

### 步骤

- [ ] **Step 1: 修改 PanelTab 类型**

在 `src/App.tsx` 第 38 行，修改 `PanelTab` 类型：

```typescript
type PanelTab = "tests" | "terminal" | "flowchart";
```

- [ ] **Step 2: 导入 FlowchartPanel**

在 `src/App.tsx` 第 13 行 `import Terminal from "./components/Terminal";` 后添加：

```typescript
import FlowchartPanel from "./components/FlowchartPanel";
```

- [ ] **Step 3: 导入 CfgResult 类型**

在 `src/App.tsx` 第 29 行的 type import 中添加 `CfgResult`：

```typescript
import type { AppErrorPayload, AppSettings, CustomThemeConfig, FormatResult } from "./types";
```

此处无需添加 CfgResult（FlowchartPanel 自己 import 即可，App 不直接使用）。

- [ ] **Step 4: 添加 flowchart tab 按钮**

在 `src/App.tsx` 面板标签区域（第 953-982 行的 `<div className="panel-tabs">` 内），在 tests tab 按钮后添加 flowchart tab 按钮：

```tsx
            <button
              className={"panel-tab" + (tab === "flowchart" ? " active" : "")}
              onClick={() => setTab("flowchart")}
            >
              {t("panel.flowchart")}
            </button>
```

修改后的 panel-tabs 区域：

```tsx
          <div className="panel-tabs">
            <button
              className={"panel-tab" + (tab === "terminal" ? " active" : "")}
              onClick={() => setTab("terminal")}
            >
              {t("panel.terminal")}
            </button>
            <button
              className={"panel-tab" + (tab === "tests" ? " active" : "")}
              onClick={() => setTab("tests")}
            >
              {t("panel.tests")}
            </button>
            <button
              className={"panel-tab" + (tab === "flowchart" ? " active" : "")}
              onClick={() => setTab("flowchart")}
            >
              {t("panel.flowchart")}
            </button>
            <button
              className="panel-close"
              title={t("panel.close")}
              aria-label={t("panel.close")}
              onClick={() => {
                const cur = useSettings.getState().settings;
                if (!cur) return;
                updateSettings({ general: { ...cur.general, auto_hide_panel: true } });
                rightPanelRef.current?.collapse();
              }}
            >
              <X size={14} />
            </button>
          </div>
```

- [ ] **Step 5: 添加 FlowchartPanel section**

在 `src/App.tsx` 面板内容区域（第 983-1009 行的 `<div className="panel-body">` 内），在 terminal section 后添加 flowchart section：

```tsx
            <section style={{ display: tab === "flowchart" ? undefined : "none" }}>
              <FlowchartPanel
                code={activeTab?.content ?? ""}
                onJumpToLine={(line) => {
                  editorRef.current?.revealLine(line);
                }}
                theme={effectiveTheme}
              />
            </section>
```

修改后的 panel-body 区域：

```tsx
          <div className="panel-body">
            <section style={{ display: tab === "tests" ? undefined : "none" }}>
              <TestCasesPanel onRunTests={handleRunTests} />
            </section>
            <section style={{ display: tab === "terminal" ? undefined : "none" }}>
              <Terminal
                runId={ptyRunId}
                onExit={handlePtyExit}
                fontSize={settings?.editor.terminal_font_size}
                theme={effectiveTheme}
                customColors={effectiveCustomTheme?.colors}
                panelAlpha={
                  effectiveCustomTheme
                    ? effectiveCustomTheme.panel_alpha / 100
                    : undefined
                }
                baseMode={
                  effectiveCustomTheme
                    ? (effectiveCustomTheme.base_mode as "light" | "dark")
                    : undefined
                }
                compileError={compileError}
                compileWarning={compileWarning}
                onFocusChange={(focused) => { terminalFocusedRef.current = focused; }}
                visible={tab === "terminal"}
              />
            </section>
            <section style={{ display: tab === "flowchart" ? undefined : "none" }}>
              <FlowchartPanel
                code={activeTab?.content ?? ""}
                onJumpToLine={(line) => {
                  editorRef.current?.revealLine(line);
                }}
                theme={effectiveTheme}
              />
            </section>
          </div>
```

- [ ] **Step 6: 验证类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无错误

---

## Task 8: CSS 样式

**文件：**
- 修改：`src/styles/global.css`（在 `.panel-body > section` 规则之后追加）

### 步骤

- [ ] **Step 1: 添加 flowchart 面板样式**

在 `src/styles/global.css` 中 `.panel-body > section` 规则块之后（约第 749 行后）追加：

```css
/* ============ 控制流图面板 ============ */
.flowchart-panel {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.flowchart-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-md);
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}

.flowchart-refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  font-size: 12px;
  font-family: inherit;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s;
}

.flowchart-refresh-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.flowchart-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-xs) var(--space-md);
  background-color: var(--panel-bg-alt);
  color: var(--text-muted);
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}

.flowchart-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  color: var(--text-muted);
  font-size: 13px;
}

.flowchart-error {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  color: var(--error);
  font-size: 13px;
  padding: var(--space-md);
  text-align: center;
}

.flowchart-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: var(--space-md);
  display: flex;
  justify-content: center;
}

.flowchart-content svg {
  max-width: 100%;
  height: auto;
}

.flowchart-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  flex: 1 1 auto;
  color: var(--text-muted);
  font-size: 13px;
}

.flowchart-empty-icon {
  opacity: 0.4;
}
```

- [ ] **Step 2: 验证样式生效**

运行应用后切换到 flowchart tab，确认样式正确。

---

## Task 9: 全量测试与验证

### 步骤

- [ ] **Step 1: 运行前端全部测试**

Run: `pnpm test`
Expected: 所有测试通过

- [ ] **Step 2: 运行后端全部测试**

Run: `cd src-tauri && cargo test`
Expected: 所有测试通过

- [ ] **Step 3: 运行 TypeScript 类型检查**

Run: `pnpm tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 启动应用进行手动验证**

Run: `pnpm tauri dev`

验证清单：
1. 右侧面板出现三个 tab：终端、多样例测试、控制流图
2. 点击「控制流图」tab，显示空状态提示
3. 在编辑器输入 `int main() { return 0; }`，流程图自动生成
4. 输入含 if/else/for/while/switch 的代码，验证各控制流结构正确渲染
5. 点击流程图节点，编辑器跳转到对应代码行
6. 测试深色/浅色主题切换，流程图主题同步变化
7. 测试含 `#define REP(i,n) for(...)` 宏的代码，确认显示警告
8. 测试嵌套 5 层以上的 if，确认显示"嵌套过深"
9. 测试超过 80 节点的代码，确认显示节点数警告
10. 切换 tab 后再切回 flowchart，流程图保持正常

- [ ] **Step 5: 验证安装包体积影响**

Run: `pnpm tauri build`

检查：
- mermaid 是否被正确打包（不影响安装包体积过多）
- 懒加载是否生效（首屏不加载 mermaid）

---

## 设计决策记录

### 1. Mermaid 懒加载
mermaid.js 体积较大（~2MB+），首次切换到 flowchart tab 时才动态 `import("mermaid")`，不影响应用启动性能。

### 2. 全局回调 `window.__cfgJump`
Mermaid 的 `click nodeId call __cfgJump("line")` 语法要求函数定义在 `window` 上。组件挂载时注册，卸载时清理。使用 `jumpRef` 持有最新回调避免闭包陈旧。

### 3. 主题同步
Mermaid 支持 `theme: "dark" | "light"` 初始化。custom 主题按 `baseMode` 决定深浅。主题变化时重新 `initialize` + 重新 `render`。

### 4. 自动刷新 + 手动刷新
- 代码变化时自动触发 `renderFlowchart`（React useEffect 依赖 `code`）
- 提供「刷新」按钮手动触发（`refreshKey` 状态变化触发 useEffect）

### 5. 错误处理分级
- "未找到函数定义" → 空状态提示（非错误）
- 其他解析错误 → 错误状态展示
- 宏检测 / 节点数过多 → 警告横幅（不阻止渲染）
