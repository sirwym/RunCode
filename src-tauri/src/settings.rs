use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

const SCHEMA_VERSION: u32 = 3;

/// 应用设置（持久化到 app_data_dir/settings.json）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub compiler: CompilerSettings,
    pub runtime: RuntimeSettings,
    /// 测试设置（多样例测试相关）
    #[serde(default)]
    pub test: TestSettings,
    /// 软件层通用设置（与编辑器/编程语言无关）
    pub general: GeneralSettings,
    /// 编辑器（Monaco）设置
    pub editor: EditorSettings,
    /// 当前选中的编程语言：cpp / python / java（本轮仅 cpp 生效）
    #[serde(default = "default_current_language")]
    pub current_language: String,
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
}

fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

fn default_current_language() -> String {
    "cpp".into()
}

/// 编译器设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompilerSettings {
    /// C++ 标准：c++11 / c++14 / c++17 / c++20
    #[serde(default = "default_cpp_standard")]
    pub cpp_standard: String,
    /// 优化级别：O0 / O1 / O2 / O3
    #[serde(default = "default_opt_level")]
    pub opt_level: String,
    /// 警告级别：none / wall / wall_extra
    #[serde(default = "default_warnings")]
    pub warnings: String,
    /// 附加参数（自由输入，黑名单校验）
    #[serde(default)]
    pub extra_args: String,
    /// 编译器路径（None = 自动探测 clang++/g++）
    #[serde(default)]
    pub compiler_path: Option<String>,
    /// C++ 代码模板（新建文件时使用）
    #[serde(default = "default_cpp_template")]
    pub template: String,
}

fn default_cpp_standard() -> String {
    "c++17".into()
}
fn default_opt_level() -> String {
    "O0".into()
}
fn default_warnings() -> String {
    "wall_extra".into()
}
fn default_cpp_template() -> String {
    "#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << \"Hello, RunCode!\" << endl;\n    return 0;\n}\n".into()
}

/// 运行时设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeSettings {
    /// 编译超时（秒）
    #[serde(default = "default_compile_timeout")]
    pub compile_timeout_secs: u64,
    /// 运行超时（秒）
    #[serde(default = "default_run_timeout")]
    pub run_timeout_secs: u64,
    /// CPU 时间上限（秒）
    #[serde(default = "default_cpu_secs")]
    pub cpu_secs: u64,
    /// 文件大小上限（MB）—— 已废弃，仅用于向后兼容，迁移到 test.fsize_mb
    #[serde(default = "default_fsize_mb")]
    pub fsize_mb: u64,
}

fn default_compile_timeout() -> u64 {
    10
}
fn default_run_timeout() -> u64 {
    5
}
fn default_cpu_secs() -> u64 {
    5
}
fn default_fsize_mb() -> u64 {
    10
}

/// 测试设置（多样例测试相关）
///
/// 显式 Default：fsize_mb=10, test_time_limit_ms=1000。
/// 不用 #[derive(Default)]（那会让 fsize_mb=0，与默认值 10 不一致，
/// 导致迁移逻辑无法区分"用户写了 0"和"字段缺失"）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestSettings {
    /// 文件大小上限（MB），从 RuntimeSettings 迁移
    #[serde(default = "default_fsize_mb")]
    pub fsize_mb: u64,
    /// 单例测试时间限制（毫秒），超过则该用例判失败
    #[serde(default = "default_test_time_limit_ms")]
    pub test_time_limit_ms: u64,
}

impl Default for TestSettings {
    fn default() -> Self {
        Self {
            fsize_mb: default_fsize_mb(),
            test_time_limit_ms: default_test_time_limit_ms(),
        }
    }
}

fn default_test_time_limit_ms() -> u64 {
    1000
}

/// 软件层通用设置（与具体编程语言/编辑器无关）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralSettings {
    /// 界面语言：zh / en
    #[serde(default = "default_locale")]
    pub locale: String,
    /// 软件主题：dark / light / system
    #[serde(default = "default_theme")]
    pub theme: String,
    /// 布局方向：horizontal（左右分栏，默认） | vertical（上下分栏）
    #[serde(default = "default_layout")]
    pub layout: String,
    /// 是否自动隐藏输出面板（仅在执行时展开）
    #[serde(default)]
    pub auto_hide_panel: bool,
}

/// 编辑器（Monaco）设置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorSettings {
    /// 编辑器字号
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    /// 编辑器主题：vs / vs-dark / hc-black
    #[serde(default = "default_editor_theme")]
    pub theme: String,
    /// 终端字号
    #[serde(default = "default_terminal_font_size")]
    pub terminal_font_size: u32,
    /// 缩进方式：space / tab
    #[serde(default = "default_indent_style")]
    pub indent_style: String,
    /// 缩进大小
    #[serde(default = "default_indent_size")]
    pub indent_size: u32,
    /// 行号显示：on / off / relative
    #[serde(default = "default_line_numbers")]
    pub line_numbers: String,
    /// 代码补全开关
    #[serde(default = "default_true")]
    pub enable_suggestions: bool,
    /// 括号补全开关
    #[serde(default = "default_true")]
    pub auto_closing_brackets: bool,
    /// 引号补全开关
    #[serde(default = "default_true")]
    pub auto_closing_quotes: bool,
    /// 自动换行：on / off
    #[serde(default = "default_word_wrap")]
    pub word_wrap: String,
    /// 小地图开关
    #[serde(default = "default_false")]
    pub minimap_enabled: bool,
}

fn default_editor_theme() -> String {
    "vs-dark".into()
}
fn default_indent_style() -> String {
    "space".into()
}
fn default_indent_size() -> u32 {
    4
}
fn default_line_numbers() -> String {
    "on".into()
}
fn default_true() -> bool {
    true
}
fn default_false() -> bool {
    false
}
fn default_word_wrap() -> String {
    "on".into()
}

fn default_locale() -> String {
    "zh".into()
}
fn default_font_size() -> u32 {
    14
}
fn default_terminal_font_size() -> u32 {
    13
}
fn default_theme() -> String {
    "dark".into()
}

fn default_layout() -> String {
    "horizontal".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            compiler: CompilerSettings {
                cpp_standard: default_cpp_standard(),
                opt_level: default_opt_level(),
                warnings: default_warnings(),
                extra_args: String::new(),
                compiler_path: None,
                template: default_cpp_template(),
            },
            runtime: RuntimeSettings {
                compile_timeout_secs: default_compile_timeout(),
                run_timeout_secs: default_run_timeout(),
                cpu_secs: default_cpu_secs(),
                fsize_mb: default_fsize_mb(),
            },
            test: TestSettings {
                fsize_mb: default_fsize_mb(),
                test_time_limit_ms: default_test_time_limit_ms(),
            },
            general: GeneralSettings {
                locale: default_locale(),
                theme: default_theme(),
                layout: default_layout(),
                auto_hide_panel: false,
            },
            editor: EditorSettings {
                font_size: default_font_size(),
                theme: default_editor_theme(),
                terminal_font_size: default_terminal_font_size(),
                indent_style: default_indent_style(),
                indent_size: default_indent_size(),
                line_numbers: default_line_numbers(),
                enable_suggestions: default_true(),
                auto_closing_brackets: default_true(),
                auto_closing_quotes: default_true(),
                word_wrap: default_word_wrap(),
                minimap_enabled: default_false(),
            },
            current_language: default_current_language(),
            schema_version: SCHEMA_VERSION,
        }
    }
}

/// 附加参数黑名单：拒绝危险参数
///
/// 拒绝：
/// - `-o`：输出重定向（可覆盖任意文件）
/// - `-c`：只编译不链接（教学场景不需要）
/// - `-pipe`：使用管道替代临时文件
/// - `-MF`/`-MMD`/`-MP`/`-MT`/`-MQ`：makefile 依赖文件生成
/// - `@response_file`：响应文件
/// - 源文件路径（.cpp/.cc/.cxx/.c/.h/.hpp/.s/.S/.asm）
/// - 绝对路径（以 / 开头）
/// - `-l` 带库名（避免链接危险库）
pub fn validate_extra_args(args: &str) -> Result<Vec<String>, AppError> {
    let parts = shlex_like_split(args);
    let mut result = Vec::with_capacity(parts.len());

    for p in parts {
        // 空字符串跳过
        if p.is_empty() {
            continue;
        }

        // 拒绝绝对路径
        if p.starts_with('/') {
            return Err(AppError::Other {
                detail: format!("附加参数包含绝对路径，已拒绝: {p}"),
            });
        }

        // 拒绝响应文件
        if p.starts_with('@') {
            return Err(AppError::Other {
                detail: format!("附加参数包含响应文件，已拒绝: {p}"),
            });
        }

        // 检查黑名单参数
        let lower = p.to_lowercase();
        let blacklist = [
            "-o", "-c", "-pipe", "-mf", "-mmd", "-mp", "-mt", "-mq", "-s",
        ];
        if blacklist.contains(&lower.as_str()) {
            return Err(AppError::Other {
                detail: format!("附加参数包含禁用参数，已拒绝: {p}"),
            });
        }

        // 拒绝 -l 带库名
        if lower.starts_with("-l") {
            return Err(AppError::Other {
                detail: format!("附加参数包含链接库，已拒绝: {p}"),
            });
        }

        // 检查源文件扩展名
        let lower_path = p.to_lowercase();
        let source_exts = [
            ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".s", ".asm",
        ];
        if source_exts.iter().any(|ext| lower_path.ends_with(ext)) {
            return Err(AppError::Other {
                detail: format!("附加参数包含源文件路径，已拒绝: {p}"),
            });
        }

        // 拒绝 -oXXX 形式（如 -o/tmp/evil）
        if lower.starts_with("-o") && lower.len() > 2 {
            return Err(AppError::Other {
                detail: format!("附加参数包含输出重定向，已拒绝: {p}"),
            });
        }

        result.push(p);
    }

    Ok(result)
}

/// 简单的 shell-like 分割（按空格分割，支持引号）
fn shlex_like_split(s: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;

    for c in s.chars() {
        match c {
            '\'' if !in_double_quote => {
                in_single_quote = !in_single_quote;
            }
            '"' if !in_single_quote => {
                in_double_quote = !in_double_quote;
            }
            ' ' | '\t' if !in_single_quote && !in_double_quote => {
                if !current.is_empty() {
                    result.push(std::mem::take(&mut current));
                }
            }
            _ => {
                current.push(c);
            }
        }
    }
    if !current.is_empty() {
        result.push(current);
    }
    result
}

/// 构建编译参数（不含编译器路径、-o、源文件路径）
pub fn build_compile_args(settings: &CompilerSettings) -> Result<Vec<String>, AppError> {
    let mut args = Vec::new();

    // C++ 标准
    args.push(format!("-std={}", settings.cpp_standard));

    // 优化级别
    args.push(format!("-{}", settings.opt_level));

    // 警告级别
    match settings.warnings.as_str() {
        "none" => {}
        "wall" => {
            args.push("-Wall".into());
        }
        "wall_extra" | _ => {
            args.push("-Wall".into());
            args.push("-Wextra".into());
        }
    }

    // 无颜色诊断（教学场景固定）
    args.push("-fno-color-diagnostics".into());

    // 附加参数（黑名单校验）
    let extra = validate_extra_args(&settings.extra_args)?;
    args.extend(extra);

    Ok(args)
}

/// settings.json 路径
fn settings_path(base: &Path) -> PathBuf {
    base.join("settings.json")
}

/// 加载设置（不存在则返回默认值）
///
/// 加载流程：
/// 1. 尝试直接反序列化为 v3 结构（含 `#[serde(default)]` 自动填充缺失字段）
/// 2. v3 失败时按 schema_version 决定迁移路径：
///    - v1 → v3：合并 v1→v2 + v2→v3 步骤
///    - v2 → v3：丢弃 font_family / ui_font_family / ui_font_size 字段
/// 3. 都失败则返回默认值
///
/// TestSettings 兼容迁移：原始 JSON 中**没有** `test` 字段时，
/// 才把 `runtime.fsize_mb` 复制到 `test.fsize_mb`（仅一次，不重复迁移）。
/// 如果 `test` 字段已存在，无条件保留用户保存的值。
pub fn load(base: &Path) -> AppSettings {
    match fs::read_to_string(settings_path(base)) {
        Ok(raw) => {
            match serde_json::from_str::<AppSettings>(&raw) {
                Ok(s) => {
                    // 反序列化成功，检查原始 JSON 是否有 test 字段决定是否迁移
                    let has_test_field = serde_json::from_str::<serde_json::Value>(&raw)
                        .ok()
                        .and_then(|v| v.get("test").map(|t| !t.is_null()))
                        .unwrap_or(false);
                    let mut s = merge_with_defaults(s);
                    if !has_test_field && s.runtime.fsize_mb != s.test.fsize_mb {
                        // 旧配置没有 test 字段：执行一次性迁移
                        s.test.fsize_mb = s.runtime.fsize_mb;
                    }
                    s
                }
                Err(_) => {
                    match serde_json::from_str::<serde_json::Value>(&raw) {
                        Ok(v) => {
                            // 检测 schema_version 决定迁移路径
                            let sv = v
                                .get("schema_version")
                                .and_then(|x| x.as_u64())
                                .unwrap_or(1)
                                as u32;
                            match sv {
                                1 => migrate_v1_to_v3(v, base),
                                2 => migrate_v2_to_v3(v, base),
                                _ => AppSettings::default(),
                            }
                        }
                        Err(_) => AppSettings::default(),
                    }
                }
            }
        }
        Err(_) => AppSettings::default(),
    }
}

/// v1 → v3 迁移：合并 v1→v2 + v2→v3 步骤
///
/// 迁移规则：
/// - ui.locale → general.locale
/// - ui.theme → general.theme（同时推断 editor.theme：light → vs，dark/system → vs-dark）
/// - ui.font_size → editor.font_size（font_family 丢弃，统一 JetBrains Mono）
/// - ui.terminal_font_size → editor.terminal_font_size
/// - compiler / runtime 字段直接复用
fn migrate_v1_to_v3(v: serde_json::Value, base: &Path) -> AppSettings {
    let mut s = AppSettings::default();
    if let Some(ui) = v.get("ui") {
        if let Some(locale) = ui.get("locale").and_then(|x| x.as_str()) {
            s.general.locale = locale.into();
        }
        if let Some(theme) = ui.get("theme").and_then(|x| x.as_str()) {
            s.general.theme = theme.into();
            s.editor.theme = match theme {
                "light" => "vs".into(),
                _ => "vs-dark".into(),
            };
        }
        // font_family 丢弃（统一 JetBrains Mono）
        if let Some(fs) = ui.get("font_size").and_then(|x| x.as_u64()) {
            s.editor.font_size = fs as u32;
        }
        if let Some(tfs) = ui.get("terminal_font_size").and_then(|x| x.as_u64()) {
            s.editor.terminal_font_size = tfs as u32;
        }
    }
    if let Some(compiler) = v.get("compiler") {
        if let Ok(c) = serde_json::from_value::<CompilerSettings>(compiler.clone()) {
            s.compiler = c;
        }
    }
    if let Some(runtime) = v.get("runtime") {
        if let Ok(r) = serde_json::from_value::<RuntimeSettings>(runtime.clone()) {
            s.runtime = r;
        }
    }
    if let Some(lang) = v.get("current_language").and_then(|x| x.as_str()) {
        s.current_language = lang.into();
    }
    s.schema_version = SCHEMA_VERSION;
    let _ = save(base, &s);
    s
}

/// v2 → v3 迁移：丢弃 font_family / ui_font_family / ui_font_size 字段
///
/// 迁移规则：
/// - general.locale / general.theme 保留
/// - general.ui_font_family / general.ui_font_size 丢弃（字体统一 JetBrains Mono）
/// - editor.* 全部保留（除 font_family 丢弃）
/// - compiler / runtime / current_language 直接复用
fn migrate_v2_to_v3(v: serde_json::Value, base: &Path) -> AppSettings {
    let mut s = AppSettings::default();
    // general 只保留 locale / theme
    if let Some(general) = v.get("general") {
        if let Some(locale) = general.get("locale").and_then(|x| x.as_str()) {
            s.general.locale = locale.into();
        }
        if let Some(theme) = general.get("theme").and_then(|x| x.as_str()) {
            s.general.theme = theme.into();
        }
        // ui_font_family / ui_font_size 丢弃
    }
    if let Some(editor) = v.get("editor") {
        if let Some(fs) = editor.get("font_size").and_then(|x| x.as_u64()) {
            s.editor.font_size = fs as u32;
        }
        if let Some(theme) = editor.get("theme").and_then(|x| x.as_str()) {
            s.editor.theme = theme.into();
        }
        if let Some(tfs) = editor.get("terminal_font_size").and_then(|x| x.as_u64()) {
            s.editor.terminal_font_size = tfs as u32;
        }
        if let Some(is) = editor.get("indent_style").and_then(|x| x.as_str()) {
            s.editor.indent_style = is.into();
        }
        if let Some(is) = editor.get("indent_size").and_then(|x| x.as_u64()) {
            s.editor.indent_size = is as u32;
        }
        if let Some(ln) = editor.get("line_numbers").and_then(|x| x.as_str()) {
            s.editor.line_numbers = ln.into();
        }
        if let Some(es) = editor.get("enable_suggestions").and_then(|x| x.as_bool()) {
            s.editor.enable_suggestions = es;
        }
        if let Some(acb) = editor.get("auto_closing_brackets").and_then(|x| x.as_bool()) {
            s.editor.auto_closing_brackets = acb;
        }
        if let Some(acq) = editor.get("auto_closing_quotes").and_then(|x| x.as_bool()) {
            s.editor.auto_closing_quotes = acq;
        }
        if let Some(ww) = editor.get("word_wrap").and_then(|x| x.as_str()) {
            s.editor.word_wrap = ww.into();
        }
        if let Some(me) = editor.get("minimap_enabled").and_then(|x| x.as_bool()) {
            s.editor.minimap_enabled = me;
        }
        // font_family 丢弃
    }
    if let Some(compiler) = v.get("compiler") {
        if let Ok(c) = serde_json::from_value::<CompilerSettings>(compiler.clone()) {
            s.compiler = c;
        }
    }
    if let Some(runtime) = v.get("runtime") {
        if let Ok(r) = serde_json::from_value::<RuntimeSettings>(runtime.clone()) {
            s.runtime = r;
        }
    }
    if let Some(lang) = v.get("current_language").and_then(|x| x.as_str()) {
        s.current_language = lang.into();
    }
    s.schema_version = SCHEMA_VERSION;
    let _ = save(base, &s);
    s
}

/// 保存设置
pub fn save(base: &Path, settings: &AppSettings) -> Result<(), AppError> {
    let path = settings_path(base);
    let raw = serde_json::to_string_pretty(settings).map_err(|e| AppError::Other {
        detail: format!("序列化设置失败: {e}"),
    })?;
    fs::write(&path, raw)?;
    Ok(())
}

/// 合并缺失字段与默认值（向前兼容）
fn merge_with_defaults(mut s: AppSettings) -> AppSettings {
    let default = AppSettings::default();
    if s.compiler.cpp_standard.is_empty() {
        s.compiler.cpp_standard = default.compiler.cpp_standard;
    }
    if s.compiler.opt_level.is_empty() {
        s.compiler.opt_level = default.compiler.opt_level;
    }
    if s.compiler.warnings.is_empty() {
        s.compiler.warnings = default.compiler.warnings;
    }
    if s.compiler.template.is_empty() {
        s.compiler.template = default.compiler.template;
    }
    if s.runtime.compile_timeout_secs == 0 {
        s.runtime.compile_timeout_secs = default.runtime.compile_timeout_secs;
    }
    if s.runtime.run_timeout_secs == 0 {
        s.runtime.run_timeout_secs = default.runtime.run_timeout_secs;
    }
    if s.runtime.cpu_secs == 0 {
        s.runtime.cpu_secs = default.runtime.cpu_secs;
    }
    if s.runtime.fsize_mb == 0 {
        s.runtime.fsize_mb = default.runtime.fsize_mb;
    }
    // test 字段：只补 0（用户保存的值即使是 10 也保留，不做"等于默认值"判断）
    if s.test.fsize_mb == 0 {
        s.test.fsize_mb = default.test.fsize_mb;
    }
    if s.test.test_time_limit_ms == 0 {
        s.test.test_time_limit_ms = default.test.test_time_limit_ms;
    }
    if s.general.locale.is_empty() {
        s.general.locale = default.general.locale;
    }
    if s.general.theme.is_empty() {
        s.general.theme = default.general.theme;
    }
    if s.general.layout != "horizontal" && s.general.layout != "vertical" {
        s.general.layout = default.general.layout;
    }
    if s.editor.font_size == 0 {
        s.editor.font_size = default.editor.font_size;
    }
    if s.editor.theme.is_empty() {
        s.editor.theme = default.editor.theme;
    }
    if s.editor.terminal_font_size == 0 {
        s.editor.terminal_font_size = default.editor.terminal_font_size;
    }
    if s.editor.indent_style.is_empty() {
        s.editor.indent_style = default.editor.indent_style;
    }
    if s.editor.indent_size == 0 {
        s.editor.indent_size = default.editor.indent_size;
    }
    if s.editor.line_numbers.is_empty() {
        s.editor.line_numbers = default.editor.line_numbers;
    }
    if s.editor.word_wrap.is_empty() {
        s.editor.word_wrap = default.editor.word_wrap;
    }
    if s.current_language.is_empty() {
        s.current_language = default.current_language;
    }
    s.schema_version = SCHEMA_VERSION;
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_sensible() {
        let s = AppSettings::default();
        assert_eq!(s.compiler.cpp_standard, "c++17");
        assert_eq!(s.compiler.opt_level, "O0");
        assert_eq!(s.compiler.warnings, "wall_extra");
        assert_eq!(s.runtime.compile_timeout_secs, 10);
        assert_eq!(s.runtime.run_timeout_secs, 5);
        assert_eq!(s.general.locale, "zh");
        assert_eq!(s.editor.theme, "vs-dark");
        assert_eq!(s.editor.indent_size, 4);
        assert!(s.editor.enable_suggestions);
        assert_eq!(s.schema_version, 3);
    }

    #[test]
    fn build_args_basic() {
        let s = AppSettings::default();
        let args = build_compile_args(&s.compiler).unwrap();
        assert!(args.contains(&"-std=c++17".to_string()));
        assert!(args.contains(&"-O0".to_string()));
        assert!(args.contains(&"-Wall".to_string()));
        assert!(args.contains(&"-Wextra".to_string()));
        assert!(args.contains(&"-fno-color-diagnostics".to_string()));
    }

    #[test]
    fn build_args_with_extra() {
        let mut s = AppSettings::default();
        s.compiler.extra_args = "-DDEBUG -g".into();
        let args = build_compile_args(&s.compiler).unwrap();
        assert!(args.contains(&"-DDEBUG".to_string()));
        assert!(args.contains(&"-g".to_string()));
    }

    #[test]
    fn validate_rejects_output_redirect() {
        assert!(validate_extra_args("-o /tmp/evil").is_err());
        assert!(validate_extra_args("-o/tmp/evil").is_err());
        assert!(validate_extra_args("-o").is_err());
    }

    #[test]
    fn validate_rejects_compile_only() {
        assert!(validate_extra_args("-c").is_err());
    }

    #[test]
    fn validate_rejects_pipe() {
        assert!(validate_extra_args("-pipe").is_err());
    }

    #[test]
    fn validate_rejects_response_file() {
        assert!(validate_extra_args("@response.txt").is_err());
    }

    #[test]
    fn validate_rejects_absolute_path() {
        assert!(validate_extra_args("/etc/passwd").is_err());
    }

    #[test]
    fn validate_rejects_source_file() {
        assert!(validate_extra_args("main.cpp").is_err());
        assert!(validate_extra_args("test.cc").is_err());
        assert!(validate_extra_args("header.h").is_err());
    }

    #[test]
    fn validate_rejects_link_library() {
        assert!(validate_extra_args("-lm").is_err());
        assert!(validate_extra_args("-lcurl").is_err());
    }

    #[test]
    fn validate_rejects_makefile_deps() {
        assert!(validate_extra_args("-MF deps.txt").is_err());
        assert!(validate_extra_args("-MMD").is_err());
    }

    #[test]
    fn validate_accepts_safe_args() {
        let r = validate_extra_args("-DDEBUG -g -std=c++20").unwrap();
        assert_eq!(r, vec!["-DDEBUG", "-g", "-std=c++20"]);
    }

    #[test]
    fn validate_handles_quoted_args() {
        let r = validate_extra_args("-DNAME=\"hello world\" -g").unwrap();
        assert_eq!(r, vec!["-DNAME=hello world", "-g"]);
    }

    #[test]
    fn validate_empty_string() {
        let r = validate_extra_args("").unwrap();
        assert!(r.is_empty());
    }

    #[test]
    fn load_returns_default_when_missing() {
        let tmp = tempfile::TempDir::new().unwrap();
        let s = load(tmp.path());
        assert_eq!(s.compiler.cpp_standard, "c++17");
    }

    #[test]
    fn save_and_load_roundtrip() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mut s = AppSettings::default();
        s.compiler.cpp_standard = "c++20".into();
        s.runtime.run_timeout_secs = 30;
        s.general.locale = "en".into();
        s.editor.font_size = 18;
        s.editor.auto_closing_brackets = false;

        save(tmp.path(), &s).unwrap();
        let loaded = load(tmp.path());
        assert_eq!(loaded.compiler.cpp_standard, "c++20");
        assert_eq!(loaded.runtime.run_timeout_secs, 30);
        assert_eq!(loaded.general.locale, "en");
        assert_eq!(loaded.editor.font_size, 18);
        assert!(!loaded.editor.auto_closing_brackets);
    }

    #[test]
    fn load_merges_missing_fields() {
        let tmp = tempfile::TempDir::new().unwrap();
        // v3 格式但只写部分字段，缺失字段应被默认值填充
        let partial = r#"{"compiler":{"cpp_standard":"c++20","opt_level":"O2","warnings":"wall","extra_args":"","compiler_path":null},"runtime":{"compile_timeout_secs":20,"run_timeout_secs":0,"cpu_secs":0,"fsize_mb":0},"general":{"locale":"","theme":"dark"},"editor":{"font_size":0,"theme":"","terminal_font_size":0,"indent_style":"","indent_size":0,"line_numbers":"","enable_suggestions":true,"auto_closing_brackets":true,"auto_closing_quotes":true,"word_wrap":"","minimap_enabled":false},"current_language":"cpp","schema_version":3}"#;
        std::fs::write(tmp.path().join("settings.json"), partial).unwrap();

        let s = load(tmp.path());
        // 写入的字段保留
        assert_eq!(s.compiler.cpp_standard, "c++20");
        assert_eq!(s.runtime.compile_timeout_secs, 20);
        // 缺失字段用默认值
        assert_eq!(s.runtime.run_timeout_secs, 5);
        assert_eq!(s.runtime.cpu_secs, 5);
        assert_eq!(s.general.locale, "zh");
        assert_eq!(s.editor.font_size, 14);
        assert_eq!(s.editor.theme, "vs-dark");
    }

    #[test]
    fn migrate_v1_preserves_compiler_settings() {
        let tmp = tempfile::TempDir::new().unwrap();
        // v1 格式：包含 ui 字段
        let v1 = r#"{"compiler":{"cpp_standard":"c++20","opt_level":"O2","warnings":"wall","extra_args":"-DDEBUG","compiler_path":null,"template":""},"runtime":{"compile_timeout_secs":20,"run_timeout_secs":15,"cpu_secs":8,"fsize_mb":50},"ui":{"locale":"en","font_size":16,"font_family":"Menlo","terminal_font_size":14,"theme":"dark"},"current_language":"cpp","schema_version":1}"#;
        std::fs::write(tmp.path().join("settings.json"), v1).unwrap();

        let s = load(tmp.path());
        // compiler 字段保留
        assert_eq!(s.compiler.cpp_standard, "c++20");
        assert_eq!(s.compiler.opt_level, "O2");
        assert_eq!(s.compiler.warnings, "wall");
        assert_eq!(s.compiler.extra_args, "-DDEBUG");
        // runtime 字段保留
        assert_eq!(s.runtime.compile_timeout_secs, 20);
        assert_eq!(s.runtime.run_timeout_secs, 15);
        assert_eq!(s.runtime.cpu_secs, 8);
        assert_eq!(s.runtime.fsize_mb, 50);
        // schema 升级到 3
        assert_eq!(s.schema_version, 3);
    }

    #[test]
    fn migrate_v1_moves_ui_to_general_editor() {
        let tmp = tempfile::TempDir::new().unwrap();
        let v1 = r#"{"compiler":{"cpp_standard":"c++17","opt_level":"O0","warnings":"wall_extra","extra_args":"","compiler_path":null,"template":""},"runtime":{"compile_timeout_secs":10,"run_timeout_secs":5,"cpu_secs":5,"fsize_mb":10},"ui":{"locale":"en","font_size":16,"font_family":"Menlo","terminal_font_size":14,"theme":"dark"},"current_language":"cpp","schema_version":1}"#;
        std::fs::write(tmp.path().join("settings.json"), v1).unwrap();

        let s = load(tmp.path());
        // ui.locale → general.locale
        assert_eq!(s.general.locale, "en");
        // ui.font_family 丢弃（统一 JetBrains Mono）
        // ui.font_size → editor.font_size
        assert_eq!(s.editor.font_size, 16);
        // ui.terminal_font_size → editor.terminal_font_size
        assert_eq!(s.editor.terminal_font_size, 14);
        // ui.theme → general.theme（软件主题保留）
        assert_eq!(s.general.theme, "dark");
    }

    #[test]
    fn migrate_v1_infers_editor_theme() {
        let tmp = tempfile::TempDir::new().unwrap();
        // light 主题 → editor.theme = "vs"
        let v1_light = r#"{"compiler":{"cpp_standard":"c++17","opt_level":"O0","warnings":"wall_extra","extra_args":"","compiler_path":null,"template":""},"runtime":{"compile_timeout_secs":10,"run_timeout_secs":5,"cpu_secs":5,"fsize_mb":10},"ui":{"locale":"zh","font_size":14,"font_family":"JetBrains Mono","terminal_font_size":13,"theme":"light"},"current_language":"cpp","schema_version":1}"#;
        std::fs::write(tmp.path().join("settings.json"), v1_light).unwrap();
        let s = load(tmp.path());
        assert_eq!(s.general.theme, "light");
        assert_eq!(s.editor.theme, "vs");

        // dark 主题 → editor.theme = "vs-dark"
        let v1_dark = r#"{"compiler":{"cpp_standard":"c++17","opt_level":"O0","warnings":"wall_extra","extra_args":"","compiler_path":null,"template":""},"runtime":{"compile_timeout_secs":10,"run_timeout_secs":5,"cpu_secs":5,"fsize_mb":10},"ui":{"locale":"zh","font_size":14,"font_family":"JetBrains Mono","terminal_font_size":13,"theme":"dark"},"current_language":"cpp","schema_version":1}"#;
        std::fs::write(tmp.path().join("settings.json"), v1_dark).unwrap();
        let s = load(tmp.path());
        assert_eq!(s.general.theme, "dark");
        assert_eq!(s.editor.theme, "vs-dark");
    }

    #[test]
    fn v3_roundtrip_preserves_all_fields() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mut s = AppSettings::default();
        s.general.locale = "en".into();
        s.general.theme = "light".into();
        s.editor.font_size = 16;
        s.editor.theme = "vs".into();
        s.editor.terminal_font_size = 15;
        s.editor.indent_style = "tab".into();
        s.editor.indent_size = 2;
        s.editor.line_numbers = "relative".into();
        s.editor.enable_suggestions = false;
        s.editor.auto_closing_brackets = false;
        s.editor.auto_closing_quotes = false;
        s.editor.word_wrap = "off".into();
        s.editor.minimap_enabled = true;

        save(tmp.path(), &s).unwrap();
        let loaded = load(tmp.path());
        assert_eq!(loaded.general.locale, "en");
        assert_eq!(loaded.general.theme, "light");
        assert_eq!(loaded.editor.font_size, 16);
        assert_eq!(loaded.editor.theme, "vs");
        assert_eq!(loaded.editor.terminal_font_size, 15);
        assert_eq!(loaded.editor.indent_style, "tab");
        assert_eq!(loaded.editor.indent_size, 2);
        assert_eq!(loaded.editor.line_numbers, "relative");
        assert!(!loaded.editor.enable_suggestions);
        assert!(!loaded.editor.auto_closing_brackets);
        assert!(!loaded.editor.auto_closing_quotes);
        assert_eq!(loaded.editor.word_wrap, "off");
        assert!(loaded.editor.minimap_enabled);
        assert_eq!(loaded.schema_version, 3);
    }

    #[test]
    fn migrate_v2_to_v3_drops_font_fields() {
        let tmp = tempfile::TempDir::new().unwrap();
        // v2 格式：包含 general.ui_font_family / editor.font_family
        let v2 = r#"{"compiler":{"cpp_standard":"c++17","opt_level":"O0","warnings":"wall_extra","extra_args":"","compiler_path":null,"template":""},"runtime":{"compile_timeout_secs":10,"run_timeout_secs":5,"cpu_secs":5,"fsize_mb":10},"general":{"locale":"en","theme":"dark","ui_font_family":"Inter","ui_font_size":14},"editor":{"font_family":"SF Mono","font_size":16,"theme":"vs-dark","terminal_font_size":13,"indent_style":"space","indent_size":4,"line_numbers":"on","enable_suggestions":true,"auto_closing_brackets":true,"auto_closing_quotes":true,"word_wrap":"on","minimap_enabled":false},"current_language":"cpp","schema_version":2}"#;
        std::fs::write(tmp.path().join("settings.json"), v2).unwrap();

        let s = load(tmp.path());
        // font 字段已丢弃（统一 JetBrains Mono）
        // 其他字段保留
        assert_eq!(s.general.locale, "en");
        assert_eq!(s.general.theme, "dark");
        assert_eq!(s.editor.font_size, 16);
        assert_eq!(s.editor.theme, "vs-dark");
        assert_eq!(s.editor.terminal_font_size, 13);
        assert_eq!(s.editor.indent_style, "space");
        assert_eq!(s.editor.indent_size, 4);
        // schema 升级到 3
        assert_eq!(s.schema_version, 3);
    }

    #[test]
    fn test_settings_default() {
        // 显式 Default：fsize_mb=10, test_time_limit_ms=1000
        let t = TestSettings::default();
        assert_eq!(t.fsize_mb, 10);
        assert_eq!(t.test_time_limit_ms, 1000);
        // AppSettings::default().test 也应是 10/1000
        let s = AppSettings::default();
        assert_eq!(s.test.fsize_mb, 10);
        assert_eq!(s.test.test_time_limit_ms, 1000);
    }

    #[test]
    fn merge_does_not_migrate_runtime_fsize_to_test() {
        // merge_with_defaults 不再做迁移（迁移改在 load() 中按 JSON 字段判断）
        // 这里验证：runtime.fsize_mb=50, test.fsize_mb=10 → merge 后 test.fsize_mb 仍为 10
        let mut s = AppSettings::default();
        s.runtime.fsize_mb = 50;
        let merged = merge_with_defaults(s);
        assert_eq!(merged.test.fsize_mb, 10);
        assert_eq!(merged.runtime.fsize_mb, 50);
    }

    #[test]
    fn merge_preserves_test_fsize_when_already_set() {
        // test.fsize_mb 已是非 0 值，merge 不会覆盖
        let mut s = AppSettings::default();
        s.runtime.fsize_mb = 50;
        s.test.fsize_mb = 20;
        let merged = merge_with_defaults(s);
        assert_eq!(merged.test.fsize_mb, 20);
    }

    #[test]
    fn merge_fills_zero_test_fsize_and_time_limit() {
        // test 字段为 0 时补默认值
        let mut s = AppSettings::default();
        s.test.fsize_mb = 0;
        s.test.test_time_limit_ms = 0;
        let merged = merge_with_defaults(s);
        assert_eq!(merged.test.fsize_mb, 10);
        assert_eq!(merged.test.test_time_limit_ms, 1000);
    }

    #[test]
    fn save_load_roundtrip_preserves_test_settings() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mut s = AppSettings::default();
        s.test.fsize_mb = 64;
        s.test.test_time_limit_ms = 2000;
        save(tmp.path(), &s).unwrap();
        let loaded = load(tmp.path());
        assert_eq!(loaded.test.fsize_mb, 64);
        assert_eq!(loaded.test.test_time_limit_ms, 2000);
    }

    #[test]
    fn save_load_roundtrip_preserves_user_fsize_10() {
        // 用户显式保存 fsize_mb=10（与默认值相同），重启后仍为 10（不会被迁移覆盖）
        let tmp = tempfile::TempDir::new().unwrap();
        let mut s = AppSettings::default();
        s.runtime.fsize_mb = 50; // runtime 故意不同
        s.test.fsize_mb = 10; // 用户显式保存默认值
        s.test.test_time_limit_ms = 1000;
        save(tmp.path(), &s).unwrap();
        let loaded = load(tmp.path());
        assert_eq!(loaded.test.fsize_mb, 10); // 保留用户值 10
        assert_eq!(loaded.runtime.fsize_mb, 50); // runtime 也保留
    }

    #[test]
    fn v3_config_loads_with_test_compatibility() {
        let tmp = tempfile::TempDir::new().unwrap();
        // v3 格式 JSON：无 test 字段，runtime.fsize_mb=25
        let v3 = r#"{"compiler":{"cpp_standard":"c++17","opt_level":"O0","warnings":"wall_extra","extra_args":"","compiler_path":null,"template":""},"runtime":{"compile_timeout_secs":10,"run_timeout_secs":5,"cpu_secs":5,"fsize_mb":25},"general":{"locale":"zh","theme":"dark","layout":"horizontal","auto_hide_panel":false},"editor":{"font_size":14,"theme":"vs-dark","terminal_font_size":13,"indent_style":"space","indent_size":4,"line_numbers":"on","enable_suggestions":true,"auto_closing_brackets":true,"auto_closing_quotes":true,"word_wrap":"on","minimap_enabled":false},"current_language":"cpp","schema_version":3}"#;
        std::fs::write(tmp.path().join("settings.json"), v3).unwrap();

        let s = load(tmp.path());
        // test 字段缺失 → 执行一次性迁移：runtime.fsize_mb=25 → test.fsize_mb=25
        assert_eq!(s.test.fsize_mb, 25);
        assert_eq!(s.test.test_time_limit_ms, 1000);
        assert_eq!(s.runtime.fsize_mb, 25); // runtime.fsize_mb 保留
    }

    #[test]
    fn v3_config_with_test_field_does_not_migrate() {
        // 有 test 字段：即使 test.fsize_mb=10 且 runtime.fsize_mb=50，也不迁移
        let tmp = tempfile::TempDir::new().unwrap();
        let v3 = r#"{"compiler":{"cpp_standard":"c++17","opt_level":"O0","warnings":"wall_extra","extra_args":"","compiler_path":null,"template":""},"runtime":{"compile_timeout_secs":10,"run_timeout_secs":5,"cpu_secs":5,"fsize_mb":50},"test":{"fsize_mb":10,"test_time_limit_ms":1000},"general":{"locale":"zh","theme":"dark","layout":"horizontal","auto_hide_panel":false},"editor":{"font_size":14,"theme":"vs-dark","terminal_font_size":13,"indent_style":"space","indent_size":4,"line_numbers":"on","enable_suggestions":true,"auto_closing_brackets":true,"auto_closing_quotes":true,"word_wrap":"on","minimap_enabled":false},"current_language":"cpp","schema_version":3}"#;
        std::fs::write(tmp.path().join("settings.json"), v3).unwrap();

        let s = load(tmp.path());
        // test.fsize_mb 保持用户保存的 10，不被 runtime 的 50 覆盖
        assert_eq!(s.test.fsize_mb, 10);
        assert_eq!(s.test.test_time_limit_ms, 1000);
        assert_eq!(s.runtime.fsize_mb, 50);
    }

    #[test]
    fn load_does_not_re_migrate_after_save() {
        // 第一次 load 触发迁移 → save 写入 test 字段 → 第二次 load 不再迁移
        let tmp = tempfile::TempDir::new().unwrap();
        // 第一次：无 test 字段，runtime.fsize_mb=30
        let v3 = r#"{"compiler":{"cpp_standard":"c++17","opt_level":"O0","warnings":"wall_extra","extra_args":"","compiler_path":null,"template":""},"runtime":{"compile_timeout_secs":10,"run_timeout_secs":5,"cpu_secs":5,"fsize_mb":30},"general":{"locale":"zh","theme":"dark","layout":"horizontal","auto_hide_panel":false},"editor":{"font_size":14,"theme":"vs-dark","terminal_font_size":13,"indent_style":"space","indent_size":4,"line_numbers":"on","enable_suggestions":true,"auto_closing_brackets":true,"auto_closing_quotes":true,"word_wrap":"on","minimap_enabled":false},"current_language":"cpp","schema_version":3}"#;
        std::fs::write(tmp.path().join("settings.json"), v3).unwrap();

        let s1 = load(tmp.path());
        assert_eq!(s1.test.fsize_mb, 30); // 迁移后为 30

        // 保存（写入 test 字段）
        save(tmp.path(), &s1).unwrap();

        // 模拟用户后续把 runtime 改成别的值（但 test 已存在）
        let v3_modified = r#"{"compiler":{"cpp_standard":"c++17","opt_level":"O0","warnings":"wall_extra","extra_args":"","compiler_path":null,"template":""},"runtime":{"compile_timeout_secs":10,"run_timeout_secs":5,"cpu_secs":5,"fsize_mb":99},"test":{"fsize_mb":30,"test_time_limit_ms":1000},"general":{"locale":"zh","theme":"dark","layout":"horizontal","auto_hide_panel":false},"editor":{"font_size":14,"theme":"vs-dark","terminal_font_size":13,"indent_style":"space","indent_size":4,"line_numbers":"on","enable_suggestions":true,"auto_closing_brackets":true,"auto_closing_quotes":true,"word_wrap":"on","minimap_enabled":false},"current_language":"cpp","schema_version":3}"#;
        std::fs::write(tmp.path().join("settings.json"), v3_modified).unwrap();

        let s2 = load(tmp.path());
        // test.fsize_mb 仍为 30，不被 runtime 的 99 覆盖
        assert_eq!(s2.test.fsize_mb, 30);
        assert_eq!(s2.runtime.fsize_mb, 99);
    }
}
