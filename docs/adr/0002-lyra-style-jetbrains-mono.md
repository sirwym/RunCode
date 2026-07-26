# 0002. 采用 Lyra 全直角风格 + JetBrains Mono 统一字体

- **Status**: Accepted
- **Date**: 2025-02-01 (Retrospective)

## Context and Problem Statement

UI 设计语言需要明确：

- 教学场景的严肃审美（避免花哨圆角和强对比配色）
- UI 字体与代码字体是否分离的取舍
- 长时间编码的视觉舒适度
- 主题切换（dark / light / system）的统一性

## Decision Drivers

- 视觉一致性（UI 与代码字体是否统一）
- 教学严肃性（避免分散注意力的装饰）
- 中文字形 fallback
- 长时间使用疲劳度

## Considered Options

- 方案 A：shadcn 默认风格 + Inter UI 字体 + JetBrains Mono 代码字体
- 方案 B：Lyra 全直角风格 + JetBrains Mono 统一字体
- 方案 C：Material Design 3 + Roboto 字体

## Decision Outcome

**Chosen option**: 方案 B — Lyra 全直角风格 + JetBrains Mono 统一字体

### 正向后果

- UI 与代码字体统一，视觉过渡自然（无字体切换跳变）
- 中性灰配色对眼睛友好，长时间使用不易疲劳
- 全直角风格符合教学严肃审美，区别于消费类应用
- JetBrains Mono 在中文 fallback 时表现稳定（PingFang SC / Hiragino Sans GB / Microsoft YaHei）

### 负向后果

- 全直角风格对小屏元素的可点击感稍弱（用 hover 反馈补偿）
- JetBrains Mono 的中文显示依赖系统字体，跨平台显示略有差异

### 引入的约束

- 所有圆角变量必须为 0：`--radius-sm: 0px; --radius-md: 0px; --radius-lg: 0px; --radius-pill: 0px;`（见 [global.css:36-39](../../src/styles/global.css#L36-L39)）
- 所有 UI 元素必须用 JetBrains Mono：`--font-ui: "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, ...`（见 [global.css:42-44](../../src/styles/global.css#L42-L44)）
- 新增组件必须遵循全直角风格（border-radius: 0 或继承 CSS 变量）
- 配色必须用 CSS 变量（`--bg` / `--panel-bg` / `--text` 等），不硬编码

## Pros and Cons of the Options

### 方案 A：shadcn 默认 + Inter + JetBrains Mono

- 优点：UI 字体（Inter）阅读性好、shadcn 默认风格熟悉
- 缺点：UI 与代码字体不一致导致视觉跳变、Inter 中文 fallback 一般
- 不选原因：字体跳变影响编辑器沉浸感

### 方案 B：Lyra 全直角 + JetBrains Mono 统一

- 优点：视觉统一、教学严肃、配色对眼睛友好
- 缺点：全直角对触摸目标稍弱（桌面应用影响小）
- 选择原因：教学场景需要严肃统一的视觉

### 方案 C：Material Design 3 + Roboto

- 优点：现代感强、组件规范完整
- 缺点：圆角风格鲜明不符合教学严肃审美、Roboto 中文显示一般
- 不选原因：风格与教学场景不匹配

## More Information

- 字体许可证：[LICENSES/JetBrainsMono-OFL.txt](../../LICENSES/JetBrainsMono-OFL.txt)
- 相关文件：[src/styles/global.css](../../src/styles/global.css)
