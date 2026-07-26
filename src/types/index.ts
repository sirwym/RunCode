// 与 Rust 端 run_manager.rs RunKind 对应
export type RunKind = "compile_run" | "test_run" | "interactive";

// 与 Rust 端 executor.rs KillReason 对应（已清理死变体）
export type KillReason = "timeout" | "signal" | "cancelled";

// 与 Rust 端 error.rs AppError 对应（{ code, params } 结构）
export interface AppErrorPayload {
  code: string;
  params?: Record<string, string>;
}

export type RunStage = "compile_failed" | "ran";

// 与 Rust 端 pty_run.rs StartPtyResult 对应（tag = "status"）
export type StartPtyResult =
  | { status: "success"; run_id: string }
  | { status: "compile_failed"; run_id: string; stderr: string };

// g++ 编译错误解析结果（parseGccErrors 产出）
export interface CompileError {
  line: number;
  column: number;
  message: string;
}

export interface RunResult {
  run_id: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
  killed_by: KillReason | null;
  truncated: boolean;
  stage: RunStage;
  /** 运行阶段内存峰值（KB）。编译失败时为 0 */
  max_rss_kb: number;
}

// ============ 文件型测试套件 ============

// 与 Rust 端 test_suite.rs CaseMeta 对应
export interface CaseMeta {
  id: string;
  name: string;
  input_size: number;
  expected_size: number;
  strict: boolean;
}

// 与 Rust 端 test_suite.rs TestSuiteManifest 对应
export interface TestSuiteManifest {
  suite_id: string;
  doc_path: string | null;
  cases: CaseMeta[];
  updated_at: number;
  schema_version: number;
}

// 与 Rust 端 test_suite.rs CasePreview 对应
export interface CasePreview {
  id: string;
  name: string;
  input_size: number;
  expected_size: number;
  strict: boolean;
  input_preview: string;
  expected_preview: string;
  is_large: boolean;
}

// ============ 测试运行结果 ============

// 与 Rust 端 commands/test_runner.rs 的 TestCaseResult 对应
export interface TestCaseResult {
  id: string;
  passed: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
  killed_by: KillReason | null;
  truncated: boolean;
  first_diff: number | null;
  /** 内存峰值（KB） */
  max_rss_kb: number;
}

// 与 Rust 端 commands/test_runner.rs 的 TestRunResult 对应
export interface TestRunResult {
  run_id: string;
  success: boolean;
  total: number;
  passed: number;
  stage: RunStage;
  compile_stdout: string;
  compile_stderr: string;
  results: TestCaseResult[];
}

// test_progress 事件（与 Rust 端 TestProgress 对应，tag = "status"）
export type TestProgress =
  | { status: "running"; run_id: string; case_id: string; index: number; total: number }
  | { status: "passed"; run_id: string; case_id: string; index: number; total: number; duration_ms: number }
  | { status: "failed"; run_id: string; case_id: string; index: number; total: number; duration_ms: number; first_diff: number | null }
  | { status: "cancelled"; run_id: string; index: number; total: number };

// ============ 批量导入 ============

// 与 Rust 端 importer.rs ImportResult 对应
export interface ImportResult {
  imported: number;
  skipped: string[];
}

// ============ 应用设置 ============

// 与 Rust 端 settings.rs AppSettings 对应
export interface AppSettings {
  compiler: CompilerSettings;
  runtime: RuntimeSettings;
  test: TestSettings;
  general: GeneralSettings;
  editor: EditorSettings;
  current_language: string;
  schema_version: number;
}

export interface CompilerSettings {
  cpp_standard: string;
  opt_level: string;
  warnings: string;
  extra_args: string;
  compiler_path: string | null;
  template: string;
}

export interface RuntimeSettings {
  compile_timeout_secs: number;
  run_timeout_secs: number;
  cpu_secs: number;
  fsize_mb: number;
}

// 测试设置（多样例测试相关）
export interface TestSettings {
  fsize_mb: number;
  test_time_limit_ms: number;
}

// 软件层通用设置（与编辑器/编程语言无关）
export interface GeneralSettings {
  locale: string;
  theme: string;            // dark / light / system
  layout: string;           // horizontal / vertical
  auto_hide_panel: boolean; // 自动隐藏输出面板
}

// 编辑器（Monaco）设置
// 字体统一为 JetBrains Mono（不再持久化 font_family 字段）
export interface EditorSettings {
  font_size: number;
  theme: string;                  // vs / vs-dark / hc-black
  terminal_font_size: number;
  indent_style: string;           // space / tab
  indent_size: number;
  line_numbers: string;           // on / off / relative
  enable_suggestions: boolean;
  auto_closing_brackets: boolean;
  auto_closing_quotes: boolean;
  word_wrap: string;              // on / off
  minimap_enabled: boolean;
}

// ============ 最近文件 ============

// 与 Rust 端 recent_files.rs RecentEntry 对应
export interface RecentEntry {
  path: string;
  name: string;
  opened_at: number;
}

// ============ 多标签页 ============

export type TabLanguage = "cpp" | "python" | "java";

export interface Tab {
  id: string;
  path: string | null;
  fileName: string;
  content: string;
  savedContent: string;
  dirty: boolean;
  language: TabLanguage;
  suiteId: string | null;
}

// ============ 格式化 ============

// 与 Rust 端 formatter.rs FormatResult 对应
export interface FormatResult {
  code: string;
  backend: "clang-format" | "builtin";
}
