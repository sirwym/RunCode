# RunCode 品牌指南

> RunCode 是一款专业、沉稳的 C++ 教学开发工具，专为 OI / 算法教学场景设计。本指南定义品牌定位、色彩系统、标志使用与禁止用法，确保所有触点（应用界面、文档、宣传材料）保持一致的视觉识别。

## 1. 品牌定位

| 维度 | 描述 |
|---|---|
| **使命** | 让 C++ 教学更专注、更可靠、更轻盈 |
| **核心场景** | 中学 OI / 信息学竞赛 / 高校算法课程 |
| **用户画像** | 信息学教师、竞赛选手、初学 C++ 的学生 |
| **气质关键词** | 专业、沉稳、教学严谨、轻量、不张扬 |
| **差异化** | 原生桌面体验 + 多样例测试 + 时间限制判定 + Lyra 全直角风格 |

品牌色与视觉风格服务于「教学严肃感」与「工具可靠性」，避免使用饱和度过高的色相或装饰性渐变。

## 2. 标志主色采样

RunCode 标志以 [src-tauri/icons/128x128.png](../src-tauri/icons/128x128.png) 为权威资产。主色采样自当前高分辨率图标中最大的非白色精确像素值：

| 角色 | HEX | RGB | 采样说明 |
|---|---|---|---|
| **Primary / RunCode Slate** | `#365EAA` | `rgb(54, 94, 170)` | 当前图标中最大的非白色精确像素值 |
| **Secondary / Graphite** | `#1C1C1C` | `rgb(28, 28, 28)` | 为品牌系统选定的辅助色（中性灰） |
| **Accent / Code Teal** | `#2D7F78` | `rgb(45, 127, 120)` | 为品牌系统选定的辅助色（仅限品牌材料） |

**采样约束**：
- `src-tauri/icons/128x128.png` 为唯一采样基准，禁止从截图重新取色
- Graphite 与 Code Teal 是为品牌系统选定的辅助色，并非采样自当前图标
- 主色 HEX 不得修改；如需调整须先更新本指南并同步 [ADR-0006](./adr/0006-runcode-brand-color-system.md)

**图标资产说明**：
当前蓝色图标是 ADR-0006 生效前完成的一次性品牌迁移结果。ADR-0006 生效后，`src-tauri/icons/` 全部资产冻结，不得再次修改。详见 [ADR-0006 — 图标迁移记录](./adr/0006-runcode-brand-color-system.md)。

## 3. 色彩系统

### 3.1 Primary / RunCode Slate（主交互色）

用于标志、主操作按钮、Switch 选中、Tabs 活动态、活动文件标签、面板拖拽分隔条、运行中状态、进度条、表单焦点环。

| 角色 | Light | Dark |
|---|---|---|
| Base | `#365EAA` | `#3B65B8`（适配色，深色背景对比度优化） |
| Hover | `#2F5498` | `#4A74C6` |
| Foreground（文字） | `#FFFFFF` | `#FFFFFF` |
| Soft（背景填充） | `rgba(54, 94, 170, .10)` | `rgba(74, 116, 198, .14)` |
| Border | `rgba(54, 94, 170, .40)` | `rgba(74, 116, 198, .40)` |
| Focus Ring | `#365EAA` | `#6F91D5` |

**Dark 适配色说明**：`#3B65B8` 是 RunCode Slate 在深色背景上的对比度适配版本，与白字组合达到 `5.62:1` 对比度（满足 WCAG AA），与 `#1C1C1C` 背景达到 `3.03:1`（满足 UI 组件边界对比度）。Light 主题使用原色 `#365EAA`，与白字达到 `6.29:1`。

### 3.2 Secondary / Graphite（中性灰背景色）

为品牌系统选定的辅助色，用于应用背景、面板、普通工具按钮、标题与正文。

| 角色 | Light | Dark |
|---|---|---|
| App Background | `#F5F5F5` | `#0A0A0A` |
| Panel Background | `#FFFFFF` | `#1C1C1C` |
| Panel Background Alt | `#FAFAFA` | `#161616` |
| Border | `#E0E0E0` | `#3A3A3A` |
| Text | `#1C1C1C` | `#E0E0E0` |
| Text Muted | `#6B6B6B` | `#8A8A8A` |

### 3.3 Accent / Code Teal（仅限品牌材料）

为品牌系统选定的辅助色。**禁止用于核心 UI 状态**。仅用于品牌指南、图表、宣传海报、官方网站装饰元素。

| 角色 | Light | Dark |
|---|---|---|
| Base | `#2D7F78` | `#24716B` |
| Hover | `#24716B` | `#1F625D` |
| Soft | `rgba(45, 127, 120, .10)` | `rgba(48, 167, 156, .12)` |

**Code Teal 不得用于**：
- 成功状态（使用 Success 语义色 `#15803D` / `#4ADE80`）
- 运行中状态（使用 Primary RunCode Slate）
- 信息提示（使用 Primary Soft）
- 任何按钮、Switch、Tab、进度条等核心交互控件

### 3.4 语义色

独立于品牌色，用于状态反馈。集中定义于 [src/styles/global.css](../src/styles/global.css)，禁止散落 HEX。

| 语义 | Light | Dark | 用途 |
|---|---|---|---|
| **Success** | `#15803D` | `#4ADE80` | 测试通过、编译成功、运行完成 |
| **Success Soft** | `rgba(21, 128, 61, .10)` | `rgba(74, 222, 128, .12)` | 通过状态背景 |
| **Success Border** | `rgba(21, 128, 61, .40)` | `rgba(74, 222, 128, .40)` | 通过状态边框 |
| **Warning** | `#A16207` | `#FACC15` | 警告、超时 |
| **Warning Soft** | `rgba(161, 98, 7, .10)` | `rgba(250, 204, 21, .12)` | 警告背景 |
| **Warning Border** | `rgba(161, 98, 7, .40)` | `rgba(250, 204, 21, .40)` | 警告边框 |
| **Error** | `#B91C1C` | `#F87171` | 失败、编译错误、停止按钮 |
| **Error Soft** | `rgba(185, 28, 28, .10)` | `rgba(248, 113, 113, .12)` | 失败背景 |
| **Error Border** | `rgba(185, 28, 28, .40)` | `rgba(248, 113, 113, .40)` | 失败边框 |

## 4. 主题映射

RunCode 支持 Dark / Light / System 三主题。System 跟随操作系统偏好切换 Dark / Light 映射。

### 4.1 CSS 变量映射

所有品牌交互色通过 CSS 变量驱动（详见 [src/styles/global.css](../src/styles/global.css)）：

```css
:root {
  --primary: #3B65B8;          /* Dark */
  --primary-hover: #4A74C6;
  --primary-foreground: #FFFFFF;
  --primary-soft: rgba(74, 116, 198, .14);
  --primary-border: rgba(74, 116, 198, .40);
  --focus-ring: #6F91D5;
  --selection: rgba(74, 116, 198, .30);
}

:root[data-theme="light"] {
  --primary: #365EAA;
  --primary-hover: #2F5498;
  --primary-foreground: #FFFFFF;
  --primary-soft: rgba(54, 94, 170, .10);
  --primary-border: rgba(54, 94, 170, .40);
  --focus-ring: #365EAA;
  --selection: rgba(54, 94, 170, .25);
}
```

### 4.2 Tailwind 主题令牌

[src/styles/tailwind.css](../src/styles/tailwind.css) 的 `@theme inline` 将 CSS 变量映射为 Tailwind 主题 token，组件通过 `bg-primary` / `text-primary-foreground` / `ring-focus-ring` 等 class 引用，禁止散落 HEX。

### 4.3 运行时适配层（Monaco 与 xterm）

Monaco 编辑器与 xterm 终端属于**运行时适配层**：它们的主题 API 需要直接提供颜色字符串（HEX 或 rgba），无法消费 CSS 变量。因此允许在 [src/components/Editor.tsx](../src/components/Editor.tsx) 与 [src/components/Terminal.tsx](../src/components/Terminal.tsx) 中保留集中定义的颜色映射常量，但必须满足以下约束：

1. **集中定义**：颜色常量必须以 `export const` 形式集中定义在组件文件顶部，禁止散落在组件内部
2. **令牌一致**：常量值必须与 `global.css` / 本指南 / ADR-0006 中的品牌令牌完全一致
3. **测试覆盖**：必须有对应测试文件验证颜色值的精确性（见 [Editor.test.ts](../src/components/Editor.test.ts) 与 [Terminal.test.ts](../src/components/Terminal.test.ts)）
4. **Monaco HEX 约束**：Monaco `colors` 字段仅接受 HEX（3/4/6/8 位），`rgba()` 会被忽略并回退到默认色（红色），半透明色必须使用 8 位 HEX（`#RRGGBBAA`）

**Monaco 主题映射**：`editor.theme` 字段已废弃（保留在 schema 但渲染层不读），渲染层由 `general.theme` 派生的 `effectiveTheme` 决定，经 `mapMonacoTheme` 映射到 `runcode-dark`（dark） / `runcode-light`（light）。`hc-black` 不再暴露给用户，老配置里的值会被忽略。

| 主题键 | Light HEX | Dark HEX |
|---|---|---|
| `editorCursor.foreground` | `#365EAA` | `#6F91D5` |
| `editor.selectionBackground` | `#365EAA40` | `#4A74C64D` |
| `editor.inactiveSelectionBackground` | `#365EAA1F` | `#4A74C626` |
| `editor.selectionHighlightBackground` | `#365EAA2E` | `#4A74C633` |
| `editor.lineHighlightBackground` | `#365EAA0F` | `#4A74C61A` |
| `editor.focusBorder` | `#365EAA` | `#6F91D5` |
| `editorBracketMatch.border` | `#365EAA` | `#6F91D5` |

**xterm 主题映射**：仅调整光标、选区、ANSI blue / brightBlue，其他 ANSI 颜色保持不变。

| 键 | Light | Dark |
|---|---|---|
| `cursor` | `#365EAA` | `#6F91D5` |
| `selectionBackground` | `rgba(54, 94, 170, .25)` | `rgba(74, 116, 198, .30)` |
| `blue` | `#365EAA` | `#3B65B8` |
| `brightBlue` | `#2F5498` | `#4A74C6` |

## 5. 对比度

所有对比度基于 WCAG 2.1 相对亮度公式计算（`L = 0.2126*R + 0.7152*G + 0.0722*B`，其中 `R/G/B` 为线性化后的通道值），对比度 = `(L1+0.05)/(L2+0.05)`。以下数值可通过 [src/styles/global.css](../src/styles/global.css) 中的 HEX 值复算。

| 组合 | Light | Dark | 比值 | 等级 |
|---|---|---|---|---|
| 主操作按钮文字 / 背景 | `#FFFFFF` / `#365EAA` | `#FFFFFF` / `#3B65B8` | 6.29 : 1 / 5.62 : 1 | AA |
| 主操作按钮 hover 文字 / 背景 | `#FFFFFF` / `#2F5498` | `#FFFFFF` / `#4A74C6` | 7.39 : 1 / 4.56 : 1 | AA |
| 焦点环 / 面板背景 | `#365EAA` / `#FFFFFF` | `#6F91D5` / `#1C1C1C` | 6.29 : 1 / 5.43 : 1 | AA |
| 正文文字 / 面板背景 | `#1C1C1C` / `#FFFFFF` | `#E0E0E0` / `#1C1C1C` | 17.04 : 1 / 12.91 : 1 | AAA |
| 次要文字 / 面板背景 | `#6B6B6B` / `#FFFFFF` | `#8A8A8A` / `#1C1C1C` | 5.33 : 1 / 4.94 : 1 | AA |
| Dark Primary / 面板背景（组件边界） | — | `#3B65B8` / `#1C1C1C` | — / 3.03 : 1 | UI 组件 |

## 6. 标志留白

标志周围必须保留不小于标志高度 25% 的留白空间。留白区域内不得放置文字、图标、按钮或其他视觉元素。

| 用途 | 最小尺寸 | 留白 |
|---|---|---|
| 应用图标（macOS Dock） | 512×512 px（资产） | 系统自动留白 |
| README 顶部 | 96×96 px | 周围 24px |
| 文档页眉 | 48×48 px | 周围 12px |
| 宣传材料 | ≥ 128×128 px | 标志高度 25% |

标志背景必须为纯色（Graphite 中性灰或白色），禁止置于渐变、图案、照片之上。

## 7. 禁止用法

### 7.1 颜色禁止

- **禁止修改主色 HEX**：`#365EAA` / `#3B65B8` 为权威值，如需调整须先更新本指南并同步 ADR-0006
- **禁止散落 HEX**：CSS 与 React 组件代码不得硬编码品牌 HEX，必须通过 CSS 变量或 Tailwind 主题 token 引用
- **运行时适配层例外**：Monaco 与 xterm 需直接提供颜色字符串，允许集中定义颜色常量，但必须有测试覆盖且与品牌令牌一致
- **禁止 Code Teal 用于核心 UI 状态**：成功 / 运行中 / 信息状态不得使用 Code Teal
- **禁止品牌蓝泛滥**：停止按钮必须使用 Error 红，不得使用 Primary 蓝
- **禁止一色多义**：每种状态使用对应语义色，不得用品牌蓝替代成功 / 警告 / 错误

### 7.2 标志禁止

- **禁止重新导出图标资产**：`src-tauri/icons/` 全部资产在 ADR-0006 生效后冻结，不得再次修改
- **禁止从抗锯齿边缘取色**：主色采样自当前图标中最大的非白色精确像素值
- **禁止拉伸 / 旋转 / 倾斜标志**
- **禁止为标志添加阴影 / 描边 / 滤镜**（系统自动生成的 Dock 阴影除外）
- **禁止将标志置于低对比度或装饰性背景**

### 7.3 主题禁止

- **禁止独立设置编辑器主题**：`editor.theme` 字段已废弃，渲染层完全由 `general.theme` 派生。UI 上只有"软件主题"一个入口（dark / light / system）
- **禁止 Monaco colors 使用 rgba()**：必须使用 8 位 HEX（`#RRGGBBAA`），否则会回退到默认色（红色）
- **禁止 hc-black 主题品牌化**：`hc-black` 不再暴露给用户；老配置里的 `hc-black` 值会被忽略，自动跟随软件主题

## 8. 相关文档

- [ADR-0006 — RunCode 品牌色与主题令牌系统](./adr/0006-runcode-brand-color-system.md)
- [ADR-0002 — Lyra 全直角风格 + JetBrains Mono](./adr/0002-lyra-style-jetbrains-mono.md)
- [AGENTS.md — AI 协作规范](../AGENTS.md)
- [src/styles/global.css](../src/styles/global.css) — CSS 变量定义
- [src/styles/tailwind.css](../src/styles/tailwind.css) — Tailwind 主题 token 映射
- [src/components/Editor.tsx](../src/components/Editor.tsx) — Monaco 继承主题（运行时适配层）
- [src/components/Terminal.tsx](../src/components/Terminal.tsx) — xterm 配色（运行时适配层）
- [src/components/Editor.test.ts](../src/components/Editor.test.ts) — Monaco 主题颜色测试
- [src/components/Terminal.test.ts](../src/components/Terminal.test.ts) — xterm 主题颜色测试
