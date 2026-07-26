# 0001. 采用 Tauri 2 + React 19 + Monaco 技术栈

- **Status**: Accepted
- **Date**: 2025-01-01 (Retrospective)

## Context and Problem Statement

需要为 C++ 教学场景构建一个轻量级代码编辑器，目标用户为 OI / 算法教学学生和教师。核心需求：

- macOS 原生体验（小体积、快启动、低内存）
- 内置编辑器需要支持 C++ 语法高亮、括号自动闭合
- 后端需要执行编译后的程序、做资源限制（CPU 时间 / 文件大小 / 运行超时 / 输出量）
- 需要终端能力（交互式输入）
- 教学场景需要严格控制危险编译参数

## Decision Drivers

- 体积与启动速度（教学场景不能让学生等待）
- 后端能力（进程管理、资源限制、文件操作）
- 编辑器成熟度（VS Code 同款体验）
- macOS 原生集成（菜单、主题、签名公证）

## Considered Options

- 方案 A：Electron + React + Monaco
- 方案 B：Tauri 2 + React 19 + Monaco
- 方案 C：原生 Swift + SwiftEdit

## Decision Outcome

**Chosen option**: 方案 B — Tauri 2 + React 19 + Monaco

### 正向后果

- 应用体积 < 20MB（Electron 通常 100MB+）
- Rust 后端提供强大的进程管理和资源限制能力（参考 `src-tauri/src/runner/`）
- 原生 macOS 菜单系统（参考 `src-tauri/src/lib.rs`）
- React 生态丰富，组件库选择多
- Monaco 提供 VS Code 同款编辑体验

### 负向后果

- Rust 学习曲线（团队需要掌握 Rust）
- Tauri 2 相对年轻，部分 API 文档不如 Electron 完善
- macOS 之外的移植需要额外工作（当前仅构建 macOS）
- **不提供针对恶意代码的沙箱隔离**：仅做 CPU / 文件大小 / 运行超时限制，不限制内存、文件系统访问、网络、子进程。详见 [README「执行模型与安全说明」](../../README.md#执行模型与安全说明) 与 [`limits.rs`](../../src-tauri/src/runner/limits.rs) 注释。教学场景假设用户运行自己信任的本地代码。

### 引入的约束

- 后端逻辑必须用 Rust 实现（不能直接复用 Node.js 生态）
- 前后端通过 Tauri commands + invoke 通信
- 状态管理用 Zustand（不用 Redux 等重型方案）

## Pros and Cons of the Options

### 方案 A：Electron + React + Monaco

- 优点：Node.js 生态成熟、文档丰富、跨平台简单
- 缺点：体积大（100MB+）、启动慢、内存占用高、Chromium 内核冗余
- 不选原因：教学场景对体积和启动速度敏感

### 方案 B：Tauri 2 + React 19 + Monaco

- 优点：体积小、Rust 后端能力强、原生体验
- 缺点：Rust 学习成本、Tauri 2 文档相对少
- 选择原因：体积/性能/后端能力综合最优

### 方案 C：原生 Swift + SwiftEdit

- 优点：完全原生、最佳性能
- 缺点：开发效率低、不能复用 Web 生态、跨平台无望
- 不选原因：开发成本过高、Monaco 生态无法复用

## More Information

- Tauri 官网：https://tauri.app
- 相关文件：[Cargo.toml](../../src-tauri/Cargo.toml)、[package.json](../../package.json)
