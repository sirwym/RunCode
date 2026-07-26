# 0004. 多样例测试时间限制机制

- **Status**: Accepted
- **Date**: 2026-07-25

## Context and Problem Statement

OI 评测的核心维度包括正确性 + 时间。原 `run_tests` 命令只判断输出是否匹配，不判断用时。需求：

- 单例测试超过时间限制判失败（即使输出正确）
- 时间限制可配置（默认 1000ms，对 OI 题目合理）
- 判定逻辑便于单元测试

## Decision Drivers

- OI 评测真实性
- 默认值合理性（教学场景 1s 足够大部分题目）
- 可测试性
- 与现有 run_with_limits 的协作（已有运行超时机制，但那是硬超时；测试时间限制是软判定）

## Considered Options

- 方案 A：直接在 run_tests 中内联判定
- 方案 B：提取 judge_case_passed 纯函数 + 时间限制参数
- 方案 C：用 run_with_limits 的 timeout 参数实现

## Decision Outcome

**Chosen option**: 方案 B — 提取 judge_case_passed 纯函数 + 时间限制参数

### 正向后果

- 判定逻辑为纯函数（[test_runner.rs:96-108](../../src-tauri/src/commands/test_runner.rs#L96-L108)），便于单元测试
- 时间限制通过 `config.test_time_limit_ms` 传入（与运行超时 `config.run_timeout` 解耦）
- 边界清晰：`duration > limit` 判超时（`==` 不算）
- 单元测试覆盖：正常通过、输出错误、非零退出、超时、边界值、strict 模式

### 负向后果

- 时间限制与运行超时是两个独立机制（运行超时硬杀进程，时间限制软判定）
- 用户需要理解两者的区别

### 引入的约束

- `judge_case_passed` 必须保持纯函数（无副作用，便于测试）
- 时间限制判定：`duration_ms > time_limit_ms` 判超时（`==` 不算）
- 默认 `test_time_limit_ms = 1000`（见 [settings.rs:114-116](../../src-tauri/src/settings.rs#L114-L116))
- 测试必须覆盖所有判定分支（参考 [test_runner.rs:343-413](../../src-tauri/src/commands/test_runner.rs#L343-L413) 的 9 个测试）

## Pros and Cons of the Options

### 方案 A：内联判定

- 优点：改动最小
- 缺点：无法单元测试、逻辑分散
- 不选原因：可测试性差

### 方案 B：纯函数 + 参数

- 优点：可测试、逻辑集中、与 run_with_limits 解耦
- 缺点：增加一个函数
- 选择原因：可测试性是硬要求

### 方案 C：复用 run_with_limits 的 timeout

- 优点：不增加新机制
- 缺点：硬超时杀进程无法获得 stdout 用于比较、语义混淆
- 不选原因：行为不符合"软判定"需求

## More Information

- 关联 ADR：[ADR-0003](0003-test-settings-split-from-runtime.md)（test_time_limit_ms 字段归属）
- 相关文件：[src-tauri/src/commands/test_runner.rs](../../src-tauri/src/commands/test_runner.rs)、[src-tauri/src/config.rs](../../src-tauri/src/config.rs)
