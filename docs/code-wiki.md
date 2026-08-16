# RunCode Code Wiki

> 本文档为 RunCode 项目的结构化代码百科，覆盖项目整体架构、主要模块职责、关键类与函数说明、依赖关系及项目运行方式等关键信息，供新成员快速熟悉代码库、供 AI 协作代理建立全局上下文。

---

## 目录

- [1. 项目概览](#1-项目概览)
- [2. 项目目录结构](#2-项目目录结构)
- [3. 整体架构](#3-整体架构)
- [4. 前端模块详解](#4-前端模块详解)
- [5. 后端模块详解](#5-后端模块详解)
- [6. 关键类与函数说明](#6-关键类与函数说明)
- [7. 依赖关系](#7-依赖关系)
- [8. 项目运行方式](#8-项目运行方式)
- [9. 跨平台实现差异](#9-跨平台实现差异)
- [10. 关键设计决策与约束](#10-关键设计决策与约束)

---

## 1. 项目概览

### 1.1 项目定位

RunCode 是一个**轻量级跨平台 C++ 教学编辑器**（macOS + Windows），基于 Tauri 2 + React 19 + Monaco Editor，专为 OI / 算法教学场景设计。支持多样例测试、时间限制判定、实时终端、代码格式化等教学核心功能。

**核心特性**：

- 原生桌面体验（Tauri 2 + Rust，无 Electron 包袱）
- Monaco Editor（VS Code 同款，含中文本地化）
- 多样例测试（一次性运行多组样例，支持 stdin / expected 文件导入）
- 时间限制判定（OI 友好，默认 1000ms 可配置）
- 实时 PTY 终端（macOS forkpty / Windows ConPTY）
- tree-sitter 代码格式化 + clang-format 回退
- Lyra 全直角 UI 风格（Graphite 中性灰 + RunCode Slate 品牌色）
- 中英文界面切换、Dark / Light / System / 自定义图片主题
- C++ 速查表（内置 STL / 算法 / DP / 图论常用片段）
- 控制流图可视化（tree-sitter 解析 C++ 函数 AST → 生成 Mermaid 流程图，点击节点跳转代码行）

### 1.2 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript 5.8 + Vite 7 + Tailwind 4 + Zustand 4 + lucide-react 1.26 + Monaco Editor 0.52 + react-resizable-panels 2.1 + Radix UI + xterm 6 + mermaid（懒加载，控制流图渲染） |
| 后端 | Rust 2021 edition + Tauri 2 + tokio + portable-pty + tree-sitter + serde + zip + walkdir + windows crate（Windows 平台 JobObject） |
| 测试 | Vitest 4.1（前端）+ cargo test（后端） |
| 打包 | Tauri bundler（macOS DMG + Windows NSIS） |

### 1.3 性能与轻量化目标（硬约束）

- 安装包体积：~10MB（macOS）/ ~40MB（Windows NSIS 含内置 TDM-GCC，安装后展开约 290MB）
- 运行内存：主进程 ~35MB；完整实例 macOS ~260MB / Windows ~240MB
- 启动时间：秒级（冷启动 <1s）
- 不引入 Electron / Chromium 内核依赖，不引入常驻后台进程

---

## 2. 项目目录结构

```
RunCode/
├── src/                          # 前端 React 代码
│   ├── components/               # React 组件
│   │   ├── ui/                   # Radix UI 基础组件（Lyra 全直角风格）
│   │   ├── Editor.tsx            # Monaco 编辑器封装
│   │   ├── Terminal.tsx          # xterm 终端
│   │   ├── TestCasesPanel.tsx    # 多样例测试面板
│   │   ├── TabBar.tsx            # 文件标签栏
│   │   ├── StatusBar.tsx         # 底部状态栏
│   │   ├── TitleBar.tsx          # Windows 自定义标题栏
│   │   ├── SettingsPanel.tsx     # 设置面板
│   │   ├── CheatsheetDialog.tsx  # C++ 速查表弹窗
│   │   ├── DiffDialog.tsx        # 差异对比弹窗
│   │   ├── FlowchartPanel.tsx    # 控制流图面板
│   │   ├── RecentFilesDialog.tsx # 最近文件弹窗
│   │   └── CustomThemePreview.tsx
│   ├── hooks/                    # Zustand store hooks
│   ├── data/cheatsheet.ts        # C++ 速查表数据
│   ├── lib/utils.ts              # cn() 工具
│   ├── locales/                  # i18n 文案（zh / en）
│   ├── monaco/                   # Monaco 集成（关键字/成员/NLS）
│   ├── styles/                   # 全局样式 / Tailwind / 字体
│   ├── test/                     # 测试 setup 与 mock
│   ├── types/index.ts            # 核心 TypeScript 类型
│   ├── utils/                    # 工具函数（颜色/错误解析/diff/主题）
│   ├── App.tsx                   # 根组件
│   └── main.tsx                  # 应用入口
├── src-tauri/                    # Rust 后端代码
│   ├── src/
│   │   ├── commands/             # Tauri commands（前端 invoke 入口）
│   │   ├── runner/               # 进程执行与资源限制（跨平台分发）
│   │   ├── parser/               # tree-sitter 代码解析（含 CFG 生成）
│   │   │   ├── mod.rs            # 解析基础设施
│   │   │   ├── formatter.rs      # 代码格式化
│   │   │   └── cfg.rs            # 控制流图（CFG）生成
│   │   ├── config.rs             # 编译器与运行配置
│   │   ├── error.rs              # 错误类型定义
│   │   ├── formatter.rs          # 代码格式化器
│   │   ├── importer.rs           # 测试用例导入器
│   │   ├── pty.rs                # PTY 进程管理
│   │   ├── recent_files.rs       # 最近文件持久化
│   │   ├── run_manager.rs        # 运行会话管理器
│   │   ├── settings.rs           # 应用设置结构
│   │   ├── test_suite.rs         # 测试套件存储
│   │   ├── lib.rs                # 库入口（装配中心）
│   │   └── main.rs               # 二进制入口
│   ├── resources/tdm-gcc/        # Windows 内置 TDM-GCC（已提交仓库）
│   ├── capabilities/default.json # 权限配置
│   ├── entitlements.plist        # macOS Hardened Runtime 权限
│   ├── build.rs                  # 构建脚本
│   └── Cargo.toml
├── docs/                         # 文档
│   ├── adr/                      # 架构决策记录
│   └── brand-guidelines.md       # 品牌指南
├── scripts/                      # 构建/维护脚本
│   ├── build-dev.sh              # macOS ad-hoc 签名构建
│   ├── build-signed.sh           # macOS Developer ID 签名 + 公证
│   ├── build-windows.ps1         # Windows NSIS 构建
│   └── prepare-tdm-gcc.ps1       # TDM-GCC 升级工具
├── .github/workflows/build.yml   # CI 构建（macOS + Windows + Release）
├── AGENTS.md                     # AI 协作规范
├── BUILD.md                      # 构建与签名指南
└── README.md
```

---

## 3. 整体架构

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                       前端（React + TS）                      │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  组件层  TitleBar / TabBar / Editor / Terminal / ...    │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  Hooks   useRunManager / useTestSuite / useTabs / ...   │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  数据/工具  cheatsheet / colorExtract / diff / theme    │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  Monaco  cppKeywords / cppMembers / nls                │  │
│  └────────────────────────────────────────────────────────┘  │
│                          ▲                                   │
│                   invoke()  /  listen()                      │
│                          ▼                                   │
├─────────────────────────────────────────────────────────────┤
│                      后端（Rust + Tauri 2）                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  commands/  Tauri 命令薄封装 → 转发到业务模块           │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  业务模块  run_manager / pty / test_suite / settings /  │  │
│  │            config / formatter / importer / recent_files │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  runner/  跨平台执行内核（unix.rs / windows.rs）        │  │
│  │  parser/  tree-sitter C++ 解析                          │  │
│  └────────────────────────────────────────────────────────┘  │
│                          ▲                                   │
│              spawn g++/clang++（用户代码编译运行）             │
│                          ▼                                   │
├─────────────────────────────────────────────────────────────┤
│                 操作系统进程 / JobObject / PTY                │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 进程模型

- **主进程**：Tauri Builder 启动的 Rust 进程，注册命令、State（`RunManager` / `PtyManager`）、菜单事件分发
- **WebView 渲染进程**：系统 webview（macOS WebKit / Windows WebView2），承载 React 前端
- **用户代码子进程**：通过 `tokio::process::Command` 或 `portable-pty` spawn 的 g++/clang++ 编译/运行子进程，受 `runner/` 资源限制约束
- **PTY 读取/等待线程**：`std::thread::spawn` 启动的阻塞 IO 线程，通过 `app.emit` 把 PTY 输出/退出事件推送给前端

### 3.3 前后端通信

RunCode 前后端通过两种机制通信：

#### invoke 命令（前端 → 后端）

前端通过 `@tauri-apps/api/core` 的 `invoke("command_name", { args })` 调用后端 `#[tauri::command]` 函数。所有命令在 [lib.rs](../src-tauri/src/lib.rs) 中通过 `generate_handler!` 注册。

主要 invoke 命令清单（共 35+ 个）：

| 命令名 | 用途 | 主要参数 / 返回值 |
|---|---|---|
| `compile_and_run` | 编译并运行（一次性） | code, stdin, run_id → RunResult |
| `run_tests` | 多样例批量测试 | code, suite_id, strict, case_ids, run_id → TestRunResult |
| `stop_run` | 取消运行任务 | run_id → bool |
| `start_pty_run` | 启动 PTY 交互运行 | code, run_id → StartPtyResult |
| `write_pty_stdin` | 向 PTY 写入 stdin | run_id, data → () |
| `resize_pty` | 调整 PTY 大小 | run_id, cols, rows → () |
| `stop_pty_run` | 停止 PTY 运行 | run_id → bool |
| `create_test_suite` | 创建测试套件 | doc_path → suite_id |
| `load_test_suite` | 加载套件 manifest | suite_id → TestSuiteManifest |
| `add_test_case` / `update_test_case` / `remove_test_case` | 用例 CRUD | … |
| `get_case_preview` / `get_all_case_previews` | 用例预览（4KB 截断） | … |
| `get_case_full_expected` | 用例完整 expected（diff 按需加载） | … |
| `delete_test_suite` | 删除套件 | suite_id → () |
| `find_or_create_suite_by_doc_path` | 多 tab 场景按文件路径关联套件 | doc_path → suite_id |
| `import_test_cases` | 从目录或 ZIP 批量导入 | suite_id, source, strict → ImportResult |
| `open_file` / `save_file` | 文件读写 | path / content → FileContent / () |
| `read_file_bytes` | 读取图片字节（主题色提取） | path → Vec\<u8\> |
| `get_settings` / `save_settings` | 设置加载/保存 | … |
| `save_custom_theme_image` / `delete_custom_theme_image` / `get_custom_theme_image_path` | 自定义主题图片管理 | … |
| `get_recent_files` / `add_recent_file` / `remove_recent_file` / `clear_recent_files` | 最近文件 CRUD | … |
| `format_code` | 代码格式化 | code, style → FormatResult |
| `extract_code_symbols` | 提取 C++ 符号（代码补全 L2） | code → Vec\<Symbol\> |
| `update_view_menu_state` | 同步原生菜单勾选状态 | layout, auto_hide → () |
| `activate_custom_titlebar` / `show_native_fallback` / `toggle_devtools` | 窗口控制 | … |

#### 事件（后端 → 前端）

后端通过 `app.emit(event_name, payload)` 推送事件，前端用 `listen(event_name, callback)` 订阅。事件分两类：

**菜单事件**（macOS 原生菜单触发，Windows 由前端 `TitleBar` 直接调用 handler）：

`menu-settings` / `menu-file-new` / `menu-file-open` / `menu-file-save` / `menu-file-save-as` / `menu-file-recent` / `menu-file-close` / `menu-file-close-all` / `menu-edit-format` / `menu-find` / `menu-find-next` / `menu-find-prev` / `menu-replace` / `menu-goto-line` / `menu-layout`（payload: "horizontal" / "vertical"）/ `menu-toggle-auto-hide` / `menu-toggle-devtools` / `menu-font-inc` / `menu-font-dec` / `menu-font-reset` / `menu-toggle-panel` / `menu-help`

**运行事件**（按 run_id 隔离）：

| 事件名 | Payload | 触发时机 |
|---|---|---|
| `test_progress` | TestProgress（Running/Passed/Failed/Cancelled） | 每个测试用例运行前后 |
| `pty_output` | `{ run_id, data }` | PTY 有数据可读 |
| `pty_exit` | PtyExitEvent（exit_code / killed_by / max_rss_kb） | PTY 子进程退出 |
| `pty_first_input` | run_id | 用户首次向 PTY 写入（重置计时起点） |

### 3.4 跨平台分发模型

后端通过 Rust `cfg` 属性实现编译期平台分发，主要分布在 [runner/](../src-tauri/src/runner/) 与 [config.rs](../src-tauri/src/config.rs)：

| 维度 | Unix（macOS） | Windows |
|---|---|---|
| 进程组隔离 | `process_group(0)` | `CREATE_NEW_PROCESS_GROUP` + `CREATE_NO_WINDOW` |
| CPU 时间限制 | `RLIMIT_CPU`（pre_exec setrlimit） | `JobObject LIMIT_JOB_TIME` |
| 文件大小限制 | `RLIMIT_FSIZE` | 不实现（API 不支持） |
| 内存采集 | macOS `proc_pid_rusage` 轮询；Linux `RUSAGE_CHILDREN` 差值法 | `GetProcessMemoryInfo` 轮询 `PeakWorkingSetSize` |
| 进程组 kill | `kill(-PGID, SIGKILL)` | `TerminateJobObject` |
| PTY 实现 | `portable-pty`（forkpty） | `portable-pty`（ConPTY） |
| 编译器探测 | `which("clang++").or(g++)` | 优先打包 TDM-GCC，回退 PATH 中的 g++/clang++ |
| 原生菜单 | 保留系统菜单栏 | 移除原生菜单，用前端 TitleBar 替代 |

详见 [第 9 节](#9-跨平台实现差异)。

---

## 4. 前端模块详解

### 4.1 入口与渲染流程

#### [src/main.tsx](../src/main.tsx)

应用入口，职责：

1. 挂载 `<App />` 到 `#root`（开启 `React.StrictMode`）
2. 导入全局样式：`fonts.css` / `tailwind.css` / `global.css`
3. 配置 Monaco：通过 `loader.config({ monaco })` 把 `monaco-editor` ESM 打入 bundle，避免 Tauri CSP `script-src 'self'` 阻止 CDN 加载
4. 按需加载 Monaco contribution：仅 cpp/markdown 语言、bracketMatching/clipboard/comment/contextmenu/find/folding/hover/suggest 等 16 个 contrib，不打包其他语言和 worker
5. 配置 `self.MonacoEnvironment.getWorker` 返回 `editorWorker()` 实例

#### [src/App.tsx](../src/App.tsx)

根组件，负责整体布局、状态聚合、键盘快捷键、主题应用、对话框调度。关键导出：

- `App`（默认导出组件）
- `resolveRunShortcut(key, metaKey, ctrlKey, shiftKey, altKey, isMac)` — 纯函数，解析运行快捷键（Cmd/Ctrl+Enter → 终端运行；Shift+Cmd/Ctrl+Enter → 多样例运行）
- `buildCustomThemeCssText(custom, bgImageUrl)` — 纯函数，构建 custom 主题的动态 CSS 变量文本

主要职责：

1. 通过 `react-resizable-panels` 组织 `TitleBar / TabBar / EditorPane / Terminal / TestCasesPanel / StatusBar` 布局
2. 管理 6 个 Zustand store（`useTabs` / `useRunManager` / `useTestSuite` / `useSettings` / `useI18n` / `useTestOptions`）
3. 监听 Tauri 菜单事件并分发到 `menuHandlers`
4. 注册跨平台键盘快捷键（Windows 在 webview 内 capture 阶段接管，macOS 用原生 accelerator）
5. 动态注入 custom 主题 CSS 变量到 `<style id="custom-theme-vars">`
6. 切换 active tab 时切换 Monaco model + 关联测试套件（防并发 + 串台校验）

### 4.2 组件层（src/components/）

#### [Editor.tsx](../src/components/Editor.tsx)

核心代码编辑器，封装 Monaco Editor。关键导出：

- `EditorPane`（forwardRef 组件）
- `EditorHandle` 接口（暴露给 App.tsx 的命令式 API）：
  ```typescript
  interface EditorHandle {
    getCode: () => string;
    setValue: (s: string) => void;
    trigger: (action: string) => void;
    focus: () => void;
    switchModel: (tabId: string, content: string, language: string) => void;
    disposeModel: (tabId: string) => void;
    setCompileErrors: (errors: CompileError[]) => void;
    clearCompileErrors: () => void;
  }
  ```

主要职责：

- 定义 `RUNCODE_DARK_COLORS` / `RUNCODE_LIGHT_COLORS` 自定义 Monaco 主题
- 维护每个 tab 的 `ITextModel`（按 tabId 索引）
- 注册 cpp 语言 completion provider（关键字 + STL + 基于变量类型推断的 `.成员` 补全）
- 编译错误高亮（`setDecorations` + 行边框）
- 主题切换（`monaco.editor.setTheme`）

#### [Terminal.tsx](../src/components/Terminal.tsx)

基于 xterm.js 的交互式终端。关键导出：`Terminal` 组件、`TerminalProps`。

主要职责：

- 定义 `XTERM_DARK_THEME` / `XTERM_LIGHT_THEME`
- 通过 Tauri `listen` 订阅 `pty-output-{runId}` 与 `pty-exit-{runId}` 事件
- 通过 `invoke("write_pty_stdin", { runId, data })` 发送用户输入
- 处理 resize（FitAddon）
- 右键菜单：复制 / 粘贴 / 全选 / 清空

#### [FlowchartPanel.tsx](../src/components/FlowchartPanel.tsx)

控制流图可视化面板。主要职责：

- 调用 `invoke("generate_cfg", { code })` 获取 Mermaid 流程图文本与节点列表
- 懒加载 `mermaid` 库（首次渲染时动态 import），渲染 Mermaid 流程图
- 点击节点触发 `onJumpToLine(line)` 回调，跳转编辑器到对应代码行
- Mermaid 渲染使用 `useEffect` + `ref.innerHTML`（避免 `dangerouslySetInnerHTML` 在 transform 更新时重建 DOM 导致性能问题与点击失效）

#### [TestCasesPanel.tsx](../src/components/TestCasesPanel.tsx)

多样例测试面板。主要职责：

- 管理用例列表展示、增删改、导入
- 调用 `useTestSuite` 的 `ensureSuiteForDocPath` / `ensureSuiteForUntitled` 确保套件
- 调用 `addCase` / `updateCase` / `removeCase` / `importCases`
- 按测试点勾选运行：每张卡片头部 checkbox 单独勾选，顶部"严格"开关左侧的"全选"toggle 一键全选/全不选（反向集合 `deselectedIds`，新增/导入默认选中，运行时禁用，空选集时运行按钮 disabled）
- 按 `useTestOptions.strict` 切换比较模式
- 展示 `testProgress` 实时进度与每例 `TestCaseResult`，触发 `DiffDialog` 查看差异

#### [TabBar.tsx](../src/components/TabBar.tsx)

文件标签栏，支持新建 / 切换 / 关闭 / 拖拽 / 未保存标记。

#### [StatusBar.tsx](../src/components/StatusBar.tsx)

底部状态栏，显示运行状态、编译器信息、光标位置、缩进、运行结果统计（duration_ms / max_rss_kb / exit_code / killed_by / job_object_degraded 降级提示），提供运行 / 停止 / 格式化按钮。

#### [TitleBar.tsx](../src/components/TitleBar.tsx)

Windows 自定义标题栏 + 菜单栏（文件 / 编辑 / 视图 / 帮助）。仅在非 macOS 渲染。点击菜单项 `emit("menu-{action}")` 给后端，再由后端回传给 App.tsx。

#### [SettingsPanel.tsx](../src/components/SettingsPanel.tsx)

设置对话框，含编译器 / 运行时 / 编辑器 / 主题 / 语言 / 快捷键分区，支持自定义图片主题提取与实时预览。调用后端 `read_file_bytes` 读取图片字节，前端 Canvas 提取颜色，结果通过 `applyThemePreview` 注入主界面 CSS 变量。

#### [CheatsheetDialog.tsx](../src/components/CheatsheetDialog.tsx)

C++ 速查表对话框，支持搜索、分类过滤、代码片段高亮（`useColorizedCode`）、复制。

#### [DiffDialog.tsx](../src/components/DiffDialog.tsx)

测试用例差异对比对话框，左右双栏同步滚动展示实际输出 vs 期望输出。用 `computeLineDiff` 计算行级 diff，超过 5000 行差异显示截断提示。

#### [RecentFilesDialog.tsx](../src/components/RecentFilesDialog.tsx)

最近文件对话框，调用 `get_recent_files` / `remove_recent_file` / `clear_recent_files` 命令。

#### [CustomThemePreview.tsx](../src/components/CustomThemePreview.tsx)

自定义图片主题预览面板，含图片缩略图、模拟编辑器/面板、透明度滑块、色板编辑、应用/取消按钮。导出 `CustomThemePreview`、`CustomThemeSliders`、`CustomThemeColorPicker`。

#### UI 基础组件（src/components/ui/）

均为基于 Radix UI primitives + cva + `cn()` 封装的 Lyra 全直角风格组件：

| 文件 | 关键导出 |
|---|---|
| button.tsx | `Button`、`buttonVariants`、`ButtonProps`（variant: default/secondary/destructive/outline/ghost/link/compact） |
| dialog.tsx | `Dialog`、`DialogContent`、`DialogHeader`、`DialogFooter`、`DialogTitle` 等 |
| input.tsx | `Input` |
| textarea.tsx | `Textarea` |
| label.tsx | `Label` |
| select.tsx | `Select`、`SelectTrigger`、`SelectContent`、`SelectItem` 等 |
| switch.tsx | `Switch` |
| tabs.tsx | `Tabs`、`TabsList`、`TabsTrigger`、`TabsContent` |
| scroll-area.tsx | `ScrollArea` |
| dropdown-menu.tsx | `DropdownMenu`、`DropdownMenuTrigger`、`DropdownMenuContent` 等 |

共同特征：全部 `rounded-none`（Lyra 风格硬约束），颜色用 `var(--primary)` 等 CSS 变量。

### 4.3 Hooks / 状态管理层（src/hooks/）

RunCode 采用 6 个独立 Zustand store，按职责拆分，store 间通过 `getState()` 互访，无循环依赖。

#### [useRunManager.ts](../src/hooks/useRunManager.ts)

运行管理中心 store。状态字段：

- `activeRunId` / `kind`（RunKind）/ `status`（idle/compiling/running/done/error）
- `runResult` / `testResult` / `error`（AppErrorPayload）/ `testProgress`
- `ptyRunId` / `ptyExitInfo`
- `perTabRunResult` / `perTabTestResult`（按 tabId 隔离结果）

主要 action：`compileRun(code, stdin)` / `runTests(code, suiteId, strict, caseIds?)` / `startInteractive(code)` / `stop()` / `clearPerTabResults(tabId)` / `setActiveTab(tabId)` / `markPtyFirstInput()` / `onPtyExit(...)`。

调用 `invoke("compile_and_run" | "run_tests" | "start_pty_run" | "stop_run" | "stop_pty_run")`，监听 `test-progress` / `pty-output` / `pty-exit` / `pty_first_input` 事件。

#### [useTestSuite.ts](../src/hooks/useTestSuite.ts)

测试套件 store。状态：`suiteId` / `manifest` / `previews`（CasePreview[]）/ `loading` / `deselectedIds`（被取消选中的 case id 数组，按 suiteId 隔离缓存于 `deselectedBySuite`，采用反向集合方案：选中 = `previews.filter(p => !deselectedIds.includes(p.id))`，新增/导入的用例天然选中）。主要 action：`ensureSuiteForDocPath(docPath)` / `ensureSuiteForUntitled()` / `addCase` / `updateCase` / `removeCase` / `importCases(source, strict)` / `reloadPreviews()` / `setSuiteId(id)` / `toggleCaseSelection(id)` / `selectAll()` / `deselectAll()` / `getSelectedIds()` / `isAllSelected()`。

#### [useTabs.ts](../src/hooks/useTabs.ts)

多标签 store。状态：`tabs`（Tab[]）/ `activeId`。主要 action：`newTab` / `openTab(path)` / `saveTab(id)` / `saveTabAs(id)` / `closeTab(id)` / `closeAll()` / `switchTab(id)` / `setContent(id, content)` / `setSuiteId(tabId, suiteId)` / `restore()` / `setOnCloseTabs(callback)`。

localStorage 持久化 tab 元信息；tab 关闭时通过 `onCloseTabs` 回调通知 Editor 释放 Monaco model。

#### [useSettings.ts](../src/hooks/useSettings.ts)

设置 store。状态：`settings`（AppSettings | null）/ `themePreview`（CustomThemeConfig | null，非 null 表示正在预览）。主要 action：`load()` / `save(settings)` / `applyThemePreview(config)` / `clearThemePreview()` / `clearCustomTheme()`。

#### [useI18n.ts](../src/hooks/useI18n.ts)

i18n store。导出 `useI18n`（store hook）、`getT()`（非 React 便捷取 t 方法）、`Locale` 类型。状态：`locale`（"zh" | "en"）/ `t(key, params?)`。`setLocale` 持久化到 `localStorage["cppteach:locale"]`。`Loose<T>` 递归拓宽字面量为 string 使 zh/en 互兼容。

#### [useTestOptions.ts](../src/hooks/useTestOptions.ts)

测试比较模式偏好 store。状态：`strict`（boolean）。action：`toggleStrict()`。strict=true 精确比较含末尾换行，false 忽略末尾换行（教学场景更友好）。

#### [useColorizedCode.ts](../src/hooks/useColorizedCode.ts)

把 C++ 代码片段通过 Monaco `colorize` 转成带语法高亮的 HTML 字符串。导出 `useColorizedCode(code, themeKey)` 返回 HTML 字符串。用于 CheatsheetDialog 速查表片段高亮。

### 4.4 数据层（src/data/）

#### [cheatsheet.ts](../src/data/cheatsheet.ts)

C++ 速查表数据 + 类型 + 搜索纯函数。面向 OI/算法教学，C++17 标准，每条 snippet 须可通过 `clang++ -std=c++17` 编译。

导出：

- 类型：`CheatCategory`（io/syntax/stl/algorithm/dp/graph）、`CheatSnippet`、`CheatEntry`
- 数据：`CHEATSHEET_ENTRIES`（60+ 条目）、`CHEATSHEET_CATEGORIES`（含 "all"）
- 纯函数：`searchCheatsheet(entries, query, category)` — 加权评分（name 精确 100 > name 子串 80 > keywords 精确 60 > keywords 子串 40 > title 子串 30 > summary 子串 20 > snippet.code 子串 5），分数相同时按原 entries 顺序稳定排序
- 纯函数：`highlightText(text, query)` — 先转义 HTML 特殊字符防 XSS，再转义 query 正则元字符，大小写不敏感全局替换为 `<mark class="cheatsheet-hl">`

### 4.5 工具层（src/utils/、src/lib/）

#### [colorExtract.ts](../src/utils/colorExtract.ts)

图片主题色提取工具（前端纯实现，无外部依赖）。导出 `extractColors(imageData, options)` / `hexToRgb(hex)` / `rgbToHex(r,g,b)` / `ExtractedColors` 类型。算法：缩放图片采样 → 中位切分法量化主色 → 按亮度判定 base_mode（dark/light）→ 派生 primary_soft/primary_border 等 rgba。

#### [compileErrors.ts](../src/utils/compileErrors.ts)

解析 g++/clang++ 编译错误输出为 `CompileError[]`。导出 `parseGccErrors(stderr)`。正则匹配 `file:line:col: error: message`（含 `fatal error`、`note`），去重，过滤非定位行。

#### [diff.ts](../src/utils/diff.ts)

行级差异计算纯函数。导出 `computeLineDiff(actual, expected)` 返回 `DiffLine[]`、`countDiffs(lines)` 返回差异行数。基于 LCS 的行级 diff，`DiffLine.type` 为 `equal`/`added`/`removed`/`modified`/`truncated`，超过 5000 行差异插入 `truncated` 标记。

#### [theme.ts](../src/utils/theme.ts)

主题工具函数。导出 `getEffectiveTheme(settingsTheme)` / `EffectiveTheme`（dark/light/custom）/ `SettingsTheme`（dark/light/system/custom）。`system` 分支查 `prefers-color-scheme: light`。

#### [lib/utils.ts](../src/lib/utils.ts)

通用工具，仅 `cn(...inputs: ClassValue[])`。基于 `clsx` + `tailwind-merge`，合并 Tailwind class 并自动处理冲突。

### 4.6 Monaco 集成（src/monaco/）

#### [cppKeywords.ts](../src/monaco/cppKeywords.ts)

C++ 关键字 + STL 完全补全数据源。导出 `CPP_KEYWORDS`（关键字列表）、`CPP_STL`（STL 容器/算法补全项，含 snippet insertText）、`CompletionItem` 类型。

#### [cppMembers.ts](../src/monaco/cppMembers.ts)

C++ 成员方法补全数据源 + 类型推断表。导出 `CPP_MEMBERS`（`Record<string, MemberDef[]>`，key 为类型名如 `string`/`vector`/`deque`/`list`/`array`/`map`/`set`/`unordered_set`/`stack`/`queue`/`priority_queue`/`pair`）、`MemberDef` 类型。当用户输入 `变量.` 时，Editor.tsx 基于变量声明推断类型，从本表取成员并以 snippet 模板弹出。

#### [nls.ts](../src/monaco/nls.ts)

Monaco ESM NLS 适配模块，通过 Vite 解析规则重定向 `monaco-editor/esm/vs/nls.js` 实现中文本地化。导出 `localize(data, message, ...args)` / `localize2(...)` / `getNLSLanguage()` / `getNLSMessages()`。

读取 `localStorage["cppteach:locale"]` 决定语言；`ZH_MESSAGES` 字典收录 editorExtensions/clipboard/comment/findController/findWidget/folding/indentation/linesOperations/links/multicursor/smartSelect/suggestController/wordHighlighter/hoverActions 等已启用 contribution 的用户可见文案；未收录 key 回退到调用方提供的英文 fallback。

### 4.7 国际化（src/locales/）

#### [zh.ts](../src/locales/zh.ts) / [en.ts](../src/locales/en.ts)

中英文案，key 结构一一对应，覆盖 app / toolbar / status / killed / tests / panel / errors / locale / settings / langConfig / menu / about / recent / tabs / cheatsheet 等分区。含 `{n}` / `{detail}` / `{name}` 等占位符。

[i18n.test.ts](../src/locales/i18n.test.ts) 确保 zh/en key 结构一致、占位符一致。

### 4.8 类型定义（src/types/index.ts）

[src/types/index.ts](../src/types/index.ts) 是核心 TypeScript 类型定义，与 Rust 端结构一一对应（注释标注对应后端文件）。按域分组：

- **运行相关**：`RunKind`、`KillReason`、`AppErrorPayload`、`RunStage`、`StartPtyResult`、`CompileError`、`RunResult`
- **测试套件**：`CaseMeta`、`TestSuiteManifest`、`CasePreview`
- **测试结果**：`TestCaseResult`、`TestRunResult`、`TestProgress`
- **批量导入**：`ImportResult`
- **应用设置**：`AppSettings`、`CompilerSettings`、`RuntimeSettings`、`TestSettings`、`GeneralSettings`、`CustomThemeColors`、`CustomThemeConfig`、`EditorSettings`
- **最近文件**：`RecentEntry`
- **多标签页**：`TabLanguage`、`Tab`
- **格式化**：`FormatResult`

### 4.9 样式系统（src/styles/）

#### [global.css](../src/styles/global.css)

全局样式，定义 CSS 变量、主题、布局、各组件样式。

- 品牌交互色（RunCode Slate）：`--primary` / `--primary-hover` / `--primary-foreground` / `--primary-soft` / `--primary-border` / `--focus-ring` / `--selection`
- Graphite 中性灰：`--bg` / `--panel-bg` / `--panel-bg-alt` / `--border` / `--text` / `--text-muted`
- 语义色：`--success` / `--warning` / `--error`（含 soft/border 变体）
- 终端背景：`--bg-terminal`
- 编译错误高亮：`--compile-error-bg` / `--compile-error-border`
- 圆角：`--radius-*` 全部 `0px`（Lyra 全直角硬约束）
- 字体：`--font-ui` / `--font-mono`（JetBrains Mono Variable 优先，中文 fallback 系统字体）
- 自定义主题：`body::before` 实现图片背景 + 遮罩 + 半透明面板

#### [tailwind.css](../src/styles/tailwind.css)

Tailwind CSS 4 入口，把 `global.css` 的 CSS 变量映射到 Tailwind 主题 token（`@theme inline`），让 `bg-primary` / `text-text` / `border-border` 等 class 直接消费 `var(--primary)` 等变量，主题切换无需重渲染组件。

#### [fonts.css](../src/styles/fonts.css)

JetBrains Mono Variable 字体 `@font-face` 声明（仅 Latin 子集，减小打包体积；中文字形 fallback 系统字体）。

---

## 5. 后端模块详解

### 5.1 入口与构建

#### [src-tauri/src/main.rs](../src-tauri/src/main.rs)

二进制入口，仅 6 行。开启 `windows_subsystem = "windows"` 属性（release 模式下隐藏控制台窗口），调用 `tauri_app_lib::run()`。

#### [src-tauri/src/lib.rs](../src-tauri/src/lib.rs)

库入口，整个后端的装配中心。声明 11 个顶层模块（commands / config / error / formatter / importer / parser / pty / recent_files / run_manager / runner / settings / test_suite）。

关键导出与职责：

- `pub fn run()` — Tauri Builder 装配入口
  - 注册 `tauri_plugin_dialog`、`tauri_plugin_decoration`
  - `.manage(RunManager::new())` / `.manage(PtyManager::new())`
  - 通过 `generate_handler!` 注册 35+ 命令
- 三个内联 `#[tauri::command]`：
  - `activate_custom_titlebar(window)` — 激活自定义标题栏（Windows 创建 HTML 控制按钮，macOS 设置红绿灯按钮位置 16.0, 20.0）
  - `show_native_fallback(window)` — 回退到原生标题栏（插件激活超时回退用）
  - `toggle_devtools(window)` — 切换 DevTools
- `setup` 钩子：仅 macOS 构建原生系统菜单栏（RunCode / 文件 / 编辑 / 视图 / 窗口 / 帮助 6 大菜单）；启动时调 `settings::cleanup_orphan_themes` 清理孤儿主题图片
- `on_menu_event` 钩子：将菜单点击通过 `app.emit` 转发为前端事件；布局菜单切换时同步调用 `update_view_menu_state_inner` 更新原生菜单勾选标记
- `RunEvent::Exit` 钩子：应用退出时调 `pm.kill_all()` + `rm.cancel_all()` 清理所有 PTY 子进程和运行会话

辅助函数：`update_layout_menu_text` / `update_auto_hide_state` / `update_view_menu_state_inner` — 逐层查找菜单项并更新文本前缀（✓ / 空格）和勾选状态。

#### [src-tauri/build.rs](../src-tauri/build.rs)

构建脚本。macOS 下 `cargo:rustc-link-lib=dylib=proc`（链接 libproc，用于 `proc_pid_rusage` 按 PID 采集子进程内存）；调用 `tauri_build::build()` 生成 Tauri schema。

#### [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json)

应用配置。`productName = "RunCode"`，`identifier = "com.cppide.teach"`，`version = "1.1.0"`。

- 窗口：1200×800，最小 800×600，`titleBarStyle = "Overlay"` + `hiddenTitle = true` + `decorations = true` + `visible = false`（启动时隐藏，等自定义标题栏激活后再 show）
- CSP：严格 `default-src 'self'`，style 允许 `tauri-plugin-decoration` + `unsafe-inline`，img 允许 `asset:` 协议，`assetProtocol.scope = ["$APPDATA/custom_themes/**"]`
- bundle：targets `["dmg", "nsis"]`，macOS 最低系统 11.0 + `signingIdentity = "-"` + entitlements；Windows 用 `downloadBootstrapper` WebView 安装模式 + NSIS `installMode = "currentUser"` + 中英双语

#### [src-tauri/capabilities/default.json](../src-tauri/capabilities/default.json)

权限配置，仅作用于 `main` 窗口。开放 `core:default` + 窗口操作（set-title / show / minimize / toggle-maximize / start-dragging / is-maximized / is-fullscreen / close）+ `dialog:default` + `decoration:default`。未开放宽泛 fs 权限给前端 webview，所有文件 IO 走 Rust 命令。

#### [src-tauri/entitlements.plist](../src-tauri/entitlements.plist)

macOS Hardened Runtime 权限。开启 `allow-jit` + `allow-unsigned-executable-memory`（Monaco/V8/WebAssembly 需要）；关闭 `allow-dyld-environment-variables` + `get-task-allow` + network（发布安全）；开启 `files.user-selected.read-write`（dialog 选中的文件可读写）。

### 5.2 业务模块层（src-tauri/src/）

#### [error.rs](../src-tauri/src/error.rs)

执行内核的错误类型定义，整个后端统一的错误出口。

- `enum AppError`：5 个变体，`#[serde(tag = "code", content = "params")]` 序列化为 `{ code, params }` 供前端 i18n 转换
  - `CompilerNotFound { detail }` / `Io { detail }` / `ProcessGroup { detail }` / `Cancelled` / `Other { detail }`
  - 注：已删除死变体 `CompileFailed` / `RunTimeout`（编译失败作为 `RunResult { stage: CompileFailed }` 正常返回，运行超时作为 `KillReason::Timeout` 正常返回）
- `impl Display`（中文错误消息）/ `impl From<std::io::Error>` / `impl From<AppError> for String`（兼容 Tauri command 返回 `Result<_, String>`）

被几乎所有模块使用（settings / config / test_suite / importer / recent_files / commands / runner）。

#### [settings.rs](../src-tauri/src/settings.rs)

应用设置结构、加载/保存、迁移、校验。`SCHEMA_VERSION = 4`。

关键 struct（持久化到 `app_data_dir/settings.json`）：

- `AppSettings`：`compiler` / `runtime` / `test` / `general` / `editor` / `current_language` / `schema_version`
- `CompilerSettings`：cpp_standard / opt_level / warnings / extra_args / compiler_path / template
- `RuntimeSettings`：compile_timeout_secs / run_timeout_secs / cpu_secs / fsize_mb（已废弃）
- `TestSettings`：fsize_mb / test_time_limit_ms / opt_level（显式 `impl Default`：fsize_mb=10, test_time_limit_ms=1000, opt_level=O2）
- `GeneralSettings`：locale / theme / layout / auto_hide_panel / custom_theme: Option\<CustomThemeConfig\>
- `EditorSettings`：font_size / theme / terminal_font_size / indent_style / indent_size / line_numbers / enable_suggestions / auto_closing_brackets / auto_closing_quotes / word_wrap / minimap_enabled
- `CustomThemeConfig`：image_file + colors: CustomThemeColors（12 个颜色字段）+ base_mode + panel_alpha/editor_alpha/mask_opacity（u8，0~100）
- `CustomThemeColors`：bg / panel_bg / panel_bg_alt / text / text_muted / border / primary / primary_hover / primary_foreground / primary_soft / primary_border / bg_terminal

关键函数：

- `pub fn load(base) -> AppSettings` — 加载流程：直接反序列化 → 失败则按 schema_version 迁移（v1→v3 / v2→v3）→ 都失败返回默认值；包含 test 字段兼容迁移；clamp alpha 到 0~100
- `pub fn save(base, settings) -> Result<(), AppError>` — 原子写入（NamedTempFile → persist rename）
- `pub fn cleanup_orphan_themes(base, settings)` — 清理 `custom_themes/` 下未被 settings.json 引用的孤儿图片
- `pub fn validate_opt_level(opt_level) -> Result<(), AppError>` — 白名单校验（O0/O1/O2/O3）
- `pub fn validate_extra_args(args) -> Result<Vec<String>, AppError>` — 附加参数黑名单校验：拒绝 `-o`/`-c`/`-pipe`/`-MF`/`-MMD`/`-MP`/`-MT`/`-MQ`/`-s`、`-l*` 链接库、`@response_file`、绝对路径、源文件扩展名、`-O*` 优化级别
- `pub fn build_compile_args(settings, opt_level) -> Result<Vec<String>, AppError>` — 构建编译参数

#### [config.rs](../src-tauri/src/config.rs)

编译器与运行配置（从 settings 构建）。

- `struct CompilerConfig`：
  - `compiler_path: PathBuf` / `compile_timeout: Duration` / `run_timeout: Duration`
  - `run_args: Vec<String>`（快速运行，用 `compiler.opt_level`，默认 O0）
  - `test_args: Vec<String>`（多样例测试，用 `test.opt_level`，默认 O2）
  - `test_opt_level: String`（快照，用于 TestRunResult 回填）
  - `test_time_limit_ms: u64`
- `impl CompilerConfig`：
  - `pub fn from_settings(settings, resource_dir) -> Result<Self, AppError>` — 编译器路径 settings 优先，None 则自动探测；Windows 去掉 `\\?\` 前缀
  - `pub fn args_for(scenario: CompileScenario) -> &[String]` — 按场景取参数
- `fn detect_compiler(resource_dir)` — 平台分支：Unix 用 `which::which("clang++").or(g++)`；Windows 优先 `find_bundled_mingw(resource_dir)`（候选 1：`resource_dir/tdm-gcc/bin/g++.exe`；候选 2：`CARGO_MANIFEST_DIR/resources/tdm-gcc/bin/g++.exe`），回退 `which::which("g++.exe").or(clang++.exe)`

#### [run_manager.rs](../src-tauri/src/run_manager.rs)

全局运行会话管理器。设计要点：**单活动任务互斥** + 取消能力 + 线程安全（Mutex 保护 HashMap）。不做沙箱（用户决策）。

- `enum RunKind`：`CompileRun` / `TestRun` / `Interactive`（serde snake_case）
- `struct RunSession`（私有）：`kind` + `cancel_token: CancellationToken`
- `struct RunManager`：`sessions: Mutex<HashMap<String, RunSession>>`
  - `pub fn register(kind) -> Result<(String, CancellationToken), String>` — 已有活动会话返回错误
  - `pub fn register_with_id(run_id, kind) -> Result<CancellationToken, String>` — 接受前端传入的 run_id（UUID 校验），让停止按钮在 invoke 前就可用
  - `pub fn cancel(run_id) -> bool` — 触发 `token.cancel()`，所有 clone 副本同时触发
  - `pub fn complete(run_id)` — 会话结束移除注册表
  - `pub fn cancel_all()` — 应用退出时调用
  - `pub fn is_busy() -> bool`

CancellationToken 相比 oneshot 的优势：可被多个阶段 clone 复用（编译→运行、批量测试每例）。

#### [pty.rs](../src-tauri/src/pty.rs)

PTY 进程管理（与 RunManager 配合）。

- `struct PtySession`（持有 master / writer / killer / pid / `_work_dir: TempDir`）：
  - `master: Arc<Mutex<Box<dyn MasterPty + Send>>>`（resize 用）
  - `writer: Arc<Mutex<Box<dyn Write + Send>>>`（stdin 写入）
  - `killer: Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>`（stop 用，避免与 wait 竞争锁）
  - `pid: Option<u32>`（Unix 用于 `kill(-pid)` 杀进程组，Windows 用于查询内存峰值）
  - `_work_dir: TempDir`（drop 时自动清理）
  - `pub fn write_stdin(data)` / `pub fn resize(cols, rows)` / `pub fn kill()` — Unix 优先 `kill(-pid, SIGKILL)` 杀整个进程组（含孙进程），killer.kill() 兜底；Windows 优先 `TerminateProcess` 终止子进程，`is_process_alive` 检查存活状态，killer.kill() 兜底
- `struct PtyManager`：
  - `sessions: Mutex<HashMap<String, PtySession>>`
  - `first_input_emitted: Mutex<HashSet<String>>` — `pty_first_input` 事件去重
  - `cancelled_flags: Mutex<HashMap<String, Arc<AtomicBool>>>` — stop_pty_run 设置标志，等待线程 emit pty_exit 前检查，保证 pty_exit 单次 emit 语义
  - `pub fn insert` / `register_cancelled_flag` / `mark_cancelled` / `remove` / `mark_first_input` / `write_stdin` / `get_pid` / `resize` / `kill` / `kill_all`

#### [recent_files.rs](../src-tauri/src/recent_files.rs)

最近文件持久化。`MAX_ENTRIES = 10`，JSON 存到 `app_data_dir/recent_files.json`，按 path 去重，最新放头部。

- `struct RecentEntry`：`path: String` / `name: String` / `opened_at: u64`（UNIX 秒）
- `struct RecentFiles`（无字段，纯静态方法）：`load` / `add` / `remove` / `clear` / `save`（原子写入）

#### [test_suite.rs](../src-tauri/src/test_suite.rs)

文件型测试套件存储。`SCHEMA_VERSION = 2`。

存储结构：`{base_dir}/testcases/{suite_id}/{manifest.json, {case_id}.in, {case_id}.out}`

常量：`MAX_SINGLE_FILE_BYTES = 50MB` / `MAX_TOTAL_BYTES = 200MB` / `INLINE_THRESHOLD = 10KB`（小样例可 inline 编辑）/ `PREVIEW_BYTES = 4KB`。

关键 struct：

- `CaseMeta`：id / name / input_size / expected_size / strict
- `TestSuiteManifest`：suite_id / doc_path: Option / cases: Vec\<CaseMeta\> / updated_at / schema_version
- `CasePreview`（前端展示用，截断大文件）：元数据 + input_preview + expected_preview + is_large

`struct TestSuite`（无字段，纯静态方法）：

- `pub fn create(base, doc_path) -> Result<String>` — 返回 suite_id
- `pub fn find_by_doc_path(base, doc_path) -> Option<String>` — 多 tab 场景：每个文件路径关联独立套件
- `pub fn load / delete / add_case / add_case_from_bytes / add_cases_batch / update_case / remove_case / get_case_preview / get_all_previews / read_case_input / read_case_expected`
- `fn validate_suite_id / validate_case_id` — UUID 校验防止路径穿越
- `fn check_single_file / check_limits` — 上限检查

#### [formatter.rs](../src-tauri/src/formatter.rs)

代码格式化器，**三级回退**：系统 clang-format 优先 → tree-sitter 内置格式化 → 返回原始代码。

- `struct FormatResult`：`code: String` + `backend: String`（`clang-format` / `builtin`）
- `struct Formatter`（无字段）：
  - `pub fn format(code, style) -> FormatResult` — style: "LLVM"/"Google"/"Microsoft"/"WebKit"/"GNU"（仅 clang-format 生效）
  - `fn detect_clang_format() -> Option<PathBuf>` — `which("clang-format")`
  - `fn format_with_clang(bin, code, style) -> Result<String, AppError>` — 调用系统 clang-format，`--style={{{style}}}` + `--assume-filename=main.cpp`

依赖 `parser::formatter::TreeSitterFormatter`。

#### [importer.rs](../src-tauri/src/importer.rs)

测试用例导入器（zip / 多文件导入）。

- `struct ImportResult`：`imported: usize` + `skipped: Vec<String>`
- `pub fn import_from_directory(base, suite_id, dir_path, strict) -> Result<ImportResult>` — `WalkDir` 递归遍历（`follow_links(false)`，跳过符号链接和目录），配对后批量导入
- `pub fn import_from_zip(base, suite_id, zip_path, strict) -> Result<ImportResult>` — 安全检查：拒绝 `..` 和绝对路径、拒绝符号链接条目、单文件 50MB、解压总量 200MB；两阶段遍历（先收集文件名+安全检查，再读取配对内容）
- 文件配对规则（优先级递减）：
  1. `{name}.in` + `{name}.out`
  2. `{name}.in` + `{name}.ans`
  3. `input{N}.txt` + `output{N}.txt`

### 5.3 commands 子模块（src-tauri/src/commands/）

薄封装层，转发到业务模块。

#### [mod.rs](../src-tauri/src/commands/mod.rs)

模块入口，声明 11 个子模块，`pub use` 重导出所有命令。包含一个内联命令：

- `#[tauri::command] pub async fn stop_run(run_id, manager) -> Result<bool, AppError>` — 通过 `RunManager.cancel(&run_id)` 取消任务

#### [compile_run.rs](../src-tauri/src/commands/compile_run.rs)

编译运行命令。核心导出：

- `enum CompileScenario`：`Run` / `Test`（决定使用哪套编译参数）
- `enum RunStage`（serde snake_case）：`CompileFailed` / `Ran`
- `struct RunResult`：run_id / success / stdout / stderr / exit_code / duration_ms / killed_by: Option\<KillReason\> / truncated / stage / max_rss_kb / job_object_degraded
- `enum CompileResult`（供 compile_and_run 和 PTY 复用）：`Success { exe_path, stdout, stderr }` / `Failed { stdout, stderr, exit_code }`

关键函数：

- `pub async fn compile_only(code, config, scenario, work_dir, compile_limits, cancel_token) -> Result<CompileResult, AppError>` — 抽取出来供 compile_and_run 和 PTY 复用。写 main.cpp，编译为 `main`（Unix）/ `main.exe`（Windows），clone token 保留原 token 给运行阶段
- `pub fn load_config(app) -> Result<(AppSettings, CompilerConfig, ResourceLimits)>` — 从 app handle 加载设置并构建配置
- `#[tauri::command] pub async fn compile_and_run(code, stdin, run_id, app, manager) -> Result<RunResult, AppError>` — 命令名 `compile_and_run`。通过 `manager.register_with_id` 注册会话，RAII guard（`RunGuard`，drop 时 `complete`）保证任何 `?` 提前返回都释放会话

#### [test_runner.rs](../src-tauri/src/commands/test_runner.rs)

批量测试命令。

- `struct TestCaseResult`：id / passed / stdout / stderr / exit_code / duration_ms / killed_by / truncated / first_diff: Option\<usize\> / max_rss_kb
- `struct TestRunResult`：run_id / success / total / passed / stage / compile_stdout / compile_stderr / used_opt_level / results / job_object_degraded
- `enum TestProgress`（serde tag = "status"）：`Running` / `Passed` / `Failed` / `Cancelled`，每例运行前后 emit `test_progress` 事件

关键纯函数（便于单元测试）：

- `fn normalize_output(s, strict) -> String` — CRLF→LF；strict=false 去掉末尾换行，strict=true 保留
- `fn judge_case_passed(exit_code, expected, actual, duration_ms, time_limit_ms, strict) -> bool` — 通过条件：exit_code == 0 && 输出匹配 && 未超时（`duration_ms > time_limit_ms` 算超时，边界值 `==` 不算）。**ADR-0004 核心**
- `fn first_diff_index(a, b) -> Option<usize>` — 找首次差异位置（字符索引）

命令：`#[tauri::command] pub async fn run_tests(code, suite_id, strict, case_ids, run_id, app, manager) -> Result<TestRunResult, AppError>` — 编译一次，逐个运行测试用例（stdin/expected 从文件读取，大样例不经过 IPC）；`case_ids: Option<Vec<String>>` 为 `None` 时全量运行，`Some(ids)` 时只运行命中的用例（保持 manifest 原顺序，由 `filter_cases` 纯函数过滤，进度条 index/total 基于过滤后范围）；每例 clone token 支持 cancel；用例间取消检查；被取消的用例不判失败直接 emit Cancelled 并 break；用例级 strict 优先 fallback 到全局 strict。

#### [pty_run.rs](../src-tauri/src/commands/pty_run.rs)

PTY 交互运行命令。`MAX_PTY_OUTPUT_BYTES = 50MB`（超过自动 kill）。

- `struct PtyOutputEvent` / `PtyExitEvent` — 推送到前端的事件
- `enum StartPtyResult`（serde tag = "status"）：`Success { run_id, compile_stdout, compile_stderr }` / `CompileFailed { run_id, stderr }`。编译失败时不 emit pty_exit，直接通过结构化结果返回 stderr，避免前端 invoke 返回前 listen 未注册导致事件丢失
- `fn drain_reader_with_timeout(handle, timeout) -> bool` — 限时等待 PTY 读取线程结束（Windows ConPTY 子进程退出后不向 master 返回 EOF，读取线程会阻塞在 read() 上）

命令：

- `start_pty_run(code, run_id, app, run_manager, pty_manager)` — 流程：注册 RunManager → 编译 → 编译失败返回 CompileFailed → 创建 PTY spawn 子进程 → 读取线程（blocking read → emit pty_output，累计 50MB 上限超限触发 kill）→ 等待线程（child.wait() → drain_reader_with_timeout 排空 → drop master 强制 reader 退出 → join reader → emit pty_exit + 清理）。macOS/Windows 都有内存轮询线程（100ms 间隔）
- `write_pty_stdin(run_id, data, pty_manager, app)` — 首次输入时 emit `pty_first_input`（只 emit 一次）
- `resize_pty(run_id, cols, rows, pty_manager)`
- `stop_pty_run(run_id, app, run_manager, pty_manager)` — kill PTY 子进程 → cancel RunManager → mark_cancelled（等待线程检测后跳过 emit，保证 pty_exit 单次 emit）→ 清理 → emit pty_exit(killed_by="cancelled")

#### [test_suite_cmd.rs](../src-tauri/src/commands/test_suite_cmd.rs)

测试套件 CRUD 命令（薄封装，转发到 `test_suite::TestSuite`）：

- `create_test_suite` / `load_test_suite` / `add_test_case` / `update_test_case` / `remove_test_case`
- `get_case_preview` / `get_all_case_previews`（spawn_blocking 避免阻塞 tokio runtime）
- `delete_test_suite` / `get_case_full_expected`（diff Modal 按需加载，不截断）
- `find_or_create_suite_by_doc_path`（多 tab 场景）

#### [import_cmd.rs](../src-tauri/src/commands/import_cmd.rs)

- `#[tauri::command] pub async fn import_test_cases(app, suite_id, source, strict) -> Result<ImportResult, AppError>` — 根据路径类型自动选择：文件夹 → `importer::import_from_directory`；.zip 文件 → `importer::import_from_zip`；其他 → 错误。spawn_blocking 避免 ZIP 解压阻塞 runtime

#### [documents.rs](../src-tauri/src/commands/documents.rs)

文件读写命令。`MAX_FILE_SIZE = 10MB`。

- `struct FileContent`：path / content
- `open_file(app, path)` — 读取文件并写入最近文件列表（失败不影响打开）
- `save_file(path, content)` — 原子写入（NamedTempFile + persist）
- `read_file_bytes(path)` — 用于前端读取图片做 Canvas 颜色提取。扩展名白名单（png/jpg/jpeg/webp）+ 10MB 上限

#### [format_cmd.rs](../src-tauri/src/commands/format_cmd.rs)

- `format_code(code, style)` — spawn_blocking 丢到 blocking 池避免占用 tokio runtime

#### [settings_cmd.rs](../src-tauri/src/commands/settings_cmd.rs)

- `get_settings(app)` / `save_settings(app, settings)` — 保存前校验附加参数 + opt_level
- `save_custom_theme_image(source_path, app)` — 保存到 `app_data_dir/custom_themes/`，文件名 `{uuid8}.{ext}`，同名跳过（去重）
- `delete_custom_theme_image(image_file, app)` — 安全校验：禁止路径分隔符 + 扩展名白名单；文件不存在视为成功（幂等）
- `get_custom_theme_image_path(image_file, app)` — 返回完整路径供前端 `convertFileSrc` 转 asset:// URL

#### [recent_cmd.rs](../src-tauri/src/commands/recent_cmd.rs)

最近文件 CRUD 命令（薄封装）：`get_recent_files` / `add_recent_file` / `remove_recent_file` / `clear_recent_files`。

#### [parser_cmd.rs](../src-tauri/src/commands/parser_cmd.rs)

- `extract_code_symbols(code)` — 用于代码补全 L2。tree-sitter 解析是 CPU 密集型，spawn_blocking
- `generate_cfg(code)` — 生成控制流图（CFG）。tree-sitter 解析函数 AST → 构建基本块与边 → 输出 Mermaid 流程图文本 + 节点列表（含行号，供前端点击跳转）。spawn_blocking

#### [menu_cmd.rs](../src-tauri/src/commands/menu_cmd.rs)

- `update_view_menu_state(app, layout, auto_hide)` — macOS 同步原生菜单勾选标记；Windows 无原生菜单，空操作

### 5.4 runner 子模块（src-tauri/src/runner/）

跨平台执行内核。

#### [mod.rs](../src-tauri/src/runner/mod.rs)

模块入口，`pub use executor::{run_with_limits, KillReason}` 和 `pub use limits::ResourceLimits`。

#### [executor.rs](../src-tauri/src/runner/executor.rs)

跨平台分发核心。

- `#[cfg(unix)] #[path = "unix.rs"] pub mod unix;` / `#[cfg(windows)] #[path = "windows.rs"] pub mod windows;`
- `enum KillReason`（serde snake_case）：`Timeout` / `Signal`（含 RLIMIT_CPU/FSIZE 触发的 SIGXCPU/SIGXFSZ；Windows JobObject CPU 超限）/ `Cancelled`
- `struct RunOutput`：exit_code: Option\<i32\> / stdout: Vec\<u8\> / stderr: Vec\<u8\> / duration_ms / killed_by: Option\<KillReason\> / truncated / max_rss_kb / job_object_degraded
- `pub async fn run_with_limits(cmd, cwd, stdin, timeout, limits, cancel_token) -> Result<RunOutput, AppError>` — 平台分发到 `run_with_limits_impl`

#### [limits.rs](../src-tauri/src/runner/limits.rs)

- `struct ResourceLimits`（Clone Copy Debug）：`cpu_secs: u64` / `fsize_mb: u64`
  - `pub fn from_settings(runtime, test) -> Self` — cpu_secs 从 runtime 读取，fsize_mb 从 test 读取

#### [output.rs](../src-tauri/src/runner/output.rs)

输出收集与标准化。`MAX_OUTPUT_BYTES = 1MB`。

- `pub async fn read_until_limit<R: AsyncRead + Unpin>(reader, max_bytes) -> io::Result<(Vec<u8>, bool)>` — 读取管道到 Vec\<u8\>，累计到 max_bytes 后停止，返回 (字节, 是否被截断)。8KB 块读取
- `pub async fn read_until_limit_shared<R: AsyncRead + Unpin>(reader, max_bytes, buf: Arc<Mutex<Vec<u8>>>, truncated: Arc<AtomicBool>)` — 共享缓冲区版本，写入外部 Arc\<Mutex\> 而非返回 Vec。用于 Windows 进程被 kill 后超时读取管道：即使超时也能从共享缓冲区获取部分数据，避免丢失已读输出

#### [unix.rs](../src-tauri/src/runner/unix.rs) — macOS/Linux 实现

- 用 `process_group(0)` 让子进程成为独立进程组组长（PGID == PID）
- 在 `pre_exec`（fork 后、exec 前）中调 `setrlimit` 设置 RLIMIT_CPU 和 RLIMIT_FSIZE（必须 async-signal-safe）
- macOS 用 `proc_pid_rusage` FFI（libproc）按 PID 轮询 `ri_resident_size` 取 max（100ms 间隔）；Linux 用 `RUSAGE_CHILDREN` 差值法
- `tokio::select!` 三路竞速：子进程结束 / 墙钟超时 / 外部取消
- 超时或取消后用 `kill(-PGID, SIGKILL)` 杀整个进程组
- stdout/stderr 各 1MB 截断

关键导出（供 `commands/pty_run.rs` 复用）：

- `pub fn get_children_rusage_max_rss_kb() -> u64` — 读取 RUSAGE_CHILDREN 的 ru_maxrss
- `#[cfg(target_os = "macos")] pub fn query_proc_pid_rss_kb(pid) -> Option<u64>` — macOS 用 proc_pid_rusage 精确查询

#### [windows.rs](../src-tauri/src/runner/windows.rs) — Windows 实现

- 用 `CREATE_NEW_PROCESS_GROUP` (0x200) + `CREATE_NO_WINDOW` (0x08000000) 替代 `process_group(0)`（CREATE_NO_WINDOW 避免 g++ 等控制台程序弹出"小黑框"）
- 用 JobObject + `JOB_OBJECT_LIMIT_JOB_TIME` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 替代 RLIMIT_CPU
- **不实现 fsize 限制**（Windows 无 RLIMIT_FSIZE 等价 API）
- **不实现内存限制**（与 macOS 一致）
- 内存采集用 `GetProcessMemoryInfo` 轮询 `PeakWorkingSetSize`（100ms 间隔）
- 进程组 kill 用 `TerminateJobObject`
- `AssignProcessToJobObject` 失败时降级（仅墙钟超时可用），返回 `job_object_degraded = true`
- `ExitFlagGuard`（RAII）：future 被 cancel 时自动设置 `exit_flag=true`，防止内存轮询线程无限循环（与 unix.rs 一致）
- `SendHandle`（RAII）：实现 `Drop` trait 自动调用 `CloseHandle`，消除所有提前返回路径的句柄泄漏风险
- 输出收集使用 `read_until_limit_shared`（共享缓冲区），进程被 kill 后超时仍可获取部分输出

关键导出（供 `commands/pty_run.rs` 复用）：

- `pub fn query_process_rss_kb(pid) -> Option<u64>` — OpenProcess + GetProcessMemoryInfo

### 5.5 parser 子模块（src-tauri/src/parser/）

#### [mod.rs](../src-tauri/src/parser/mod.rs)

tree-sitter 解析基础设施。

- `static CPP_PARSER: Mutex<Option<Parser>>` — Parser 不是 Send，需要 Mutex 保护
- `fn get_parser() -> Result<MutexGuard<'static, Option<Parser>>>` — 懒加载，首次调用时 `set_language(&tree_sitter_cpp::language())`
- `pub fn parse_cpp(code) -> Option<Tree>` — 解析 C++ 代码返回 AST
- `struct Symbol`（serde snake_case）：name / kind（"function"/"variable"/"struct"/"macro"）/ line（1-based）
- `pub fn extract_symbols(code) -> Vec<Symbol>` — 提取顶层符号，跳过函数体内局部变量
- `fn walk(node, symbols, source)` — 递归遍历

#### [formatter.rs](../src-tauri/src/parser/formatter.rs)

基于 tree-sitter AST 的简化 C++ 格式化器。采用"AST 辅助 + 文本修补"策略，覆盖 80% 常用场景。

- `struct TreeSitterFormatter`（无字段）
  - `pub fn format(code) -> String` — 1. AST 计算每行正确缩进层级 → 2. 应用缩进 → 3. 通用文本规则（normalize_braces / normalize_keywords / trim_trailing_ws / collapse_blank_lines）
  - `fn compute_indent(tree, code) -> Vec<usize>` — 用 AST 计算每行缩进层级
  - `fn walk_node(node, map, node_depth, child_depth)` — 递归遍历
  - `fn apply_indent(code, indent_map)` — 按 indent_map 重新缩进每行
  - `fn normalize_braces` / `fn normalize_keywords` / `fn trim_trailing_ws` / `fn collapse_blank_lines`

`INDENT_UNIT = "    "`（4 空格）。

#### [cfg.rs](../src-tauri/src/parser/cfg.rs)

基于 tree-sitter AST 的 C++ 控制流图（CFG）生成器。将函数体内的 if/else/for/while/switch 控制流结构转换为 Mermaid 流程图。

- `struct CfgResult`（serde）：`mermaid: String`（Mermaid 流程图文本）/ `nodes: Vec<CfgNode>` / `edges: Vec<CfgEdge>`
- `struct CfgNode`（serde）：`id: String` / `label: String` / `line: u32`（1-based，供前端点击跳转）/ `node_type: NodeType`
- `enum NodeType`（serde snake_case）：`normal` / `decision`（if/switch 条件分支）/ `terminal`（return/exit）
- `struct CfgEdge`（serde）：`from: String` / `to: String` / `label: Option<String>`（分支标签如 "true"/"false"）
- `pub fn generate_cfg(code: String) -> Result<CfgResult, String>` — 解析 C++ 代码 → 取第一个函数定义 → `CfgBuilder` 遍历 AST 节点构建基本块与边 → 生成 Mermaid 文本

---

## 6. 关键类与函数说明

### 6.1 前端关键类与函数

#### 6.1.1 Zustand Store 速查

| Store | 关键状态 | 关键 action |
|---|---|---|
| `useRunManager` | activeRunId / kind / status / runResult / testResult / testProgress / ptyRunId / perTabRunResult / perTabTestResult | compileRun / runTests / startInteractive / stop / setActiveTab / onPtyExit / markPtyFirstInput |
| `useTestSuite` | suiteId / manifest / previews / loading | ensureSuiteForDocPath / ensureSuiteForUntitled / addCase / updateCase / removeCase / importCases / reloadPreviews |
| `useTabs` | tabs / activeId | newTab / openTab / saveTab / saveTabAs / closeTab / closeAll / switchTab / setContent / setSuiteId / restore |
| `useSettings` | settings / themePreview | load / save / applyThemePreview / clearThemePreview / clearCustomTheme |
| `useI18n` | locale / t | setLocale |
| `useTestOptions` | strict | toggleStrict |

#### 6.1.2 关键纯函数（便于单元测试）

| 函数 | 文件 | 用途 |
|---|---|---|
| `resolveRunShortcut(...)` | [App.tsx](../src/App.tsx) | 解析运行快捷键（macOS/Windows 双平台映射） |
| `buildCustomThemeCssText(custom, bgImageUrl)` | [App.tsx](../src/App.tsx) | 构建 custom 主题 CSS 变量文本 |
| `getEffectiveTheme(settingsTheme)` | [utils/theme.ts](../src/utils/theme.ts) | 计算实际生效主题（system → dark/light） |
| `parseGccErrors(stderr)` | [utils/compileErrors.ts](../src/utils/compileErrors.ts) | 解析 g++/clang++ 编译错误 |
| `computeLineDiff(actual, expected)` | [utils/diff.ts](../src/utils/diff.ts) | 行级差异计算 |
| `countDiffs(lines)` | [utils/diff.ts](../src/utils/diff.ts) | 差异行数统计 |
| `extractColors(imageData, options)` | [utils/colorExtract.ts](../src/utils/colorExtract.ts) | 图片主题色提取 |
| `hexToRgb(hex)` / `rgbToHex(r,g,b)` | [utils/colorExtract.ts](../src/utils/colorExtract.ts) | 颜色格式转换 |
| `searchCheatsheet(entries, query, category)` | [data/cheatsheet.ts](../src/data/cheatsheet.ts) | 速查表加权搜索 |
| `highlightText(text, query)` | [data/cheatsheet.ts](../src/data/cheatsheet.ts) | HTML 高亮（含 XSS 转义） |
| `cn(...inputs)` | [lib/utils.ts](../src/lib/utils.ts) | Tailwind class 合并 |

### 6.2 后端关键类与函数

#### 6.2.1 关键 Struct 速查

| Struct | 文件 | 用途 |
|---|---|---|
| `AppError` | [error.rs](../src-tauri/src/error.rs) | 统一错误类型，序列化为 `{ code, params }` |
| `AppSettings` / `CompilerSettings` / `RuntimeSettings` / `TestSettings` / `GeneralSettings` / `EditorSettings` / `CustomThemeConfig` / `CustomThemeColors` | [settings.rs](../src-tauri/src/settings.rs) | 应用设置持久化结构 |
| `CompilerConfig` | [config.rs](../src-tauri/src/config.rs) | 编译器与运行配置（从 settings 构建） |
| `RunManager` / `RunSession` / `RunKind` | [run_manager.rs](../src-tauri/src/run_manager.rs) | 运行会话管理（单活动任务互斥） |
| `PtyManager` / `PtySession` | [pty.rs](../src-tauri/src/pty.rs) | PTY 进程管理 |
| `RecentFiles` / `RecentEntry` | [recent_files.rs](../src-tauri/src/recent_files.rs) | 最近文件持久化 |
| `TestSuite` / `TestSuiteManifest` / `CaseMeta` / `CasePreview` | [test_suite.rs](../src-tauri/src/test_suite.rs) | 测试套件存储 |
| `Formatter` / `FormatResult` | [formatter.rs](../src-tauri/src/formatter.rs) | 代码格式化器 |
| `ImportResult` | [importer.rs](../src-tauri/src/importer.rs) | 导入结果 |
| `CompileScenario` / `RunStage` / `RunResult` / `CompileResult` | [commands/compile_run.rs](../src-tauri/src/commands/compile_run.rs) | 编译运行结果 |
| `TestCaseResult` / `TestRunResult` / `TestProgress` | [commands/test_runner.rs](../src-tauri/src/commands/test_runner.rs) | 测试运行结果 |
| `StartPtyResult` / `PtyOutputEvent` / `PtyExitEvent` | [commands/pty_run.rs](../src-tauri/src/commands/pty_run.rs) | PTY 交互结果与事件 |
| `KillReason` / `RunOutput` | [runner/executor.rs](../src-tauri/src/runner/executor.rs) | 跨平台执行结果 |
| `ResourceLimits` | [runner/limits.rs](../src-tauri/src/runner/limits.rs) | 资源限制配置 |
| `Symbol` | [parser/mod.rs](../src-tauri/src/parser/mod.rs) | 代码符号 |
| `TreeSitterFormatter` | [parser/formatter.rs](../src-tauri/src/parser/formatter.rs) | 内置格式化器 |

#### 6.2.2 关键纯函数（便于单元测试）

| 函数 | 文件 | 用途 |
|---|---|---|
| `settings::validate_opt_level(opt_level)` | [settings.rs](../src-tauri/src/settings.rs) | opt_level 白名单校验 |
| `settings::validate_extra_args(args)` | [settings.rs](../src-tauri/src/settings.rs) | 附加参数黑名单校验 |
| `settings::build_compile_args(settings, opt_level)` | [settings.rs](../src-tauri/src/settings.rs) | 编译参数构建 |
| `test_runner::normalize_output(s, strict)` | [commands/test_runner.rs](../src-tauri/src/commands/test_runner.rs) | 输出标准化（CRLF→LF + 末尾换行处理） |
| `test_runner::judge_case_passed(exit_code, expected, actual, duration_ms, time_limit_ms, strict)` | [commands/test_runner.rs](../src-tauri/src/commands/test_runner.rs) | **用例判定（ADR-0004 核心）** |
| `test_runner::first_diff_index(a, b)` | [commands/test_runner.rs](../src-tauri/src/commands/test_runner.rs) | 首次差异位置 |
| `importer::pair_by_rules(map)` | [importer.rs](../src-tauri/src/importer.rs) | 文件配对 |
| `importer::check_zip_path(name)` | [importer.rs](../src-tauri/src/importer.rs) | ZIP 路径安全检查 |
| `parser::extract_symbols(code)` | [parser/mod.rs](../src-tauri/src/parser/mod.rs) | 符号提取 |
| `config::CompilerConfig::args_for(scenario)` | [config.rs](../src-tauri/src/config.rs) | 场景参数选择 |

---

## 7. 依赖关系

### 7.1 前端依赖（package.json）

#### 生产依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| `react` / `react-dom` | ^19.1.0 | UI 框架 |
| `typescript` | ~5.8.3 | 类型系统 |
| `@monaco-editor/react` / `monaco-editor` | ^4.6.0 / ^0.52.0 | 代码编辑器 |
| `@xterm/xterm` / `@xterm/addon-fit` | ^6.0.0 / ^0.11.0 | 终端 |
| `@tauri-apps/api` / `@tauri-apps/plugin-dialog` | ^2 / ^2.7.2 | Tauri 前端 API |
| `@radix-ui/react-*`（dialog/dropdown-menu/label/scroll-area/select/slot/switch/tabs） | 各 ^1.x / ^2.x | 无样式可访问 UI 原语 |
| `zustand` | ^4.5.0 | 状态管理 |
| `lucide-react` | ^1.26.0 | 图标库（ADR-0005 统一） |
| `react-resizable-panels` | ^2.1.0 | 可拖拽分栏 |
| `tailwind-merge` / `clsx` / `class-variance-authority` | ^3.6.0 / ^2.1.1 / ^0.7.1 | Tailwind class 合并与变体 |
| `@fontsource-variable/jetbrains-mono` | ^5.3.0 | JetBrains Mono 字体 |

#### 开发依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| `vite` / `@vitejs/plugin-react` | ^7.0.4 / ^4.6.0 | 构建工具 |
| `tailwindcss` / `@tailwindcss/vite` | ^4.3.3 | CSS 框架 |
| `vitest` | ^4.1.10 | 测试框架 |
| `@testing-library/react` / `@testing-library/jest-dom` / `@testing-library/user-event` | ^16.3.2 / ^7.0.0 / ^14.6.1 | React 测试工具 |
| `jsdom` | ^29.1.1 | DOM 模拟 |
| `@tauri-apps/cli` | ^2 | Tauri CLI |
| `@types/react` / `@types/react-dom` | ^19.1.8 / ^19.1.6 | React 类型 |

### 7.2 后端依赖（Cargo.toml）

#### 通用依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| `tauri` | 2（features: protocol-asset, devtools） | 应用框架 |
| `tauri-plugin-dialog` | 2 | 文件对话框 |
| `tauri-plugin-decoration` | 2.1.4 | 自定义标题栏 |
| `tokio` | 1（features: full） | 异步运行时 |
| `tokio-util` | 0.7（default-features = false） | 仅 `sync::CancellationToken` |
| `serde` / `serde_json` | 1 / 1 | 序列化 |
| `portable-pty` | 0.8 | PTY 跨平台抽象 |
| `tempfile` | 3 | 临时文件 |
| `which` | 6 | 编译器探测 |
| `uuid` | 1（features: v4） | run_id / suite_id 生成 |
| `libc` | 0.2 | Unix 系统调用 |
| `zip` | 2（default-features = false, features: deflate） | ZIP 解压（最小化体积） |
| `walkdir` | 2 | 递归目录遍历 |
| `tree-sitter` / `tree-sitter-cpp` | 0.22 / 0.22 | C++ 代码解析 |

#### Windows 平台条件依赖

```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_Security",
    "Win32_System_JobObjects",
    "Win32_System_Threading",
    "Win32_System_ProcessStatus",
] }
```

#### 构建依赖

- `tauri-build = { version = "2", features = [] }`

#### Release Profile（极致压缩体积）

```toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
strip = true
panic = "abort"
```

### 7.3 模块间依赖关系图

#### 前端依赖

```
main.tsx
  └── App.tsx
       ├── components/*  (Editor / Terminal / TestCasesPanel / TabBar / StatusBar / TitleBar / *Dialog)
       │    └── components/ui/*  (Radix UI 基础组件)
       ├── hooks/*  (useRunManager / useTestSuite / useTabs / useSettings / useI18n / useTestOptions / useColorizedCode)
       │    └── types/index.ts
       ├── utils/*  (colorExtract / compileErrors / diff / theme)
       │    └── lib/utils.ts (cn)
       ├── data/cheatsheet.ts
       ├── monaco/*  (cppKeywords / cppMembers / nls)
       ├── locales/*  (zh / en)
       └── styles/*  (global / tailwind / fonts)
```

#### 后端依赖

```
main.rs
  └── lib.rs
       ├── commands/*  (Tauri 命令薄封装)
       │    ├── compile_run.rs ────┐
       │    ├── test_runner.rs ────┤
       │    ├── pty_run.rs ────────┤ (共享 compile_only / load_config / CompileScenario)
       │    ├── test_suite_cmd.rs ─┤
       │    ├── import_cmd.rs ─────┤
       │    ├── documents.rs ──────┤
       │    ├── format_cmd.rs ─────┤
       │    ├── settings_cmd.rs ───┤
       │    ├── recent_cmd.rs ─────┤
       │    ├── parser_cmd.rs ─────┤
       │    └── menu_cmd.rs ───────┘
       ├── config.rs ─────── settings.rs
       ├── run_manager.rs ── (tokio-util CancellationToken)
       ├── pty.rs ───────── portable-pty
       ├── test_suite.rs ── (JSON 持久化)
       ├── formatter.rs ─── parser/formatter.rs
       ├── importer.rs ──── test_suite.rs (批量添加)
       ├── recent_files.rs
       ├── runner/
       │    ├── mod.rs
       │    ├── executor.rs ── unix.rs / windows.rs (cfg 分发)
       │    ├── limits.rs
       │    └── output.rs
       ├── parser/
       │    ├── mod.rs (tree-sitter)
       │    └── formatter.rs (TreeSitterFormatter)
       └── error.rs ─────── (统一错误出口)
```

### 7.4 前后端类型契约

[src/types/index.ts](../src/types/index.ts) 中所有与 Rust 交互的类型都注释了对应后端结构，确保 TS 类型与 Rust serde 反序列化一致。核心契约：

| 前端类型 | 后端结构 | 文件 |
|---|---|---|
| `RunKind` | `RunKind` | [run_manager.rs](../src-tauri/src/run_manager.rs) |
| `KillReason` | `KillReason` | [runner/executor.rs](../src-tauri/src/runner/executor.rs) |
| `AppErrorPayload` | `AppError`（`#[serde(tag = "code", content = "params")]`） | [error.rs](../src-tauri/src/error.rs) |
| `StartPtyResult` | `StartPtyResult` | [commands/pty_run.rs](../src-tauri/src/commands/pty_run.rs) |
| `RunResult` | `RunResult` | [commands/compile_run.rs](../src-tauri/src/commands/compile_run.rs) |
| `TestCaseResult` / `TestRunResult` / `TestProgress` | 同名 | [commands/test_runner.rs](../src-tauri/src/commands/test_runner.rs) |
| `CaseMeta` / `TestSuiteManifest` / `CasePreview` | 同名 | [test_suite.rs](../src-tauri/src/test_suite.rs) |
| `ImportResult` | `ImportResult` | [importer.rs](../src-tauri/src/importer.rs) |
| `AppSettings` 及子结构 | 同名 | [settings.rs](../src-tauri/src/settings.rs) |
| `RecentEntry` | `RecentEntry` | [recent_files.rs](../src-tauri/src/recent_files.rs) |
| `FormatResult` | `FormatResult` | [formatter.rs](../src-tauri/src/formatter.rs) |
| `CfgResult` / `CfgNode` / `CfgEdge` | 同名 | [parser/cfg.rs](../src-tauri/src/parser/cfg.rs) |

---

## 8. 项目运行方式

### 8.1 开发环境要求

- **Node.js** 22.13+（LTS）
- **pnpm** 11.17.0+（`packageManager` 字段指定）
- **Rust toolchain**（通过 [rustup](https://rustup.rs/) 安装稳定版）
- **macOS** 11+（aarch64 / x86_64）
- **Windows** 10 1903+（x86_64）

**编译器**：

- macOS：自动探测 clang++（Xcode Command Line Tools）
- Windows：内置 TDM-GCC 10.3.0（无需另装，已提交到 `src-tauri/resources/tdm-gcc/`）

### 8.2 本地开发

```bash
# 安装依赖
pnpm install

# 启动开发模式（同时启动 Vite dev server 和 Tauri 后端）
pnpm tauri dev
```

`pnpm tauri dev` 会自动：

1. 启动 Vite dev server（`http://localhost:1420`，见 `tauri.conf.json` 的 `devUrl`）
2. 编译 Rust 后端并启动 Tauri 窗口
3. 支持 HMR（前端热更新）

### 8.3 测试

#### 前端测试（Vitest）

```bash
pnpm test          # 一次性运行
pnpm test:watch    # 监听模式
```

测试文件位置：

- 组件测试：`src/components/*.test.tsx`
- Hooks 测试：`src/hooks/*.test.ts`
- 工具/数据测试：`src/utils/*.test.ts` / `src/data/*.test.ts` / `src/monaco/*.test.ts`
- i18n 测试：`src/locales/i18n.test.ts`
- 集成测试：`src/App.test.tsx`

测试 setup：`src/test/setup.ts`（导入 jest-dom matchers，补齐 jsdom 缺失 API 如 `hasPointerCapture` / `scrollIntoView`）；Monaco mock：`src/test/monaco-editor-mock.ts`。

#### 后端测试（cargo test）

```bash
cd src-tauri
cargo test

# 或从项目根目录
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

后端测试采用 `#[cfg(test)] mod tests` 内联在源文件中，参考 [settings.rs](../src-tauri/src/settings.rs)、[commands/test_runner.rs](../src-tauri/src/commands/test_runner.rs) 等。CI 中使用 `--test-threads=1` 避免并发冲突。

#### 测试覆盖要求

- 新功能 / bug 修复必须添加测试
- 纯函数优先（便于单元测试，参考 `judge_case_passed`）
- **验证不等式**：测试通过 ≠ 验收通过。真实 UI 验收（菜单点击、拖拽、视觉一致性）必须人工确认

### 8.4 构建产物

#### macOS 构建

```bash
# Ad-hoc 签名（开发用）
./scripts/build-dev.sh

# Developer ID 正式签名 + 公证
./scripts/build-signed.sh
```

- 产物：`src-tauri/target/release/bundle/dmg/RunCode_1.1.0_{arch}.dmg`
- 体积：~10MB 级
- 签名方式：默认 ad-hoc（`signingIdentity: "-"`），正式分发需配置 Apple Developer 账号 + 环境变量（`APPLE_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`）
- Hardened Runtime：通过 [entitlements.plist](../src-tauri/entitlements.plist) 启用

#### Windows 构建

```powershell
./scripts/build-windows.ps1
```

- 产物：`src-tauri/target/release/bundle/nsis/RunCode_1.1.0_x64-setup.exe`
- 体积：~40 MB（NSIS LZMA 压缩后；TDM-GCC 原始资源约 280MB 压缩至 ~30MB + RunCode ~10MB）。安装后展开约 290 MB
- TDM-GCC 已内置并提交到仓库，clone 后即用
- WebView2 Runtime：使用 `downloadBootstrapper` 模式，首次安装需联网下载（约 2MB）。离线机房需提前预装 WebView2 Runtime
- Authenticode 签名：教学场景可不做，用户点「仍要运行」即可

详见 [BUILD.md](./BUILD.md)。

### 8.5 CI/CD（GitHub Actions）

[.github/workflows/build.yml](../.github/workflows/build.yml) 定义三阶段流水线：

| Job | 平台 | 触发条件 | 主要步骤 |
|---|---|---|---|
| `build-macos` | `macos-latest` | push tag `v*` / 手动 | pnpm install → pnpm test → cargo test → build-dev.sh → 上传 DMG |
| `build-windows` | `windows-latest` | push tag `v*` / 手动 | pnpm install → pnpm test → cargo test → build-windows.ps1 → 上传 NSIS exe |
| `release` | `ubuntu-latest` | tag push 时（needs 两个 build job） | 下载两平台产物 → softprops/action-gh-release 创建 GitHub Release |

CI 关键约束：

- 使用 pnpm 11.17.0 + Node 22.13 + Rust stable
- `--frozen-lockfile` 严格按 lockfile 安装
- `cargo test --test-threads=1` 避免并发冲突
- `permissions: contents: write` 允许 Release 创建

### 8.6 TDM-GCC 维护（仅 Windows）

- **当前版本**：TDM-GCC 10.3.0-2 (tdm64)
- **升级流程**：修改 [scripts/prepare-tdm-gcc.ps1](../scripts/prepare-tdm-gcc.ps1) 中的 `$tdmUrl` 和 `$tdmVersion`，执行该脚本重新生成 `src-tauri/resources/tdm-gcc/`，然后将更新后的目录提交到仓库
- **精简策略**：删 GDB、mingw32-make、Fortran、LTO、32 位库、文档/locale/man
- **许可证**：GCC/binutils GPLv3+，libstdc++ 受 GCC Runtime Library Exception 保护（用户编译的程序不感染 GPL）

---

## 9. 跨平台实现差异

### 9.1 runner 子模块差异对比

| 维度 | Unix（unix.rs） | Windows（windows.rs） |
|---|---|---|
| 进程组 | `process_group(0)`，PGID == PID | `CREATE_NEW_PROCESS_GROUP` + `CREATE_NO_WINDOW` |
| CPU 限制 | `RLIMIT_CPU`（setrlimit in pre_exec） | `JobObject LIMIT_JOB_TIME` |
| 文件大小限制 | `RLIMIT_FSIZE`（有效） | 不实现（API 不支持） |
| 内存限制 | 不实现（RLIMIT_DATA 只接受 INFINITY） | 不实现 |
| 内存采集 | macOS: `proc_pid_rusage` 轮询 ri_resident_size；Linux: RUSAGE_CHILDREN 差值法 | `GetProcessMemoryInfo` 轮询 PeakWorkingSetSize |
| 进程组 kill | `kill(-PGID, SIGKILL)` | `TerminateJobObject` |
| 降级标志 | `job_object_degraded = false` | `AssignProcessToJobObject` 失败时 `true` |
| 可执行文件名 | `main` | `main.exe` |

### 9.2 编译器探测差异

| 平台 | 探测顺序 |
|---|---|
| Unix | `which("clang++")` → `which("g++)` |
| Windows | `find_bundled_mingw(resource_dir)`（优先 `resource_dir/tdm-gcc/bin/g++.exe`，回退 `CARGO_MANIFEST_DIR/resources/tdm-gcc/bin/g++.exe`）→ `which("g++.exe")` → `which("clang++.exe")` |

Windows 特殊处理：`strip_verbatim_prefix(path)` 去掉 `\\?\` 前缀，解决 g++ 内部无法定位 cc1plus 的问题。

### 9.3 PTY 实现差异

| 维度 | Unix | Windows |
|---|---|---|
| 底层实现 | `portable-pty`（forkpty） | `portable-pty`（ConPTY） |
| PTY kill | `kill(-pid, SIGKILL)` 杀整个进程组 | `TerminateProcess` 优先 → `is_process_alive` 检查 → `killer.kill()` 兜底 |
| PTY 读取线程退出 | 子进程退出后 read 返回 EOF，线程快速结束 | ConPTY 子进程退出后不返回 EOF，需 `drain_reader_with_timeout` 限时等待 |
| 内存轮询 | macOS `proc_pid_rusage` / Linux RUSAGE_CHILDREN | `GetProcessMemoryInfo` |

### 9.4 菜单与标题栏差异

| 平台 | 菜单 | 标题栏 |
|---|---|---|
| macOS | 保留原生系统菜单栏（RunCode / 文件 / 编辑 / 视图 / 窗口 / 帮助 6 大菜单） | 红绿灯按钮位置 (16.0, 20.0) |
| Windows | 移除原生菜单，用前端 [TitleBar.tsx](../src/components/TitleBar.tsx) 替代 | `tauri-plugin-decoration` 创建 HTML 窗口控制按钮（含 Snap Layout） |

菜单事件流转：

- macOS：原生菜单点击 → `on_menu_event` 钩子 → `app.emit("menu-{action}")` → 前端 `listen` 接收 → `menuHandlers` 分发
- Windows：前端 TitleBar 点击 → 直接调用 `menuHandlers[key]()`（也可通过 `emit` 走后端再回传）

### 9.5 键盘快捷键差异

| 平台 | 实现 |
|---|---|
| macOS | 原生菜单 accelerator 自动注册 |
| Windows | WebView2 劫持键盘事件导致原生菜单 accelerator 不触发（wry#451），在 webview 内用 capture 阶段 `keydown` 接管 |

跨平台运行快捷键（[App.tsx](../src/App.tsx) 的 `resolveRunShortcut` 纯函数统一处理）：

- **Cmd/Ctrl+Enter**：终端运行
- **Shift+Cmd/Ctrl+Enter**：多样例运行

---

## 10. 关键设计决策与约束

### 10.1 ADR 索引

| ADR | 决策 | 关键约束 |
|---|---|---|
| [ADR-0001](./adr/0001-tauri-tech-stack.md) | Tauri 2 + React 19 + Monaco 技术栈 | 后端用 Rust，不引入 Electron |
| [ADR-0002](./adr/0002-lyra-style-jetbrains-mono.md) | Lyra 全直角风格 + JetBrains Mono | UI 必须遵循此风格 |
| [ADR-0003](./adr/0003-test-settings-split-from-runtime.md) | TestSettings 独立结构 | 测试设置在 `AppSettings.test` 中 |
| [ADR-0004](./adr/0004-test-case-time-limit.md) | 测试时间限制机制 | `judge_case_passed` 纯函数 + 默认 1000ms |
| [ADR-0005](./adr/0005-lucide-react-icon-unification.md) | lucide-react 图标库统一 | 所有图标必须用 lucide-react |
| [ADR-0006](./adr/0006-runcode-brand-color-system.md) | RunCode 品牌色与主题令牌系统 | 品牌交互色必须用令牌，禁止散落 HEX；图标资产禁改 |

### 10.2 硬约束（不可违反）

1. **UI 风格**：Lyra 全直角（`--radius-*: 0px`），Graphite 中性灰 + RunCode Slate 品牌交互色，JetBrains Mono 统一字体
2. **依赖管理**：不引入新依赖除非用户明确要求；例外是 `tokio-util`（仅 `CancellationToken`，`default-features = false`）
3. **文件管理**：优先编辑现有文件，不主动创建新文件；不主动创建文档文件除非用户明确要求；修改前必须先 Read 文件
4. **功能哲学**：简化优先（删除不必要特性 > 添加新功能）；小范围 > 大重构；不添加未要求的错误处理 / 回退 / 配置项
5. **修改方式**：不主动添加 docstring / 注释到未修改代码；只在逻辑不自明处加注释；不创建一次性 helper / 工具函数

### 10.3 禁止区域

- `src-tauri/gen/` — 自动生成的 schema
- `Cargo.lock` / `pnpm-lock.yaml` — 除非用户明确要求
- `.trae/` 目录 — TRAE 配置
- `LICENSES/` — 字体与编译器许可证
- `src-tauri/icons/` — 应用图标资源

### 10.4 执行模型与安全说明

RunCode 以当前用户权限执行本地 C++ 代码，**不是恶意代码沙箱**。仅适合运行自己信任的本地教学代码。

**资源限制范围**：

- CPU 时间上限（防死循环）：macOS RLIMIT_CPU / Windows JobObject LIMIT_JOB_TIME
- 文件大小上限（防写爆磁盘）：仅 macOS RLIMIT_FSIZE，Windows 无等价 API
- 运行超时（硬杀进程）
- 测试时间限制（软判定，OI 评测用）

**不提供**：

- 内存限制（macOS RLIMIT_DATA/AS/RSS 无法生效，Windows 同样不实现）
- 沙箱隔离（不隔离文件系统访问、网络、子进程）
- 来源不明代码的安全审查

### 10.5 Git 协作规范

- 不主动 commit / push / 创建分支
- 不修改 git config
- 不运行 force push / reset --hard / clean -f 等破坏性命令（除非用户明确要求）
- 添加文件时优先按文件名添加，不用 `git add .` / `git add -A`
- 不 commit 含密钥的文件（.env / credentials）

### 10.6 代码引用方式

- **AI 对话中引用代码（本地开发）**：用 markdown 链接 `file:///` 协议
- **仓库内 Markdown 文档（README / ADR / docs/）**：必须用**相对路径**，确保 GitHub 上可跳转
- **现有 file:/// 绝对路径**：仓库 markdown 中已存在的属于历史遗留，应在文档维护时逐步转为相对路径

---

> 本文档基于 RunCode v1.1.0 代码库生成。如有疑问或发现文档与代码不一致，请以代码为准并提 issue 修正文档。
