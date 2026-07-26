# 架构决策记录 (ADR)

本目录记录 RunCode 项目的重要架构决策，采用 MADR（Markdown ADR）轻量格式。

## 索引

| 编号 | 标题 | 状态 | 日期 |
|---|---|---|---|
| [0001](0001-tauri-tech-stack.md) | 采用 Tauri 2 + React 19 + Monaco 技术栈 | Accepted | 2025-01-01 |
| [0002](0002-lyra-style-jetbrains-mono.md) | 采用 Lyra 全直角风格 + JetBrains Mono 统一字体 | Accepted | 2025-02-01 |
| [0003](0003-test-settings-split-from-runtime.md) | TestSettings 从 RuntimeSettings 拆分 | Accepted | 2026-07-25 |
| [0004](0004-test-case-time-limit.md) | 多样例测试时间限制机制 | Accepted | 2026-07-25 |
| [0005](0005-lucide-react-icon-unification.md) | lucide-react 图标库统一 | Accepted | 2026-07-26 |

## 模板

新 ADR 请复制 [0000-template.md](0000-template.md)。

## 编号规则

- 4 位数字起始（0001、0002、...）
- 文件名：`NNNN-短横线连接的小写标题.md`
- 新决策接续编号，不重用已废弃编号

## 状态取值

- `Proposed` — 已提议待评审
- `Accepted` — 已采纳（默认）
- `Deprecated` — 已废弃
- `Superseded by ADR-NNNN` — 被后续 ADR 替代
