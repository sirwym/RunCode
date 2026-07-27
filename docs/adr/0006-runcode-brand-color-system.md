# 0006. RunCode 品牌色与主题令牌系统

- **Status**: Accepted
- **Date**: 2026-07-27

## Context and Problem Statement

[ADR-0002](0002-lyra-style-jetbrains-mono.md) 确立了 Lyra 全直角风格 + JetBrains Mono 统一字体，但配色只规定“中性灰”，未明确品牌交互色。原有实现存在以下问题：

- 语义分裂：`--primary` 表示黑白中性色，`--accent` 表示品牌蓝，命名与 Tailwind / shadcn 约定相反，跨组件复用困难。
- 散落 HEX/RGBA：测试卡片、提示框、状态标签各自硬编码颜色值，主题切换时易漏改。
- 品牌色缺位：标志、主操作按钮、活动标签、拖拽分隔条、运行中状态等关键交互没有统一品牌色，界面以中性灰为主，识别度低。
- Monaco 与 xterm 与软件主题脱节：编辑器光标、选区、终端光标、ANSI blue 仍使用 VS Code 默认蓝，与 RunCode 标志的 `#365EAA` 不一致。

需要确立正式的品牌色系统，统一交互令牌，覆盖 CSS、Tailwind、Monaco、xterm 四个层面，且不引入设置迁移。

## Decision Drivers

- 品牌识别度：教学工具应具备稳定可辨的视觉品牌
- 一致性：UI、编辑器、终端、标志使用同一组交互色
- 可维护性：单一令牌源，组件禁止硬编码品牌 HEX
- 主题适配：Dark / Light / System 三主题均需达到 WCAG AA 对比度
- 设置稳定性：不修改持久化 schema，不引入迁移成本
- 与 [ADR-0002](0002-lyra-style-jetbrains-mono.md) Lyra 全直角风格兼容

## Considered Options

- 方案 A：保持现状，仅修文档说明“中性灰即品牌色”
- 方案 B：引入完整品牌色系统（RunCode Slate + Graphite + Code Teal），统一令牌并覆盖 Monaco/xterm
- 方案 C：采用第三方设计系统（如 VS Code 主题色 `#007ACC`）

## Decision Outcome

**Chosen option**: 方案 B — RunCode 品牌色系统

**理由**：
- 标志像素统计确认主色为 `#365EAA`（RunCode Slate），与 VS Code 默认蓝 `#007ACC` 有明显区分，建立独立品牌识别
- Graphite 中性灰继承 [ADR-0002](0002-lyra-style-jetbrains-mono.md) 的 Lyra 风格，保持教学严肃审美
- 令牌系统覆盖 CSS / Tailwind / Monaco / xterm 四层，单一来源便于维护
- 持久化设置仍保存 `vs-dark` / `vs` / `hc-black`，渲染层映射到 `runcode-*` 继承主题，零迁移成本

### 品牌系统

| 角色 | 标准色 | 深色阶 | 浅色阶 | 使用范围 |
|---|---|---|---|---|
| Primary / RunCode Slate | `#365EAA` | `#2F5498` | `#4A74C6` | 标志、主操作、选中、焦点 |
| Secondary / Graphite | `#1C1C1C` | `#0A0A0A` | `#F5F5F5` | 应用背景、面板、品牌底色 |
| Accent / Code Teal | `#2D7F78` | `#24716B` | `#48A69B` | 品牌指南、图表和宣传材料；不进入核心操作状态 |

### 主题映射

- **Light**：主操作 `#365EAA`、hover `#2F5498`、soft `rgba(54,94,170,.10)`、focus `#365EAA`
- **Dark**：主操作 `#3B65B8`（适配色）、hover `#4A74C6`、soft `rgba(74,116,198,.14)`、focus `#6F91D5`
  - 深色适配色与白字对比度 `5.62:1`（WCAG AA），与 `#1C1C1C` 面板背景对比度 `3.03:1`（满足 UI 组件边界）
- **System**：跟随系统偏好切换 Light / Dark 映射
- **语义色独立**：Dark 成功 `#4ADE80` / 警告 `#FACC15` / 错误 `#F87171`；Light `#15803D` / `#A16207` / `#B91C1C`
- **Code Teal 边界**：不用于成功、运行中或信息状态，避免一色多义

### 正向后果

- 标志、主操作、活动标签、拖拽分隔条、运行中状态、进度条统一使用 RunCode Slate，建立稳定品牌识别
- 单一令牌源（`global.css` 的 `--primary` 等）驱动 CSS、Tailwind、Monaco、xterm，主题切换无遗漏
- 持久化 schema 不变，老用户设置无感升级
- Dark 适配色通过 WCAG AA 验证（焦点环与组件边界 ≥ `3:1`，主文字 ≥ `4.5:1`）

### 负向后果

- Dark 主题品牌色 `#3B65B8` 与标志原色 `#365EAA` 略有差异（为对比度适配），需在品牌指南中明确说明
- Code Teal 不进入核心 UI，仅用于宣传材料，可能造成“品牌色未充分利用”的错觉

### 引入的约束

- **令牌单一来源**：所有品牌交互色必须使用 `global.css` 中的 `--primary` / `--primary-hover` / `--primary-foreground` / `--primary-soft` / `--primary-border` / `--focus-ring` / `--selection` 令牌
- **禁止散落 HEX**：CSS 与 React 组件代码不得硬编码品牌 HEX，必须通过 CSS 变量或 Tailwind 主题 token 引用
- **运行时适配层例外**：Monaco 与 xterm 属于运行时适配层，主题 API 需直接提供颜色字符串，无法消费 CSS 变量。允许在 `Editor.tsx` / `Terminal.tsx` 中以 `export const` 集中定义颜色映射常量，但必须：
  - 颜色值与 `global.css` / 品牌指南 / 本 ADR 中的品牌令牌完全一致
  - 有对应测试文件（`Editor.test.ts` / `Terminal.test.ts`）验证颜色值精确性
  - Monaco `colors` 字段仅接受 HEX（3/4/6/8 位），禁止 `rgba()`，半透明色使用 8 位 HEX（`#RRGGBBAA`）
- **令牌同步**：`tailwind.css` 的 `@theme inline` 必须与 `global.css` 令牌一一对应
- **Monaco 渲染层映射**：持久化值 `vs-dark` / `vs` / `hc-black` 经 `mapMonacoTheme` 映射到 `runcode-dark` / `runcode-light` / `hc-black`，禁止修改持久化值
- **xterm 限定覆盖**：仅调整光标、选区、ANSI blue / brightBlue，其他 ANSI 颜色与终端行为保持不变
- **图标资产冻结**：当前蓝色图标是本 ADR 生效前完成的一次性品牌迁移结果；ADR 生效后 `src-tauri/icons/` 全部资产冻结，不得重新导出或调整几何
- **主色采样基准**：品牌基准色 `#365EAA` 来自 `src-tauri/icons/128x128.png` 中最大的非白色精确像素值；Graphite 与 Code Teal 是为品牌系统选定的辅助色，并非采样自图标
- **Code Teal 边界**：禁止用于成功 / 运行中 / 信息状态，仅用于品牌指南、图表、宣传材料

### 图标迁移记录

当前蓝色图标（`src-tauri/icons/` 全部资产）是 ADR-0006 生效前完成的一次性品牌迁移结果，目的是将应用图标与 RunCode Slate 主色 `#365EAA` 对齐。该迁移在 ADR 生效前已完成，ADR 生效后图标资产冻结，不得再次修改。如需变更图标，须先发起新 ADR 评审。

## Pros and Cons of the Options

### 方案 A：保持现状

- 优点：零改动成本
- 缺点：品牌识别度低、令牌语义分裂、Monaco/xterm 与软件主题脱节
- 不选原因：未解决核心问题

### 方案 B：RunCode 品牌色系统

- 优点：统一令牌、覆盖四层、零迁移成本、WCAG AA 达标
- 缺点：Dark 适配色与标志原色略有差异，需文档说明
- 选择原因：综合识别度、可维护性、迁移成本最优

### 方案 C：采用 VS Code 主题色 `#007ACC`

- 优点：与 VS Code 生态一致，用户熟悉
- 缺点：与 VS Code 强绑定，缺乏独立品牌识别；与 RunCode 标志 `#365EAA` 不一致
- 不选原因：损害品牌独立性

## More Information

- 品牌色采样结论、对比度计算、标志留白与禁止用法详见 [品牌指南](../brand-guidelines.md)
- 相关文件：
  - [src/styles/global.css](../../src/styles/global.css) — CSS 变量定义
  - [src/styles/tailwind.css](../../src/styles/tailwind.css) — Tailwind 主题 token 映射
  - [src/components/Editor.tsx](../../src/components/Editor.tsx) — Monaco `runcode-dark` / `runcode-light` 继承主题
  - [src/components/Terminal.tsx](../../src/components/Terminal.tsx) — xterm 光标 / 选区 / ANSI blue 配色
  - [src/components/ui/button.tsx](../../src/components/ui/button.tsx) — 主操作按钮品牌蓝
- 关联 ADR：[ADR-0002](0002-lyra-style-jetbrains-mono.md) Lyra 全直角风格 + JetBrains Mono
