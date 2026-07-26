# 0003. TestSettings 从 RuntimeSettings 拆分

- **Status**: Accepted
- **Date**: 2026-07-25

## Context and Problem Statement

Round 17 之前，`fsize_mb`（文件大小上限）位于 `RuntimeSettings`，且没有专门的测试设置结构。OI 教学场景需要：

- 单例测试时间限制（超过判失败）
- 后期可能扩充其他测试相关设置（如内存限制、并行数等）
- 与运行时设置（编译超时、运行超时、CPU 限制）概念分离

直接在 `RuntimeSettings` 添加 `test_time_limit_ms` 会让结构语义混乱。

## Decision Drivers

- 设置的语义清晰度（运行时 vs 测试）
- 后续扩展能力
- 配置迁移兼容性（已有用户的 settings.json）
- OI 友好性

## Considered Options

- 方案 A：在 RuntimeSettings 中直接添加 test_time_limit_ms
- 方案 B：新建 TestSettings 结构，迁移 fsize_mb 并新增 test_time_limit_ms
- 方案 C：完全重构，把所有设置按功能域拆分

## Decision Outcome

**Chosen option**: 方案 B — 新建 TestSettings，迁移 fsize_mb + 新增 test_time_limit_ms

### 正向后果

- 测试设置独立结构（[settings.rs:104-112](../../src-tauri/src/settings.rs#L104-L112)），语义清晰
- 后续扩充测试相关设置（如内存限制）有归属
- OI 友好（时间限制是 OI 评测的核心维度）

### 负向后果

- 需要配置迁移逻辑（runtime.fsize_mb → test.fsize_mb）
- 旧配置升级需注意迁移正确性

### 引入的约束

- `AppSettings.test` 字段必须有 `#[serde(default)]`，确保旧配置（无 test 字段）能反序列化
- `TestSettings` 必须有显式 `Default` impl（不用 `#[derive(Default)]`，避免 fsize_mb=0 与默认值 10 不一致）
- 配置迁移必须在 `load()` 中按原始 JSON 是否有 `test` 字段判断
- 测试设置 UI 在 SettingsPanel 的「编程语言设置」tab 中（参考 [SettingsPanel.tsx](../../src/components/SettingsPanel.tsx)）

## Pros and Cons of the Options

### 方案 A：RuntimeSettings 直接添加

- 优点：改动最小
- 缺点：语义混乱、后续扩展受限
- 不选原因：运行时与测试是不同概念域

### 方案 B：新建 TestSettings

- 优点：语义清晰、可扩展、迁移路径明确
- 缺点：需要兼容迁移代码
- 选择原因：长期可维护性

### 方案 C：完全重构按功能域拆分

- 优点：最清晰
- 缺点：改动过大、迁移风险高
- 不选原因：过度工程化

## More Information

- 关联 ADR：[ADR-0004](0004-test-case-time-limit.md)（时间限制的具体判定机制）
- 相关文件：[src-tauri/src/settings.rs](../../src-tauri/src/settings.rs)、[src/types/index.ts](../../src/types/index.ts)
- 迁移逻辑：见 `load()` 函数中的 `has_test_field` 判断
