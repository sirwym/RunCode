# RunCode 整体排查报告

> 排查日期：2026-08-19；同日经 Gemini / GPT 双 AI 外部评审交叉验证并完成裁决（见第六节），S0 修复方案见第七节
> 排查目标：不新增功能，聚焦 好用 > 稳定 > 性能 三大方向的改进点梳理
> 排查方式：只读代码审查（前端全部组件/hooks/工具、后端全部模块、构建与 CI 配置），关键结论已通过交叉验证
> 本报告不含对项目源代码的任何修改；第七节 S0 修复方案已于 2026-08-19 批准并执行完毕（见 7.5 实施记录）

---

## 总览

| 维度 | 高严重度 | 中严重度 | 低严重度 |
|------|---------|---------|---------|
| 好用性（UX） | 5 | 13 | 10 |
| 稳定性（后端+前端状态） | 6 | 10 | 15 |
| 性能 | 4 | 4 | — |
| 工程质量 | 2 | 4 | 3 |

修复优先级建议见文末「五、修复优先级建议」。

---

## 一、好用性（最优先）

### A1. 错误反馈体系是最大短板（影响所有核心流程）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1 | 格式化失败用浏览器原生 `alert` 阻塞 UI | [App.tsx](src/App.tsx#L428)、[useTabs.ts](src/hooks/useTabs.ts#L108) | 保存失败（权限/磁盘满/文件被锁）弹系统级窗口，学生必须先关弹窗才能继续；与 Lyra 全直角风格完全不符 |
| 2 | 测试判定的关键诊断信息只进 DevTools console | [useRunManager.ts](src/hooks/useRunManager.ts#L242-L256) | `test_judge_info` 事件监听器仅 `console.log` 输出每例的 PASS/FAIL、first_diff、norm_equal、expected/actual 全文；学生想知道"差在第几个字符、是不是末尾换行问题"必须打开开发者工具——违背教学编辑器定位 |
| 3 | 测试面板错误条不可关闭、不可复制 | [TestCasesPanel.tsx](src/components/TestCasesPanel.tsx#L523) | `{error && <div className="testcases-error">...}` 长错误信息常驻占空间，无 dismiss 按钮；无法复制发给老师 |
| 4 | 最近文件对话框错误未走 i18n、无 dismiss | [RecentFilesDialog.tsx](src/components/RecentFilesDialog.tsx#L47) | `setError(typeof e === "string" ? e : String(e))` 直接显示 Rust 原始英文错误串，中文用户不友好 |
| 5 | Cheatsheet 复制失败静默吞掉 | [CheatsheetDialog.tsx](src/components/CheatsheetDialog.tsx#L96-L108) | catch 注释"静默失败"，用户以为复制成功实际未复制 |

**说明**：这是系统性问题。建议统一为"非阻塞 toast/内联错误条 + 可关闭 + 可复制"，让 编译失败→stderr、运行失败→状态栏、测试失败→可复制诊断 形成完整闭环。这是收益最大的一项改进。

### A2. i18n 硬编码漏网（中优先）

- [useTestSuite.ts](src/hooks/useTestSuite.ts#L156)：`"套件未初始化"` 直接抛中文
- [colorExtract.ts](src/utils/colorExtract.ts#L62)：`"仅接受 6/8 位 HEX"` 等中文异常
- [FlowchartPanel.tsx](src/components/FlowchartPanel.tsx#L65-L78)：用 `detail.includes("未找到函数定义")` 匹配后端中文文案判断分支——后端文案一改就静默失效
- [App.tsx](src/App.tsx#L522-L526)：About 弹窗硬编码作者名 + 指向不存在仓库的 URL（`https://github.com/YuanMing/RunCode`）

**说明**：根因是后端错误只返回 `detail: String`。治本方案是错误码体系（后端返回 `{code, params}`，前端 `errors.*` 解析），同时能解决 A1 的问题。

### A3. 具体交互摩擦点（按影响排序）

1. **终端字号不即时生效**（[Terminal.tsx](src/components/Terminal.tsx#L255) 注释自认"运行中改设置需重启应用生效"）：编辑器即时变、终端不变，体验割裂
2. **流程图过期不刷新**（[FlowchartPanel.tsx](src/components/FlowchartPanel.tsx#L396-L400)）【提级 S0，三方一致确认，stale derived state】：仅在"从未生成过"时自动生成；改完代码切回流程图 tab 显示旧图，教学误导
3. **DiffDialog 空结果误显示"加载中"**（[DiffDialog.tsx](src/components/DiffDialog.tsx#L121-L125)）【提级 S0，三方一致确认，状态模型不完整；实施时修正触发面】：用 `diffLines.length === 0` 判空，"未加载"与"无差异"共用同一状态。实施核实：`computeLineDiff` 对非空相同内容返回 equal 行，空数组仅出现在**两侧输出均为空**时（期望为空且程序无输出）——触发面比原描述窄，但该场景（空输出测试点）确实会永久显示"加载中"，修复仍成立
4. **RecoveryDialog"放弃恢复"无二次确认**（[RecoveryDialog.tsx](src/components/RecoveryDialog.tsx#L102-L105)）：误点一次，崩溃恢复内容永久丢失（autosave 已被清理）
5. **多 tab 时标签栏无横向滚动**（[TabBar.tsx](src/components/TabBar.tsx#L17-L38)）：开很多 tab 时文件名被 truncate；关闭按钮 hover 不区分 dirty 状态
6. **RecentFilesDialog loading 仅显示"…"**（[RecentFilesDialog.tsx](src/components/RecentFilesDialog.tsx#L90-L94)）：无 spinner 无文字，用户不知是在加载还是出错
7. **首次启动无引导**（[App.tsx](src/App.tsx#L277-L292)）：新用户只看到 untitled.cpp，不知道怎么运行/加测试/看流程图；测试用例空状态也只有一句话无 CTA
8. **设置面板保存失败提示 2 秒自动消失**（[SettingsPanel.tsx](src/components/SettingsPanel.tsx#L573)）；主题预览改动关闭面板静默丢失（[SettingsPanel.tsx](src/components/SettingsPanel.tsx#L250-L259)）
9. **ConfirmCloseDialog 遮罩/ESC 行为含混**（[ConfirmCloseDialog.tsx](src/components/ConfirmCloseDialog.tsx#L35)）：若 `onOpenChange` 不被触发，`closeResolverRef` 持有的 Promise 永挂，边角场景下关闭流程卡死
10. **DiffDialog 缺少显式关闭按钮**（[DiffDialog.tsx](src/components/DiffDialog.tsx#L131-L176)）：仅依赖 ESC/点遮罩

---

## 二、稳定性

### B1. 高危（会崩溃/状态错乱）

| # | 问题 | 位置 | 触发与后果 |
|---|------|------|------|
| 1 | **PTY 退出信息写入错误的 tab**（已交叉验证） | [useRunManager.ts](src/hooks/useRunManager.ts#L435)、[useRunManager.ts](src/hooks/useRunManager.ts#L464) | `startInteractive` 时记录过发起 tab 但没存进 state；`onPtyExit`/`stopInteractive` 用 `s.activeTabId`（当前激活 tab）凑数。复现：tab A 启动交互运行→切到 tab B→程序退出，exit code/耗时/内存写入 B 的快照；切回 A 后状态栏无退出信息。**最确定、有明确复现路径的真实 bug** |
| 2 | runner 的 `expect` 直接 panic（**已降级**：工程可靠性改进，非可触发的高危 bug，见 6.2） | [unix.rs](src-tauri/src/runner/unix.rs#L282-L283)、[windows.rs](src-tauri/src/runner/windows.rs#L86-L87) | `child.stdout.take().expect(...)`。修正：`Stdio::piped()` + spawn 成功时 stdout 必为 `Some`（资源耗尽会让 spawn 本身返回 Err，原报告"句柄为 None"的触发条件不成立，Rust 官方文档亦用同款模式演示）；仍建议改 `ok_or_else` 返回 `AppError`（零成本，桌面端 panic 代价是整个后端崩溃） |
| 3 | ZIP 导入 `unwrap` panic | [importer.rs](src-tauri/src/importer.rs#L140-L141) | `file_map.get(&input_key).unwrap()`：ZIP 内含非 UTF-8 文件名时 key 不匹配 → 崩溃 |
| 4 | Windows PTY 停止只杀主进程 | [pty.rs](src-tauri/src/pty.rs#L101-L115) | Unix 用 `kill(-pgid)` 杀全组，Windows `TerminateProcess` 只杀主进程——学生程序 `system("sleep 1000")` 后点停止，孙进程残留占资源。跨平台行为不一致 |
| 5 | Windows ConPTY `Child::Drop` 阻塞 | [pty.rs](src-tauri/src/pty.rs#L374-L379) | 测试代码用 `mem::forget` 绕过，恰恰证明生产路径（[pty_run.rs](src-tauri/src/commands/pty_run.rs#L500-L511)）存在等待线程泄漏风险 → 下次启动 PTY 报"已有任务运行中" |
| 6 | `RunManager::cancel_all` 不清理 session | [run_manager.rs](src-tauri/src/run_manager.rs#L118-L124) | 只触发 token 不移除 session，依赖外部 `RunGuard::drop` 调 complete；取消后未 complete 会导致后续任务无法注册 |

### B2. 中危

1. **配置静默丢失**：[settings.rs](src-tauri/src/settings.rs#L556-L580) settings.json 损坏（写一半崩溃/外部编辑）时静默回退默认值，编译器路径等配置无声消失。建议回退前备份原文件
2. **非 UTF-8 文件打不开**：[documents.rs](src-tauri/src/commands/documents.rs#L49) 用 `read_to_string`，GBK 编码的 .cpp（VS 保存的常见情况）直接报 "stream did not contain valid UTF-8"。**方案修正（见 6.4）**：不要用 `from_utf8_lossy`——GBK 被静默替换成 U+FFFD 乱码、一保存原文件即被破坏，比打不开更糟；最小正确方案是返回 `INVALID_ENCODING` 错误码明确提示"文件非 UTF-8 编码，请转换后打开"（零新依赖；GB18030 解码需引入 encoding_rs 类依赖，与"不引入新依赖"硬约束冲突，是否引入由项目所有者决策）。中国教育场景下该项价值上调，进入 S1
3. **PTY 停止时序竞态**：[pty_run.rs](src-tauri/src/commands/pty_run.rs#L583-L611) `mark_cancelled` 与 emit 之间非原子，快速连点停止可能 `pty_exit` 双发，前端 onExit 触发两次
4. **`lock().unwrap()` 中毒即 panic**：[output.rs](src-tauri/src/runner/output.rs#L55)、[windows.rs](src-tauri/src/runner/windows.rs#L188)
5. **崩溃恢复用 `setValue` 清空 undo 栈**：[Editor.tsx](src/components/Editor.tsx#L407-L415) 恢复后无法 Ctrl+Z 撤销误操作
6. **清缓存与编译并发竞态**：[compile_run.rs](src-tauri/src/commands/compile_run.rs#L425-L433) 点"清空缓存"同时正在编译时可能删到半写入产物（有 `fs::copy` 失败→`cache.remove` 兜底，影响有限）
7. **Unix 超时分支丢弃已读输出，Windows 保留**（[unix.rs](src-tauri/src/runner/unix.rs#L360-L377) vs windows.rs shared buffer）：TLE 时 Unix 学生看不到超时前的已输出内容，两平台行为不一致
8. **Windows 无 fsize 限制**：Unix 有 RLIMIT_FSIZE，Windows 不实现——学生程序写爆磁盘的防护缺失（跨平台差异汇总见下表）
9. **PchCache TOCTOU**：[pch_cache.rs](src-tauri/src/pch_cache.rs#L150-L169) `try_start_generation` 检查 failed 后释放锁再锁 generating，并发时 failed 状态可能与实际不一致
10. **测试大样例内存峰值**：[test_runner.rs](src-tauri/src/commands/test_runner.rs#L417-L452) 每例 stdin+expected+stdout 三份完整驻留，500 例 × 2MB ≈ 1GB 峰值；AGENTS.md 已有"不超过 500 例"建议但代码无硬限制

### B3. 跨平台行为差异汇总

| 行为 | Unix | Windows | 影响 |
|------|------|---------|------|
| 进程组 kill | `kill(-pgid, SIGKILL)` 杀全组 | `TerminateProcess` 只杀主进程 | B1-4：Windows 孙进程残留 |
| Child::Drop | 正常 wait | ConPTY 可能阻塞 | B1-5 |
| 超时输出保留 | 丢弃（500ms 超时后空 Vec） | shared buffer 保留部分数据 | B2-7：行为不一致 |
| fsize 限制 | RLIMIT_FSIZE 生效 | 不实现 | B2-8 |
| 内存采集 | macOS proc_pid_rusage / Linux RUSAGE_CHILDREN 差值（已知不可靠） | GetProcessMemoryInfo PeakWorkingSet | Linux 差值法注释自认不可靠 |

### B4. 做得好的部分（避免误报）

- Tauri 事件监听几乎都成对清理（App.tsx 各 effect 有 `disposed` 标志兜底）
- Terminal.tsx 初始化 effect 清理完整（rAF/ResizeObserver/keydown/term.dispose）
- 测试套件边界测试充分：30MB/50MB/200MB 单文件与总量边界均有回归用例
- `judge_case_passed` 32 个纯函数测试，符合 ADR-0004
- release profile 五项体积优化全开（opt-level=z / LTO / 单 codegen / strip / abort）
- CI（build.yml）双平台确实在跑 `pnpm test` 和 `cargo test`
- ZIP 炸弹已有 50MB/200MB 上限防护，suite_id 有 UUID 校验（无路径穿越）

---

## 三、性能

### P1. 高影响

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1 | **Monaco + xterm 全量同步 import 进主 bundle** | [main.tsx](src/main.tsx#L14-L37) | 首屏 JS 数 MB 级，TTI 受拖累，与"启动秒级"硬约束相悖。mermaid 已懒加载（`await import`），但 Monaco/xterm 没有；[vite.config.ts](vite.config.ts) 也没配 `manualChunks` |
| 2 | Monaco worker 工厂不按 label 复用（**已降级**：非问题级，见 6.2） | [main.tsx](src/main.tsx#L36) | 修正：Monaco 官方 Vite 示例即 `return new editorWorker()` 写法；且本项目仅注册 cpp/markdown Monarch 高亮（无 ts/json 语言 worker），`getWorker` 实际调用次数极少，"多实例内存抬升"缺乏事实依据。降级为零风险顺手改（按 label 缓存约 3 行） |
| 3 | **多 tab 测试结果内存累积** | [useRunManager.ts](src/hooks/useRunManager.ts#L51-L94) | `resultsByTab` 每 tab 快照持有全部 case 的 stdout（单例截断 1MB），10 个 tab 各跑一次 500 例测试理论上可达 GB 级，远超 ~260MB 目标。建议只保留最近 N 次或截断存储 |
| 4 | **每次按键重建 tabs 数组 + 重渲染 TabBar** | [useTabs.ts](src/hooks/useTabs.ts#L446-L453) | `tabs.map` 全量重建 → App 重渲染 → TabBar 未 memo 全量重渲染 + compileError 清理链（deltaDecorations）；弱机大文件输入会卡 |

### P2. 中影响

5. `JSON.stringify(customColors)` 在 render body 中每次按键执行两三处（[Editor.tsx](src/components/Editor.tsx#L592)、[App.tsx](src/App.tsx#L550)、[Terminal.tsx](src/components/Terminal.tsx#L482)）【已降级为极低优先级：几十个 key 的对象耗时微秒级，非当前瓶颈，无需特意重构】
6. BuildCache/PchCache 持锁做 `remove_dir_all` 同步 IO（[build_cache.rs](src-tauri/src/build_cache.rs#L161-L172)、[pch_cache.rs](src-tauri/src/pch_cache.rs#L192-L202)）：杀软扫描时阻塞后续编译
7. 切 tab 时 `TestSuite::find_by_doc_path` O(N) 全量读盘解析 manifest（[test_suite.rs](src-tauri/src/test_suite.rs#L110-L124)）：套件多了切 tab 卡
8. 缓存统计每次全量 walkdir（[build_cache.rs](src-tauri/src/build_cache.rs#L204-L214)）：PCH 单套 40-100MB 时打开设置面板卡数百毫秒

### P3. 做得好的部分

- Terminal 输出 rAF + buffer 批量写入，512KB 上限防刷屏
- TestCaseCard 用 React.memo + 500ms 防抖 + 卸载 flush
- diff.ts 三层降级（10MB fallback / 5000² 乘积上限 / 5000 行截断）
- Monaco model 按 Uri 复用，大文件分级关闭 minimap
- mermaid 懒加载 + renderIdRef 防过期渲染覆盖

---

## 四、工程质量（支撑项）

1. **前后端类型契约纯手工同步**（[types/index.ts](src/types/index.ts)）：30+ 接口靠注释标注对应关系，Rust 侧改字段 TS 不报错，运行时才 undefined。建议引入 ts-rs/typeshare 或至少加一个 CI 字段对拍测试
2. **AppError 分类过粗**（[error.rs](src-tauri/src/error.rs#L14-L20)）：仅 5 个变体，`Other { detail: String }` 万能兜底，前端无法区分"超限/权限/参数错误"做差异化引导——这也是 A1/A2 的根因
3. **CI 无产物体积断言**：~10MB/~40MB 是硬约束但无自动守卫，依赖升级导致体积回退只能肉眼发现
4. **PTY 数据流无测试**（[pty.rs](src-tauri/src/pty.rs#L245-L380)）：进程管理 kill 有 3 个真实子进程测试，但 `write_stdin`/`resize` 数据通路完全未覆盖
5. **Windows runner 测试少于 Unix**（3 vs 9）：JobObject 降级路径（`job_object_degraded`）、PeakWorkingSet 采集无回归测试
6. 无端到端集成测试贯穿"前端 invoke → Rust command → 真实文件 IO → 返回"全链路（属已知折中，AGENTS.md 已声明"测试通过 ≠ 验收通过"）

---

## 五、修复优先级建议（三方裁决后最终版）

| 阶段 | 内容 | 理由 |
|------|------|------|
| **S0 确定 bug** | ① B1-1 PTY 退出写错 tab（最小修复）② A3-3 DiffDialog 空 diff 误显示"加载中" ③ A3-2 流程图过期不刷新 | 三方一致确认的确定性 bug；修复方案见第七节 |
| **S1 好用性** | ④ 错误码体系最小版（地基：AppError 细分 + `{code, params}` 契约）⑤ 测试诊断进 UI（first_diff / expected / actual / 一键复制，替代 console.log）⑥ 替换 2 处阻塞 alert ⑦ RecoveryDialog 放弃恢复二次确认 ⑧ 错误条可关闭 + 可复制 ⑨ GBK 文件返回 INVALID_ENCODING 明确报错（不加依赖） | 用户优先级"好用"最前；错误码体系是 A1/A2 多项问题的共同根因，先行落地 |
| **S2 稳定性** | ⑩ ZIP 非 UTF-8 文件名构造实测 + unwrap 治理 ⑪ Windows PTY 复用 runner 现有 JobObject（含 KILL_ON_JOB_CLOSE）杀进程树 ⑫ ConPTY Drop 阻塞 Windows 实测 ⑬ settings.json 损坏先备份再回退 ⑭ pty_exit 双发窗口收窄 | 低频但一触发即崩溃/丢数据；⑪ 成本低于预期（非 PTY 路径已有 JobObject 基础设施） |
| **S3 性能（先测量后动手）** | ⑮ `pnpm build` 拿 bundle 体积分布 → 决定 manualChunks / Monaco·xterm 懒加载 ⑯ Worker 按 label 缓存（顺手改）⑰ resultsByTab 保留策略（压测后定）⑱ 按键渲染链路（React Profiler 证实再动） | 采纳 GPT 方法论：先 profiling 再重构，避免为理论上的 20ms 改一堆代码 |
| **持续（工程）** | 类型契约对拍测试 → CI 体积断言（~10MB/~40MB 硬约束守卫） | 防回归 |

原报告的四批次建议由上表取代（差异：A3-2/A3-3 从第三批提级到 S0；B1-2 从第二批降级并入 S2 的 panic 治理；性能批次改为测量先行）。

---

## 六、外部评审交叉验证与裁决

原报告完成后交由 Gemini 与 GPT 两个外部 AI 独立评审。两家在**问题真伪**上高度一致（无一项被判定为虚构），分歧集中在**严重度标签与行动时机**。裁决如下。

### 6.1 两家评审的采信度

- **GPT 更值得采信**：做了证据分级（"代码里存在危险写法 ≠ 用户一定能触发 bug"），抓到原报告 2 处过度判断（见 6.2）；其"run → result → error → state 主链"的抽象是对整份报告最有价值的提炼。
- **Gemini 方向确认基本正确，但缺少证伪能力**：几乎照单全收原报告结论；其对 PTY 事件"通过 Channel 发给前端"的描述与代码事实不符（实为 Tauri event `emit`/`listen`，见 [App.tsx](src/App.tsx#L963)），说明细节核对深度有限。两点独特贡献被采纳：P2-5 降级为极低优先级；B2-8（Windows fsize）替代方案——输出流字节数计数 + 超限截断，与现有 `read_until_limit` 架构一致。

### 6.2 降级项（原报告过度判断）

| 条目 | 原定级 | 裁决后 | 依据 |
|------|--------|--------|------|
| B1-2 runner `expect` | 高危崩溃 | 工程可靠性改进 | `Stdio::piped()` + spawn 成功则 stdout 必为 `Some`（语言保证的 invariant）；资源耗尽使 spawn 返回 `Err` 而非返回缺句柄的 Child，Rust 官方文档亦用同款 `take().expect(...)` 模式演示。行动项保留（`ok_or_else` 零成本），但不是可触发的高危 bug |
| P1-2 Monaco Worker 每次 new | P1 高影响 | 顺手改 | Monaco 官方 Vite 示例即 `return new editorWorker()` 写法；本项目无 ts/json 语言 worker，`getWorker` 实际调用次数极少，"多实例内存抬升"无事实依据 |
| P2-5 render 中 JSON.stringify | 中影响 | 极低优先级 | 几十个 key 的对象 stringify 耗时微秒级，非当前瓶颈 |

### 6.3 维持原判但需实测确认的项

| 条目 | 裁决 | 待办 |
|------|------|------|
| B1-3 ZIP unwrap | 方向成立（外部输入路径不应 unwrap），但"非 UTF-8 文件名必现 panic"未经证实——zip crate 文件名解码涉及 UTF-8 flag / code page 437 / `to_string_lossy` 双重转换，静态分析无法定论 | 构造含非 UTF-8 文件名的 ZIP 实测一次；无论结果如何都改掉 unwrap（约 30 分钟） |
| B1-5 ConPTY Child::Drop | 维持高可信。测试代码的 `mem::forget` 是开发者已踩到 Drop 阻塞的间接证据，但生产路径是否永久挂起无法静态推导（GPT 的质疑方法论成立） | Windows 实测：停止 PTY 后观察等待线程是否退出 |
| P1-1 bundle 体积 / P1-3 内存累积 / P1-4 按键渲染 | 问题方向成立，但严重度需数据支撑 | ⑮ `pnpm build` 看 dist/assets 分布；⑰ 多 tab 大套件压测；⑱ React Profiler 录制按键链路 |

### 6.4 方案修正项

- **B2-2 GBK 兼容**：原建议 `from_utf8_lossy` 是错的——GBK 被静默替换成 U+FFFD 乱码、文件一保存即被破坏，比打不开更糟（GPT 抓到此点）。修正为：错误码体系返回 `INVALID_ENCODING` 明确报错；GB18030 解码需新依赖，留待所有者决策。该项在中国教育场景（老学校电脑 / Dev-C++ / 网盘文件多为 GBK）价值上调，进入 S1。
- **A1 错误反馈**：GPT 的四层模型（Toast / Inline / Diagnostic / Fatal）方向正确，但裁剪采纳——RunCode 已有终端（编译 stderr）与测试面板（用例详情）两个天然诊断表面，只需补 toast 层 + 错误条可关闭可复制，不新建四层框架（符合"简化优先"）。
- **B1-1 修复方式**：GPT 建议的 `InteractiveSession { tabId, ... }` 架构化重构与"小范围 > 大重构"约束有张力。裁决：先做最小修复（initiatorTabId 存入 state，约 10 行，见 7.1），session 架构化作为后续演进另议。

### 6.5 提级项

- **A3-2 流程图过期不刷新、A3-3 DiffDialog 空 diff 误显示"加载中"**：从原第三批提级到 S0（三方一致确认的确定性 bug；GPT 定性分别为 stale derived state 与状态模型不完整）。
- **B2-2 GBK 兼容**：从原第二批提前到 S1（中国教育场景高价值）。

### 6.6 对两家建议的保留意见

1. GPT 的 S0 把"所有 panic 治理"列入立即修，但其自己对 B1-2 的降级分析已推翻该排法——按其证据分级，panic 治理归入 S2。
2. Gemini 关于 PTY 事件走"Channel"的机制描述与代码事实不符（实为 emit/listen），相关分析未采纳。

---

## 七、S0 修复方案（已执行）

三项均为前端 TypeScript 改动，不涉及 Rust、不引入新依赖。

### 7.1 B1-1：PTY 退出信息写入错误的 tab

**文件**：[src/hooks/useRunManager.ts](src/hooks/useRunManager.ts)

**根因**：`startInteractive`（[L334](src/hooks/useRunManager.ts#L334)）已记录 `initiatorTabId` 但未存入 state；`onPtyExit`（[L464](src/hooks/useRunManager.ts#L464)）与 `stopInteractive`（[L435](src/hooks/useRunManager.ts#L435)）退而用"当前激活 tab" `s.activeTabId` 作快照键。

**修改（最小修复，对齐 compileRun/runTests 既有的"写发起 tab"模式）**：

1. `RunManagerState` 在 `ptyRunId` 附近新增字段：
   ```ts
   /** 当前 PTY 运行的发起 tab（快照写入键，不随 tab 切换变化） */
   ptyInitiatorTabId: string | null;
   ```
2. store 初始化处补 `ptyInitiatorTabId: null`。
3. `startInteractive` 初始 set（[L340-351](src/hooks/useRunManager.ts#L340-L351)）加入 `ptyInitiatorTabId: initiatorTabId`。
4. `stopInteractive`（L435）与 `onPtyExit`（L464）内 `s.activeTabId` → `s.ptyInitiatorTabId`。
5. 所有 `ptyRunId` 置 null 的位置同步清空该字段（编译失败分支 L403、catch 分支 L416、两个退出函数的最终 set、`reset` L519），生命周期与 `ptyRunId` 严格一致。
6. 顶层 `ptyExitInfo` 更新补 `isStillActive` 守卫（对齐 compileRun L184 对 `runResult` 的做法）：
   ```ts
   ptyExitInfo: isStillActive ? exitInfo : s.ptyExitInfo,
   ```
   StatusBar 读顶层 `ptyExitInfo`（[StatusBar.tsx L34](src/components/StatusBar.tsx#L34)）：守卫后 tab B 的状态栏不再显示 tab A 的退出信息；切回 tab A 时经 `setActiveTab` 加载快照恢复显示。

**不改**：Terminal 显示逻辑、`ptyReadySeq`、`ptyStartTime`（单 PTY 并发，顶层读取语义正确）。

**已知边界（与 compileRun 现状一致，不额外处理）**：PTY 运行中发起 tab 被关闭时，退出信息会写入已关闭 tab 的快照键，形成一条无害的死数据；compileRun 对此行为相同，保持一致。

**测试**（扩展 [src/hooks/useRunManager.test.ts](src/hooks/useRunManager.test.ts)）：

- `beforeEach` 状态重置（L55-69）补 `ptyInitiatorTabId: null`（`setState` 浅合并，不补会跨用例残留）。
- 新增用例「onPtyExit 写入发起 tab 而非当前 tab」：tab-a `startInteractive` → `setActiveTab("tab-b")` → `onPtyExit` → 断言 `resultsByTab["tab-a"].ptyExitInfo` 非空、`resultsByTab["tab-b"]` 无退出信息、顶层 `ptyExitInfo` 为 null（守卫生效）；`setActiveTab("tab-a")` 后顶层恢复为该退出信息。
- 新增 stopInteractive 同场景用例。
- 现有 L214 用例（发起 tab = 当前 tab）不受影响，无需改动。

### 7.2 A3-3：DiffDialog 空 diff 误显示"加载中"

**文件**：[src/components/DiffDialog.tsx](src/components/DiffDialog.tsx)、[src/locales/zh.ts](src/locales/zh.ts)、[src/locales/en.ts](src/locales/en.ts)

**根因**：[L121-125](src/components/DiffDialog.tsx#L121-L125) 以 `diffLines.length === 0` 显示"加载期望输出中…"。但对话框主体仅在 `!loading && !error` 时渲染（L163），主体内 diffLines 为空只可能意味着"实际与期望均为空、无差异"（实施核实：`computeLineDiff` 对非空相同内容返回 equal 行，仅两侧皆空才返回空数组）——文案语义错位。

**修改**：

1. zh.ts / en.ts 在 `diffLoading`（两文件 L93）旁新增键，保持 zh/en 键一致：
   - zh：`diffNoDiff: "实际输出与期望完全一致，无差异"`
   - en：`diffNoDiff: "Actual output matches expected exactly — no differences"`
2. DiffDialog.tsx L123 `t("tests.diffLoading")` → `t("tests.diffNoDiff")`。

**不改**：不引入状态机重构（GPT 建议）——loading / error 已在容器层正确处理（L151-161），此处仅文案语义错误，一行改动足矣（"简化优先"）。

**测试**（新建 [src/components/DiffDialog.test.tsx](src/components/DiffDialog.test.tsx)，该组件当前无测试）：

- `actual === expected` 时主体显示"完全一致"文案，不出现"加载"字样；
- `loading=true` 时显示加载提示、主体不渲染；
- `error` 非空时显示错误提示。

### 7.3 A3-2：流程图过期不刷新

**文件**：[src/components/FlowchartPanel.tsx](src/components/FlowchartPanel.tsx)

**根因**：[L396-400](src/components/FlowchartPanel.tsx#L396-L400) 可见性 effect 仅在 `!hasResult`（从未生成过）时自动生成；代码变更后切回流程图 tab 仍显示旧图。

**修改（记录上次生成对应的代码版本，切回时发现代码已变则自动重新生成）**：

1. 新增 `const lastGeneratedCodeRef = useRef<string | null>(null);`
2. `generate` 函数体首行（空代码早退之前）标记版本：
   ```ts
   lastGeneratedCodeRef.current = code;
   ```
   成功与失败路径均视为"该版本已处理"，避免代码未变时反复 invoke。
3. 可见性 effect 改为：
   ```ts
   // 面板变为可见：首次自动生成，或代码在上次生成后有变化时自动重新生成
   useEffect(() => {
     if (!visible || loading) return;
     if (lastGeneratedCodeRef.current === null || lastGeneratedCodeRef.current !== code) {
       void generate();
     }
   }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
   ```

**行为说明**：

- 首次可见：ref 为 null → 生成（兼容原 `!hasResult` 逻辑）；
- 已为代码 A 生成、代码未变、来回切换 tab → 不重复生成；
- 代码改为 B 后切回 → 自动重新生成（核心修复）；
- 同一份代码此前报错（如"未找到函数定义"）→ 切换不重复 invoke；用户改码后再切回才重新检测。

**不改**：编辑过程中的实时重新生成（每键 invoke 会打扰输入，保留手动刷新按钮）；不新增"已过期"角标（自动刷新已覆盖主场景）。

**测试**（扩展 [src/components/FlowchartPanel.test.tsx](src/components/FlowchartPanel.test.tsx)）：

- 初始可见生成完成后，改 `code` prop 并以 visible false→true 触发 → `generate_cfg` invoke 次数 +1；
- `code` 不变、visible 来回切换 → 无新增 invoke。

### 7.4 验证步骤

```bash
pnpm test                    # 前端全部测试（含上述新增/扩展用例）
cd src-tauri && cargo test   # 后端无改动，确认无回归
```

人工验收（AGENTS.md：测试通过 ≠ 验收通过）：

1. **S0-1**：tab A 运行交互程序（如 `int x; cin >> x;`）→ 切到 tab B 等程序退出 → tab B 状态栏不出现退出信息；切回 A 正常显示 exit code / 耗时。
2. **S0-2**：任一输出正确的用例打开"对比差异" → 显示"完全一致"而非"加载中"。
3. **S0-3**：生成流程图 → 修改代码（如新增 if 分支）→ 切到测试面板再切回 → 流程图自动更新为新结构。

### 7.5 实施记录（2026-08-19）

按方案执行完毕，全部通过验证：

- **7.1**：[useRunManager.ts](src/hooks/useRunManager.ts) 新增 `ptyInitiatorTabId` 字段（state 定义、初始化、startInteractive 存入、编译失败/catch/stopInteractive/onPtyExit/reset 六处清理），两个退出函数改用发起 tab 作快照键并加 `isStillActive` 守卫；[useRunManager.test.ts](src/hooks/useRunManager.test.ts) 7 处 beforeEach 补重置，新增 2 个切 tab 场景用例。
- **7.2**：zh/en 各新增 `diffNoDiff` 键，[DiffDialog.tsx](src/components/DiffDialog.tsx) 空分支改用新键；新建 [DiffDialog.test.tsx](src/components/DiffDialog.test.tsx)（5 用例）。**实施修正**：触发面比方案预估窄——`computeLineDiff` 对非空相同内容返回 equal 行，仅两侧均为空时才命中空分支（已在正文与 7.2 根因处更正）；空输出测试点场景的修复仍成立。
- **7.3**：[FlowchartPanel.tsx](src/components/FlowchartPanel.tsx) 新增 `lastGeneratedCodeRef`，generate 首行标记版本（含失败路径），可见性 effect 改为"代码已变则自动重新生成"；[FlowchartPanel.test.tsx](src/components/FlowchartPanel.test.tsx) 新增 2 个 invoke 次数用例。
- **验证**：`pnpm test` 947/947 通过（23 文件，净增 9 用例）；`cargo test` 271/271 通过（后端无改动）；`tsc --noEmit` 无错误。
- 人工验收（7.4 三项）待用户在真实 UI 中确认。

---

## 八、S0-补充方案：切换 tab 终止运行 + 终端清空（已执行，2026-08-19）

S0 验收讨论中用户提出的行为变更：**切换 tab 即放弃当前运行**。经讨论确认以下决策（2026-08-19）：

1. 切换 tab → 终止**一切**进行中的运行（交互运行 + 批量编译运行/测试）——理由：切换即"开始写下一个代码"，长测试也不保留
2. 被终止的运行**显示得像从未运行过**（不写"已取消"退出快照）
3. 终端内容随切换清空（终端 = 当前 tab 的草稿区，不跨 tab 保留）
4. 手动停止按钮行为不变（仍显示"已取消"）
5. **被终止 tab 的历史快照一并清空**：切回该 tab 彻底空白（不显示上一次已完成运行的结果）——用户最终确认

### 8.1 事实核查（已逐项验证）

- **切换汇聚点唯一**：[App.tsx L377-380](src/App.tsx#L377-L380) 的 `useEffect([activeId])` 调 `setActiveTab(activeId)`——点标签、关 tab 跳转、新建、打开文件全部经过此路径
- **现 setActiveTab 是纯快照恢复**（[useRunManager.ts L133-144](src/hooks/useRunManager.ts#L133-L144)），无终止逻辑、无同 tab 守卫
- **批量运行的"从未运行过"机制已存在**：`stop()` 调后端 `stop_run` 取消（[run_manager.rs](src-tauri/src/run_manager.rs) cancel token），前端守卫（`s.activeRunId !== runId` → 丢弃）保证晚到结果不写快照——正是决策 2 要的语义
- **交互运行编译期停止机制已有**：startInteractive 预生成 runId + 成功分支守卫幂等重调 `stop_pty_run`（[L356-366](src/hooks/useRunManager.ts#L356-L366)），切换发生在编译期同样走通
- **Terminal 监听已按 run_id 过滤**（[Terminal.tsx L558/L579](src/components/Terminal.tsx#L558)），且 rAF + `cancelAnimationFrame`（L621-631）已封闭在途输出——切换后的残余 pty_output 不会写入新 tab 终端
- **stop_pty_run 路径 pty_exit 单次 emit**（[pty_run.rs L319/L520](src-tauri/src/commands/pty_run.rs#L319)），切换后残余 pty_exit 事件需 onPtyExit 守卫（见 8.2-B）
- **已知边界**：`activeId` 为 null（关闭最后一个 tab）时汇聚 effect 提前 return，setActiveTab 不会被调（见 8.2-E）

### 8.2 修改方案（全部前端，无 Rust 改动、无新依赖，约 30 行）

**A. `setActiveTab` 增加终止逻辑**（[useRunManager.ts](src/hooks/useRunManager.ts)，核心）：

```ts
setActiveTab: (tabId) => {
  const s = get();
  if (s.activeTabId === tabId) return;            // 同 tab 守卫：不杀运行
  let resultsByTab = s.resultsByTab;
  if (s.activeRunId) {
    // 决策 5：清发起 tab 快照（含历史），切回彻底空白。
    // 运行存续期间 activeTabId 必为发起 tab（任何切换都会在此终止运行）
    const initiatorTabId = s.activeTabId;
    if (initiatorTabId) {
      resultsByTab = { ...resultsByTab };
      delete resultsByTab[initiatorTabId];
    }
    if (s.kind === "interactive") {
      // 决策 1+2：终止 PTY（含编译期，stop_pty_run 幂等），不写退出快照
      void invoke<boolean>("stop_pty_run", { runId: s.activeRunId }).catch(() => {});
    } else {
      // 批量：异步取消后端，晚到结果由既有 runId 守卫丢弃
      void invoke<boolean>("stop_run", { runId: s.activeRunId }).catch(() => {});
    }
  }
  // ……以下为原有快照恢复逻辑（从 resultsByTab 读新 tab 快照），不变
};
```

不复用 `stop()`/`stopInteractive()` 的原因：二者面向手动停止（stopInteractive 写 killedBy:"cancelled" 快照、stop() await 后端期间存在互斥窗口），与决策 2 冲突；内联 4 行更直接。

**B. `onPtyExit` 加守卫**（1 行）：`if (!s.ptyRunId) return s;`——切换清空后残余 pty_exit 事件到达时不写快照、不破坏新 tab 可能已开始的新运行（否则会把新 run 的 activeRunId 清掉）。

**C. `runTests` 的 test_progress 回调加 runId 守卫**（1 行）：`if (get().activeRunId !== runId) return;`——顺带修复既有小问题：当前测试运行中切 tab，旧进度事件会继续刷新新 tab 的进度条。

**D. Terminal 随 tab 切换清空**（[Terminal.tsx](src/components/Terminal.tsx)，约 5 行）：订阅 `activeTabId`，effect 变化 → `term.reset()`（RIS 全清含回滚缓冲）。光标隐藏已由 runId-null 分支统一处理，无需额外动作。

**E. App.tsx 汇聚点覆盖空 tab**（1 行调整）：`setActiveTab(activeId)` 移到 `if (!activeId) return` 之前——关闭最后一个 tab 时同样终止运行（当前代码该场景不经过 setActiveTab）。

### 8.3 行为定义（含边界）

| 场景 | 行为 |
|------|------|
| 交互运行中切 tab | 进程终止（含编译期）→ 终端清空 → **发起 tab 快照删除，切回彻底空白** |
| 批量编译/测试中切 tab | 后端取消 → 晚到结果被守卫丢弃 → **发起 tab 快照删除，切回彻底空白** |
| 切回被终止的 tab | 彻底空白（历史快照已清，决策 5） |
| 同 tab 重复切换 | no-op，运行不受影响 |
| 关闭最后一个 tab | 同样终止运行（E 项） |
| 切换后残余事件（pty_output/pty_exit/晚到结果） | rAF 机制 + B 守卫 + 既有守卫三重封闭，全部"从未运行过" |
| 手动停止按钮 | 不变：显示"已取消" |

**竞态说明**：切换瞬间程序恰好自然退出的窗口，由 B 守卫兜底——事件到达时 ptyRunId 已清空，直接忽略，与"从未运行过"一致。

### 8.4 与 S0-1 的关系

S0-1 的 `ptyInitiatorTabId` **保留不回滚**：本方案消灭了"PTY 生命周期跨越 tab 切换"的主场景，但它是残余竞态的安全网，且手动停止（stopInteractive）的正确性仍依赖它。B2-3（pty_exit 双发）的实际影响面随之进一步收窄。

### 8.5 测试计划

[useRunManager.test.ts](src/hooks/useRunManager.test.ts) 新增：

1. 交互运行中 `setActiveTab` 切换 → `stop_pty_run` 被调、状态归零、**发起 tab 快照条目被删除（含运行前预置的历史快照）**
2. 切换后 `onPtyExit`（模拟残余事件）→ 无快照写入、不破坏后续新运行
3. 同 tab `setActiveTab` → 运行不被终止、快照保留
4. 批量运行中切换 → `stop_run` 被调、发起 tab 快照删除、晚到 resolve 被守卫丢弃
5. 既有 60+ 用例全量回归（无运行时切换的快照恢复语义不变）

Terminal 清空 effect：[Terminal.test.ts](src/components/Terminal.test.ts) 为逻辑级测试，视其结构补用例；若无组件级设施则由人工验收覆盖。

人工验收：

1. tab A 跑 `int x; cin >> x;` → 切 tab B → 终端已清空、B 可立即运行新程序（互斥已解除）；切回 A → 彻底空白（无退出信息、无历史结果）
2. 500 例测试跑到一半切 tab → 进度消失、不串台；切回 → 彻底空白（历史快照已清，决策 5）
3. 切回 tab A 再切回 B，反复 → 终端始终干净
4. 关闭最后一个 tab（运行中）→ 运行同样终止（E 项）

### 8.6 风险

- 行为变更点：切换放弃进行中的长测试（用户已确认）；关闭最后一个 tab 也会终止运行（新增，语义一致）
- 其余风险低：全部复用既有后端命令与守卫机制，无并发新路径

### 8.7 实施记录（2026-08-19）

按 8.2 方案执行完毕，全部通过验证：

- **A**：[useRunManager.ts](src/hooks/useRunManager.ts) `setActiveTab` 增加同 tab 守卫 + 运行终止（交互 `stop_pty_run` / 批量 `stop_run`，均 fire-and-forget）+ **删除发起 tab 快照条目**（决策 5，含历史）+ 运行态字段归零
- **B**：`onPtyExit` 增加 `if (!s.ptyRunId) return s;` 守卫。实施确认：Terminal 的 `pty_exit` 监听器按闭包捕获的 runId 过滤且切换后即解绑，旧事件最多在解绑前到达、由本守卫兜底；新运行注册新闭包，run_id 不匹配直接过滤——双层封闭，无需改 onPtyExit 签名
- **C**：`runTests` 的 `test_progress` 回调增加 runId 守卫
- **D**：[Terminal.tsx](src/components/Terminal.tsx) 新增 `tabId` prop + effect（`[tabId]` 变化 → `term.reset()`，含回滚缓冲）；[App.tsx](src/App.tsx) 传入 `tabId={activeId}`
- **E**：[App.tsx](src/App.tsx) `setActiveTab(activeId)` 移至 `if (!activeId) return` 之前，关闭最后一个 tab 同样终止运行
- **测试**：[useRunManager.test.ts](src/hooks/useRunManager.test.ts) 改写 3 个旧用例（其描述的"切走后运行继续"场景已被新架构消灭：运行中切换终止+快照清空、残余 onPtyExit 忽略、stopInteractive no-op）+ 新增 2 个用例（同 tab no-op、历史快照一并清空）+ 修正 2 个受影响用例（clearTab 序列改为生产真实序列；testProgress 用例补 stop_run mock）
- **验证**：`pnpm test` 949/949 通过（净增 2 用例）；`cargo test` 271/271 通过（后端无改动）；`tsc --noEmit` 无错误
- 人工验收（8.5 三项）待用户在真实 UI 中确认

---

## 九、S1-④ 错误码体系最小版（已执行，2026-08-19）

### 9.1 范围决策

现状核查发现基础设施已存在：`AppError` 以 `{code, params}` 序列化、前端 `errors.*` i18n 键 5 个、
错误转换逻辑在前端有 3 处副本（useRunManager / useTabs / TestCasesPanel，均能消费 `{code, params}`）。
真正的缺口是后端错误码粒度与两处硬编码匹配。

最小版聚焦三个高价值错误路径，**不**做全量收敛（其余 88 处 `AppError::Other` 留待后续按 surface 分批处理）：

| 错误码 | 变体 | 替代的旧行为 | 消费方 |
|--------|------|------------|--------|
| `cfg_no_function` | unit | 后端返回中文字符串 → 前端 `detail.includes("未找到函数定义")` 子串匹配 | FlowchartPanel |
| `invalid_encoding` | unit | `read_to_string` 报 `Io` → 用户看到英文技术串 "stream did not contain valid UTF-8" | open_file（GBK 文件场景，S1-⑨ 一并完成） |
| `file_too_large` | `{size, max_mb}` 参数化 | 中文 detail 字符串 → `Other` | open_file |

### 9.2 改动清单

- [error.rs](src-tauri/src/error.rs)：新增 `CfgNoFunction` / `InvalidEncoding` / `FileTooLarge { size, max_mb }` 变体 + Display + **序列化契约测试**
- [documents.rs](src-tauri/src/commands/documents.rs)：`check_file_size` → `FileTooLarge`；新增 `read_file_utf8`（`fs::read` + `String::from_utf8` → `InvalidEncoding`，零依赖明确报错，避免 `from_utf8_lossy` 静默乱码破坏原文件）；测试 2 新增 1 更新
- [cfg.rs](src-tauri/src/parser/cfg.rs)：`generate_cfg` 签名 `Result<_, String>` → `Result<_, AppError>`，"未找到函数定义" → `CfgNoFunction`；[parser_cmd.rs](src-tauri/src/commands/parser_cmd.rs) 随之删除 String 转换层
- [zh.ts](src/locales/zh.ts) / [en.ts](src/locales/en.ts)：`errors.*` 新增 3 键
- [types/index.ts](src/types/index.ts)：`AppErrorPayload.params` 放宽为 `Record<string, string | number>`（`FileTooLarge` 参数为数字）
- [FlowchartPanel.tsx](src/components/FlowchartPanel.tsx)：`formatCfgError` 由中文子串匹配改为 `code === "cfg_no_function"`；detail 缺失时回退显示 code（不再显示空 detail）

### 9.3 契约测试的即时价值

新增的 `serialize_contract` 测试在首次运行即抓到一个事实：**adjacently tagged enum 的 unit variant
序列化不含 `params` 字段**（`{"code":"cfg_no_function"}` 而非 `{"code":"cfg_no_function","params":null}`）。
这正是前端三处转换逻辑都必须用可选链 `err.params?.detail` 的根本原因——契约现在被测试固化，
后续任何人改动序列化方式都会被立即抓住。

### 9.4 明确不处理项（及理由）

- `hexToRgb` 中文异常（colorExtract.ts）：内部 invariant，调用方全部为主题配置计算，用户输入不可达——与 B1-2 expect 同类，不动
- `useTestSuite.ts` "套件未初始化"：生产不可达（导入按钮仅在套件存在时可用），防御性 throw 保留
- 3 处 `localizeError` 副本：待 S1-⑥（替换 alert）与 S1-⑧（错误条组件）统一错误展示层时合并，届时单一消费入口自然成立
- `errors.cfg_no_function` 与 `panel.flowchartNoFunction` 文案重复：前者为通用 localizeError 兜底键（防未知 code 显示原始键名），后者为面板引导文案，双键属有意冗余

### 9.5 验证

- `cargo test` 274/274（新增 3：serialize_contract、read_file_utf8 GBK 拒绝/UTF-8 通过；更新 2：check_file_size 超限断言、cfg test_no_function 变体断言）
- `pnpm test` 949/949（更新 FlowchartPanel 2 处旧形状 mock，无新增用例——组件与纯函数路径均有既有覆盖）
- `tsc --noEmit` 无错误
- 人工验收建议：用 VS/Dev-C++ 保存一个 GBK 编码 .cpp → 打开 → 应显示"文件不是 UTF-8 编码（可能为 GBK/ANSI），请转存为 UTF-8 后重试"；无函数代码生成流程图 → 显示"未找到函数定义"（en 语言下均应为英文）

---

## 十、S1-⑤ 测试诊断进 UI + 一键复制（已执行，2026-08-19）

### 10.1 现状核查修正

`first_diff` 实际已在卡片 UI 中（`tests.diffPosition`）；真正的缺口是后端 `test_judge_info` 事件携带的
**转义诊断视图**（`expected_esc`/`actual_esc`：空格=·、换行=\n）只进 DevTools Console——
而"输出看起来一样却 WA"（不可见字符差异）恰恰是初学者最高频的排障场景。

### 10.2 改动清单（纯前端）

- [useRunManager.ts](src/hooks/useRunManager.ts)：新增 `judgeInfo: { runId, byCase }` 状态；
  `runTests` 启动时**初始化**为 `{ runId, byCase: {} }`（而非 null——null 期旧 run 残余监听可抢占播种
  错误 runId，导致新 run 自己的事件反被守卫挡掉）；judge 监听按 runId 守卫写入；console.log 保留（开发者）
- [TestCasesPanel.tsx](src/components/TestCasesPanel.tsx)：
  - 失败卡片新增「复制诊断」按钮（Check/AlertTriangle/Copy 三态反馈，1.5s 复位，失败不再静默——回应 A1-6）
  - 新增「诊断（转义对比）」`<details>`：期望/实际转义视图并排 + 图例（`· = 空格，\n = 换行…`）
  - `judgeMap` 以 `judgeInfo.runId === testResult.run_id` 为展示门槛——tab 快照恢复旧结果时不会串到新运行的诊断
  - 导出纯函数 `formatCaseDiagnostic`（复制文本构造：judge 完整格式 / 无 judge 退化格式 + stdout 摘录兜底 + stderr 512 字符截断）
- [global.css](src/styles/global.css)：`.testcase-judge-details` / `.judge-esc-*` 样式（复用 `diff-pre`，全直角）
- [zh.ts](src/locales/zh.ts) / [en.ts](src/locales/en.ts)：新增 5 键（diagnosis / diagLegend / copyDiagnosis / copyDiagOk / copyDiagFail）

### 10.3 复制文本格式（教学场景，发送给老师）

```
[3/10] 样例三 WA strict=false exit=0 15/1000ms diff=3 len=10/11
期望输出: [1 2\n]
实际: [1··2\n]
stderr: ...(非空时)
```

技术字段保持 OI 通用缩写（WA/exit/diff），标签走 i18n；大输出（>4KB，后端 JUDGE_INLINE_MAX 限制）
无转义视图时退化为 stdout 前 512 字符摘录。

### 10.4 测试

- [useRunManager.test.ts](src/hooks/useRunManager.test.ts) +2：judge 事件按 case_id 存入（runId 归属）；
  旧 run 残余事件不写入新 run（runId 守卫）。7 处 beforeEach 补 `judgeInfo: null` 重置
- 新建 [TestCasesPanel.test.tsx](src/components/TestCasesPanel.test.tsx)：`formatCaseDiagnostic` 4 用例
  （完整格式 / 大输出摘录 / 无 judge 退化 / stderr 截断）
- 验证：`pnpm test` 955/955（净增 6）· `cargo test` 274/274（后端零改动）· `tsc --noEmit` 无错误

### 10.5 人工验收建议

1. 跑一组含 WA 的测试 → 失败卡片出现「复制诊断」按钮；点按 → 变"已复制"，粘贴到文本编辑器核对格式
2. 构造"末尾多空格/换行"的 WA 用例 → 展开「诊断（转义对比）」→ 肉眼可见 `·` 与 `\n` 差异及图例
3. 测试完成后切到其他 tab 再切回 → 诊断仍显示（同 runId 配套）；在另一 tab 重新跑测试后切回 → 旧结果快照不显示新诊断（门槛生效）

---

## 十一、S2 稳定性（⑩⑬⑭ 已执行，2026-08-19；⑪⑫ 待 Windows 实机）

### 11.1 ⑩ ZIP unwrap 治理 + 非 UTF-8 文件名实测

**实测结论（推翻原报告"必现 panic"判断）**：手写含 GBK 原始字节文件名的畸形 ZIP（zip crate 的
ZipWriter 只接受 &str，测试按 ZIP 规范手写二进制结构）实测两条路径均不 panic：

- 未设 UTF-8 标志：zip 2.4.2 按 CP437 解码为合法 UTF-8，`.in`/`.out` 解码后同 stem 仍配对导入
- 设 UTF-8 标志但字节非法：走 `from_utf8_lossy` 替换为 U+FFFD，同 stem 仍配对导入

即 `name()` 永不产生非法 UTF-8，原 `file_map.get(&key).unwrap()` 实为不可达的不变量。

**治理（防御性兜底，无论实测结果如何都改掉）**：

- [importer.rs](src-tauri/src/importer.rs)：两处 `unwrap()` → `ok_or_else` 返回 `AppError`
- [unix.rs](src-tauri/src/runner/unix.rs) / [windows.rs](src-tauri/src/runner/windows.rs)（B1-2）：
  `child.stdout.take().expect(...)` → `ok_or_else` 返回 `AppError::ProcessGroup`
  （spawn 成功时 piped 句柄必为 Some，语言保证；纯防御）

**测试** +2（importer）：`zip_non_utf8_filename_cp437_no_panic`、
`zip_non_utf8_filename_flagged_lossy_no_panic`（含 `write_raw_name_zip` 手写 ZIP helper 与无表 CRC-32）

### 11.2 ⑬ settings.json 损坏先备份再回退

[settings.rs](src-tauri/src/settings.rs) `load()`：JSON 完全无法解析分支（写一半崩溃 / 外部编辑损坏）
原先静默返回默认值；现先把损坏文件改名为 `settings.json.corrupt` 再回退，编译器路径等配置可人工找回。

- `remove_file` + `rename` 两步：Windows 的 rename 不覆盖已存在目标，先删旧备份保证跨平台幂等
- 均为 best-effort（`let _`）：备份失败不阻断回退
- rename（而非 copy）移走损坏文件：下次启动不会重复备份；正常 save 流程重建干净的 settings.json

**测试** +2：损坏 → 默认值 + 备份存在且内容一致 + 原文件已移走；再次损坏 → 新备份覆盖旧备份

### 11.3 ⑭ pty_exit 双发窗口收窄（并彻底关闭）

[pty_run.rs](src-tauri/src/commands/pty_run.rs) `stop_pty_run` 原顺序 kill → mark_cancelled 之间存在
竞态窗口（等待线程在 kill 后、mark 前检查标志会自行 emit，随后 stop 再 emit → 双发）；快速连点停止
（run 已被首次 stop remove）同样双发。

**修复（抢占标志 + 重排序）**：

- [pty.rs](src-tauri/src/pty.rs) PtyManager 新增 `exit_claims` 表（与 `cancelled_flags` 同模式）：
  `register_exit_claim` / `try_claim_exit`（首次 `swap(true)` 者获得 emit 权）/ `remove` 清理
- 等待线程 emit 守卫升级为双重：`!cancelled && !exit_claim.swap(true)`
- `stop_pty_run` 重排：**try_claim（必须在 kill 前——等待线程醒来后可能先清理标志表）→
  mark_cancelled → kill → cancel/complete → 抢占成功才 emit → remove**
- 全部交错情形（用户停止 vs 自然退出 vs 连点停止）下 pty_exit **恰好一次**：
  等待线程持有 Arc 副本，自身 remove 清表后 swap 仍生效

**测试** +3（pty）：首次抢占成功/二次失败；等待线程 Arc 副本在 remove 后仍可用（表查找侧被拦截）；
未知 run 抢占失败（连点停止场景）

### 11.4 ⑪ Windows PTY 复用 JobObject 杀进程树（已盲写，待 Windows 实机验证）

**方案**：PTY 交互运行加入 KILL_ON_JOB_CLOSE JobObject（无 CPU 时间限制——交互程序不限时长），
kill 时 `TerminateJobObject` 树杀整棵进程树（学生程序 `system()`/fork 的孙进程），对齐 Unix `kill(-pgid)`。

- [windows.rs](src-tauri/src/runner/windows.rs)：`SendHandle` 公开并新增 `terminate_tree()`；
  新增 `create_kill_on_close_job()`；`assign_process_to_job` 公开（签名改 `&SendHandle`），
  runner 内部调用点同步更新
- [pty.rs](src-tauri/src/pty.rs)：`PtySession` 新增 `job` 字段（`Option`——创建/加入失败降级 `None`
  即旧行为）；`kill()` Windows 分支改为 JobObject 树杀优先、`TerminateProcess` 兜底；
  会话 drop 时句柄关闭，KILL_ON_JOB_CLOSE 兜底杀残留孙进程（≈ Unix master 关闭发 SIGHUP 的语义）。
  字段声明序保证 job（杀进程）先于 `_work_dir`（删 exe）drop
- [pty_run.rs](src-tauri/src/commands/pty_run.rs)：spawn 后创建 JobObject 并 assign，
  失败均降级不阻断交互运行；`PtySession::new` 按平台 cfg 构造

**测试** +1（仅 Windows 编译）：`pty_kill_with_job_kills_process_tree`——cmd.exe 主进程 +
timeout.exe 孙进程（30s），kill 后 tasklist 断言孙进程被树杀；CI 等受限环境
（AssignProcessToJobObject 降级）自动跳过孙进程断言。

**盲写风险说明**：macOS 上无法编译 `cfg(windows)` 路径；Windows API 用法逐行镜像本文件既有
JobObject 代码（CreateJobObjectW/SetInformationJobObject/TerminateJobObject 签名一致），
已通过 macOS 全量测试（281/281，非 Windows 路径零回归）。待 Windows 实机：
`cargo test` + 手工验收（见 11.7）。

### 11.5 ⑫（待 Windows 实机）

ConPTY Drop 阻塞：纯实机观测项（停止 PTY 后观察等待线程是否退出）

### 11.6 验证

`cargo test` 281/281（macOS；净增 8：importer +2 / settings +2 / pty +3 / pty 树杀 +1 仅 Windows 编译）·
`pnpm test` 955/955（前端零改动）· ⑪ 的 cfg(windows) 代码为盲写，待 Windows 实机 `cargo test` 验证

### 11.7 人工验收建议

1. **⑬**：手动破坏 settings.json（截断一半）→ 启动应用 → 设置为默认值，且数据目录出现
   settings.json.corrupt（内容 = 截断的原文）
2. **⑭**：运行交互程序 → 程序自然退出的瞬间连点停止按钮 → 终端退出信息只出现一次；
   运行中快速连点停止 → 同样只一次
3. **⑩**：导入一个用老牌 Windows 压缩工具（GBK 文件名）打包的 ZIP → 不崩溃，用例名显示为乱码
   （CP437 解码结果），可通过重命名修正
4. **⑪**（Windows）：交互运行 `int main(){ system("ping -n 31 127.0.0.1"); }` →
   点停止 → 打开任务管理器确认 PING.EXE 已消失（旧行为会残留 30 秒）



- 前端：src/ 下全部组件、hooks、utils、monaco、locales、styles、vite.config.ts、index.html
- 后端：src-tauri/src/ 下全部 commands、runner、parser、缓存/设置/套件/PTY 模块
- 工程配置：package.json、Cargo.toml、tauri.conf.json、.github/workflows/build.yml、docs/adr/
- 关键发现（alert 阻塞、runner expect、PTY 写错 tab）已用全局搜索二次验证属实
- 2026-08-19 外部评审：Gemini / GPT 双 AI 独立交叉评审（结论见第六节）；裁决修正处均已回写至正文对应条目（B1-2、B2-2、A3-2、A3-3、P1-2、P2-5）
