# 0005. lucide-react 图标库统一

- **Status**: Accepted
- **Date**: 2026-07-26

## Context and Problem Statement

Round 19 之前，项目存在两种图标使用方式：

- 部分组件已用 `lucide-react`（TabBar / StatusBar / TestCasesPanel / RecentFilesDialog / ui/dialog / ui/select）
- 部分位置用 Unicode 字符（`×` `●` `✓` `✗` `⚠` `+`）作为图标

导致视觉风格不统一（字体渲染的 Unicode 与 SVG 图标粗细/对齐不一致）。

## Decision Drivers

- 视觉一致性（所有图标用同一套 SVG 风格）
- 与 Lyra 全直角风格的协调（lucide 是统一描边粗细的细线 SVG，符合极简风）
- 维护成本（统一图标库后修改更可控）
- 包体积（lucide-react 按需引入，tree-shaking 友好）

## Considered Options

- 方案 A：保留 Unicode 字符 + 部分用 lucide-react
- 方案 B：全部用 lucide-react，剥离 Unicode 符号
- 方案 C：自建 SVG 图标组件库

## Decision Outcome

**Chosen option**: 方案 B — 全部用 lucide-react，剥离 Unicode 符号

### 正向后果

- 所有图标视觉风格统一（统一描边粗细的细线 SVG）
- 与 Lyra 全直角风格协调
- 图标尺寸通过 `size` prop 精确控制（Unicode 字符依赖 font-size）
- i18n 文案剥离符号后更纯粹（如 `tests.badgePass` 从 `"✓ 通过"` 改为 `"通过"`，图标在 JSX 中插入）

### 负向后果

- 包体积略增（lucide-react 按需引入影响小）
- 需要维护 import 列表

### 引入的约束

- **所有图标必须用 lucide-react**，禁止用 Unicode 字符（`× ● ✓ ✗ ⚠ +` 等）作为 UI 图标
- 图标尺寸约定：
  - 按钮 icon-only：`size={14}`
  - badge / inline 提示：`size={12}`
  - 小圆点（dirty 标记）：`size={8}`
- i18n 文案不得包含图标符号（符号在 JSX 中通过图标组件插入）
- 新增组件如需图标，从 lucide-react 选取

**适用范围说明**：

- 「UI 图标」指按钮、badge、tab 标记等装饰性图标位置
- **不包含**：CSS 实现的状态点（如 `.status-dot` 用 `border-radius: 50%`）、文案标点（如 `—` `…` `·`）、数学符号、C++ 代码内容
- 实心圆点（如 tab dirty 标记）需要用 `<Circle fill="currentColor" stroke="none" />` 实现，否则默认为空心圆

## Pros and Cons of the Options

### 方案 A：保留 Unicode + 部分 lucide

- 优点：改动小
- 缺点：视觉不统一、字体渲染差异
- 不选原因：风格不一致

### 方案 B：全部 lucide-react

- 优点：统一、与 Lyra 风格协调、可维护
- 缺点：需要 import 管理
- 选择原因：视觉一致性是硬要求

### 方案 C：自建 SVG 图标库

- 优点：完全可控
- 缺点：维护成本高、重复造轮子
- 不选原因：过度工程化

## More Information

- lucide 官网：https://lucide.dev
- 相关文件：[src/App.tsx](../../src/App.tsx)、[src/components/TabBar.tsx](../../src/components/TabBar.tsx)、[src/components/TestCasesPanel.tsx](../../src/components/TestCasesPanel.tsx)
- 依赖：`lucide-react@^1.26.0`（见 [package.json:31](../../package.json#L31)）
