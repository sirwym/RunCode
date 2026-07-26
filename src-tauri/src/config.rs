use std::path::PathBuf;
use std::time::Duration;

use crate::error::AppError;
use crate::settings::AppSettings;

/// 编译器与运行配置（从 settings 构建）
#[derive(Clone, Debug)]
pub struct CompilerConfig {
    /// 编译器路径
    pub compiler_path: PathBuf,
    /// 编译超时
    pub compile_timeout: Duration,
    /// 运行超时
    pub run_timeout: Duration,
    /// 编译参数（不含编译器路径、-o、源文件路径）
    pub compile_args: Vec<String>,
    /// 单例测试时间限制（毫秒），超过则该用例判失败
    pub test_time_limit_ms: u64,
}

impl CompilerConfig {
    /// 从应用设置构建配置
    pub fn from_settings(settings: &AppSettings) -> Result<Self, AppError> {
        // 编译器路径：settings 优先，None 则自动探测
        let compiler_path = match &settings.compiler.compiler_path {
            Some(p) if !p.is_empty() => PathBuf::from(p),
            _ => detect_compiler()?,
        };

        // 构建编译参数（含黑名单校验）
        let compile_args = crate::settings::build_compile_args(&settings.compiler)?;

        Ok(Self {
            compiler_path,
            compile_timeout: Duration::from_secs(settings.runtime.compile_timeout_secs),
            run_timeout: Duration::from_secs(settings.runtime.run_timeout_secs),
            compile_args,
            test_time_limit_ms: settings.test.test_time_limit_ms,
        })
    }
}

/// 自动探测编译器路径（平台分支）
fn detect_compiler() -> Result<PathBuf, AppError> {
    #[cfg(unix)]
    {
        which::which("clang++")
            .or_else(|_| which::which("g++"))
            .map_err(|_| AppError::CompilerNotFound {
                detail: "找不到 clang++ 或 g++，请安装 Xcode Command Line Tools: xcode-select --install".into(),
            })
    }
    #[cfg(windows)]
    {
        // 1. 优先用打包的 TDM-GCC（resource_dir/mingw64/bin/g++.exe）
        if let Some(bundled) = find_bundled_mingw() {
            return Ok(bundled);
        }
        // 2. 回退到 PATH 中的 g++.exe / clang++.exe
        which::which("g++.exe")
            .or_else(|_| which::which("clang++.exe"))
            .map_err(|_| AppError::CompilerNotFound {
                detail: "找不到 g++ 或 clang++，请安装 TDM-GCC 或 MinGW-w64".into(),
            })
    }
}

/// 查找打包的 TDM-GCC（Windows 专用）
///
/// Tauri 在 Windows 上的 resource_dir 通常位于：
/// - 开发模式：`target/debug/`
/// - 安装版：`exe 同级目录/resources/`
///
/// 本函数尝试三个路径查找 `mingw64/bin/g++.exe`。
#[cfg(windows)]
fn find_bundled_mingw() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    // 候选路径 1：exe_dir/resources/mingw64/bin/g++.exe（安装版）
    let candidate1 = exe_dir.join("resources").join("mingw64").join("bin").join("g++.exe");
    if candidate1.exists() {
        return Some(candidate1);
    }

    // 候选路径 2：exe_dir/mingw64/bin/g++.exe（开发模式，资源在 target/debug/）
    let candidate2 = exe_dir.join("mingw64").join("bin").join("g++.exe");
    if candidate2.exists() {
        return Some(candidate2);
    }

    // 候选路径 3：CARGO_MANIFEST_DIR/resources/mingw64/bin/g++.exe（cargo test 路径）
    // CARGO_MANIFEST_DIR 是编译期常量，指向 src-tauri/ 目录。
    // 仅开发/测试时生效，生产环境（安装版）不影响。
    let candidate3 = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("mingw64")
        .join("bin")
        .join("g++.exe");
    if candidate3.exists() {
        return Some(candidate3);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_from_settings_reads_test_time_limit() {
        let mut s = AppSettings::default();
        s.test.test_time_limit_ms = 3000;
        let config = CompilerConfig::from_settings(&s).unwrap();
        assert_eq!(config.test_time_limit_ms, 3000);
    }

    #[test]
    fn config_from_settings_default_time_limit() {
        let s = AppSettings::default();
        let config = CompilerConfig::from_settings(&s).unwrap();
        assert_eq!(config.test_time_limit_ms, 1000);
    }
}
