# AGENTS.md — AI 协作规范

本文件供 AI 协作代理（如 Trae、Claude Code 等）在本项目中工作时遵循。

## 项目概览

RunCode 是一个轻量级跨平台 C++ 教学编辑器（macOS + Windows），基于 Tauri 2 + React 19 + Monaco Editor，专为 OI / 算法教学场景设计。支持多样例测试、时间限制判定、实时终端、代码格式化等教学核心功能。

**性能与轻量化目标**（硬约束）：

- 安装包体积保持在 ~10MB 级（macOS）/ ~15MB 级（Windows 含 TDM-GCC），不得显著膨胀
- 运行内存 ~100MB 级，不得引入常驻后台进程
- 启动时间秒级，不得引入启动期 IO 密集操作
- 不引入 Electron / Chromium 内核依赖
- 修改时优先考虑对体积/内存/启动时间的影响

## 技术栈

**前端**：React 19 + TypeScript 5.8 + Vite 7 + Tailwind 4 + Zustand 4 + lucide-react 1.26 + Monaco Editor 0.52 + react-resizable-panels 2.1 + Radix UI + xterm 6

**后端**：Rust 2021 edition + Tauri 2 + tokio + portable-pty + tree-sitter + serde + zip + walkdir + windows crate（Windows 平台 JobObject API，cfg(windows) 条件依赖）

**测试**：Vitest 4.1（前端）+ cargo test（后端）

**目录结构**：
- `src/` — 前端 React 代码
- `src-tauri/src/` — Rust 后端代码
- `src-tauri/src/commands/` — Tauri commands（前端 invoke 调用入口）
- `src-tauri/src/runner/` — 进程执行与资源限制（跨平台分发）
- `src-tauri/src/runner/unix.rs` — Unix 平台执行实现（process_group + setrlimit）
- `src-tauri/src/runner/windows.rs` — Windows 平台执行实现（JobObject + CPU 时间限制）
- `src-tauri/src/parser/` — tree-sitter 代码解析
- `src-tauri/resources/tdm-gcc/` — Windows 内置 TDM-GCC（已提交到仓库，clone 后即用）
- `src/components/` — React 组件
- `src/hooks/` — Zustand store hooks
- `src/locales/` — i18n 文案（zh / en）
- `scripts/prepare-tdm-gcc.ps1` — TDM-GCC 升级工具（仅版本升级时使用，日常构建不需要）
- `scripts/build-windows.ps1` — Windows 一键构建脚本

## 硬约束（不可违反）

### 1. UI 风格

- **Lyra 全直角风格**：所有圆角为 0（`--radius-*: 0px`）
- **Graphite 中性灰 + RunCode Slate 品牌交互色**：dark / light / system 三主题（详见 ADR-0006）
  - 中性灰用于背景、面板、普通工具按钮、标题与正文
  - 品牌交互色（`--primary` 等）用于标志、主操作按钮、Switch 选中、Tabs 活动态、活动文件标签、面板标签、拖拽分隔条、测试运行中状态、进度条、表单焦点环
  - 停止按钮保留错误红，禁止品牌蓝泛滥
  - 组件优先使用 CSS 变量 / Tailwind 主题 token，禁止散落品牌 HEX
  - Code Teal 仅用于品牌指南与宣传材料，不进入核心 UI 状态
- **JetBrains Mono 统一字体**：UI 与代码用同一字体（详见 ADR-0002）
- 优先复用现有组件，胶囊形按钮（实际无圆角）+ 微妙 hover 效果 + 字体层级

### 2. 依赖管理

- **不引入新依赖**，除非用户明确要求
- 优先使用现有库（如 lucide-react 图标库、Radix UI primitives、Zustand 状态管理）

### 3. 文件管理

- **优先编辑现有文件**，不主动创建新文件
- **不主动创建文档文件**（*.md / README），除非用户明确要求
- 修改前必须先 Read 文件理解上下文

### 4. 功能哲学

- **简化优先**：删除不必要特性 > 添加新功能
- **小范围 > 大重构**：直接修改 > 复杂 workaround
- 不添加未要求的错误处理、回退、配置项
- 不为假设的未来需求设计

### 5. 修改方式

- 修改前必须先 Read 文件
- 不主动添加 docstring / 注释到未修改的代码
- 只在逻辑不自明处加注释
- 不创建一次性 helper / 工具函数

## 测试要求

### 自动测试

每次修改后必须运行并确保通过：

```bash
pnpm test                    # 前端 Vitest
cd src-tauri && cargo test   # 后端 Rust 测试
```

### 测试覆盖

- 新功能 / bug 修复必须添加测试
- 前端测试用 Vitest + @testing-library/react（参考 [src/App.test.tsx](file:///Users/mymac/工作站/c++ide/src/App.test.tsx)、[src/components/SettingsPanel.test.tsx](file:///Users/mymac/工作站/c++ide/src/components/SettingsPanel.test.tsx)、[src/locales/i18n.test.ts](file:///Users/mymac/工作站/c++ide/src/locales/i18n.test.ts)）
- 后端测试用 `#[cfg(test)] mod tests`（参考 [src-tauri/src/settings.rs](file:///Users/mymac/工作站/c++ide/src-tauri/src/settings.rs)、[src-tauri/src/commands/test_runner.rs](file:///Users/mymac/工作站/c++ide/src-tauri/src/commands/test_runner.rs)）
- 纯函数优先（便于单元测试，参考 `judge_case_passed`）

### 验证不等式

**测试通过 ≠ 验收通过**。真实 UI 验收（菜单点击、拖拽、视觉一致性）必须人工确认。

## 禁止区域

- `src-tauri/gen/` — 自动生成的 schema，不要手动修改
- `Cargo.lock` / `pnpm-lock.yaml` — 除非用户明确要求
- `.trae/` 目录 — TRAE 配置
- `LICENSES/` — 字体与编译器许可证（JetBrains Mono / TDM-GCC）
- `src-tauri/icons/` — 应用图标资源

## 关键决策（详见 ADR）

| ADR | 决策 | 关键约束 |
|---|---|---|
| [ADR-0001](docs/adr/0001-tauri-tech-stack.md) | Tauri 2 + React 19 + Monaco 技术栈 | 后端用 Rust，不引入 Electron |
| [ADR-0002](docs/adr/0002-lyra-style-jetbrains-mono.md) | Lyra 全直角风格 + JetBrains Mono | UI 必须遵循此风格 |
| [ADR-0003](docs/adr/0003-test-settings-split-from-runtime.md) | TestSettings 独立结构 | 测试设置在 `AppSettings.test` 中 |
| [ADR-0004](docs/adr/0004-test-case-time-limit.md) | 测试时间限制机制 | judge_case_passed 纯函数 + 默认 1000ms |
| [ADR-0005](docs/adr/0005-lucide-react-icon-unification.md) | lucide-react 图标库统一 | 所有图标必须用 lucide-react |
| [ADR-0006](docs/adr/0006-runcode-brand-color-system.md) | RunCode 品牌色与主题令牌系统 | 品牌交互色必须用令牌，禁止散落 HEX；图标资产禁改 |

## Git 协作规范

- **不主动 commit / push / 创建分支**
- **不修改 git config**
- **不运行 force push / reset --hard / clean -f 等破坏性命令**（除非用户明确要求）
- commit 仅在用户明确要求时进行
- 添加文件时优先按文件名添加，不用 `git add .` / `git add -A`
- 不 commit 含密钥的文件（.env / credentials）

## 回应语言

- 始终使用用户最新消息的语言回应
- 代码注释遵循同一规则

## 代码引用方式

### AI 对话中引用代码（本地开发）

引用本机代码时用 markdown 链接 `file:///` 协议：

- 文件：`[link text](file:///absolute/path/to/file)`
- 行范围：`[link text](file:///absolute/path/to/file#L123-L145)`
- 链接文本用 basename，不用反引号包裹

### 仓库内 Markdown 文档（README / ADR / docs/）

仓库内文档中的引用必须用**相对路径**，确保 GitHub 上可跳转：

- 从 `docs/adr/` 引用根目录文件：`[Cargo.toml](../../src-tauri/Cargo.toml)`
- 从根目录 `README.md` 引用：`[BUILD.md](./BUILD.md)`
- **禁止**在仓库 markdown 中使用 `file:///Users/...` 绝对路径

### 现有 file:/// 绝对路径

仓库 markdown 中已存在的 `file:///` 绝对路径属于历史遗留，应在文档维护时逐步转为相对路径。
