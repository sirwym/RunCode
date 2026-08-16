# 0007. 编译加速体系：BuildCache 产物缓存 + PCH 预编译头

- **Status**: Accepted
- **Date**: 2026-07-31

## Context and Problem Statement

教学场景中"改一行 → 重跑"是最高频操作，每次重复编译相同代码造成明显等待；Windows 内置 TDM-GCC 下 `#include <bits/stdc++.h>` 的编译耗时尤其突出（该头文件展开体积大，且 OI 教学代码几乎人人都包含它）。需要在**不引入常驻后台进程、不显著增加磁盘占用**的硬约束下缩短重复运行与首次编译耗时。

## Decision Drivers

- 重复运行秒级响应（跳过无意义重复编译）
- 磁盘占用可控（轻量化是项目硬约束）
- 不引入常驻后台进程 / 不引入新依赖
- 缓存跨重启复用（机房重启后仍然生效）
- 任何缓存失败都静默降级，不影响编译主流程

## Considered Options

- 方案 A：不做缓存，每次全量编译
- 方案 B：仅内存缓存（进程生命周期内有效）
- 方案 C：磁盘 LRU 缓存（母本拷贝式）
- 方案 D：增量编译（ccache 类工具链）

## Decision Outcome

**Chosen option**: 方案 C（BuildCache）+ PCH 仅 Windows 后台异步生成。

**理由**：磁盘缓存跨重启复用且实现最简单（拷贝母本 exe 即命中）；ccache 引入外部工具链违反轻量化约束；纯内存缓存对机房重启场景无收益。

### 正向后果

- 相同代码（同 scenario、同编译器、同参数）重复运行直接拷贝母本执行，秒级响应
- Windows 下 `bits/stdc++.h` 首次编译后，后续包含该头的编译大幅提速
- 缓存管理 UI（统计 + 一键清空）让磁盘占用对用户透明可控

### 负向后果

- 首次命中失败时多一次拷贝开销（可忽略）
- 磁盘占用小幅增加（受 LRU 上限严格约束）

### 引入的约束

- **cache_key** = `hash(code + scenario + compiler_path + args_for(scenario))`，u64，缓存目录名为 16 位 hex
- **BuildCache LRU 上限 20 条**，磁盘占用 < 8MB；命中时拷贝母本 exe 到 work_dir 直接运行；拷贝失败删除可疑条目并回退到正常编译；**编译失败不写入缓存**
- 缓存命中时不写 `main.cpp`（运行阶段不需要源码）
- **PCH 仅 Windows 启用**（macOS clang++ 编译该头已足够快），LRU 上限 2 套；未命中时**后台异步生成**，失败本会话静默不重试
- `generate_pch` 的 fsize 上限放宽至 512MB（`.gch` 为编译器合法产物，超默认 10MB 限制）
- GCC 使用 `-include` 方式应用 PCH（`-include-pch` 为 Clang 专属，TDM-GCC 不兼容）
- 两套缓存均存于 `app_data_dir` 子目录（`build_cache/`、`pch_cache/`），启动时扫描重建索引并清理孤儿子目录

## Pros and Cons of the Options

### 方案 A：不做缓存

- 优点：零复杂度、零磁盘占用
- 缺点：高频教学操作持续承受重复编译等待；Windows `bits/stdc++.h` 痛点无解

### 方案 B：仅内存缓存

- 优点：无磁盘管理复杂度
- 缺点：进程退出即失效，机房重启场景无收益；与"跨重启复用"驱动因素冲突

### 方案 D：增量编译（ccache 类）

- 优点：理论上命中率更高
- 缺点：引入外部工具链依赖，违反不引入新依赖与安装包体积硬约束；教学场景代码量小，全量缓存已足够快

## More Information

- 实现：[build_cache.rs](../../src-tauri/src/build_cache.rs)、[pch_cache.rs](../../src-tauri/src/pch_cache.rs)
- 接入点：compile_run / pty_run / test_runner 三处入口统一走 `compile_with_cache`
- 缓存管理 UI：设置面板 → 编程语言 → 编译缓存（`get_build_cache_stats` / `clear_build_cache` 命令）
