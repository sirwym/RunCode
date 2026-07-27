use std::path::{Path, PathBuf};
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
    /// 从应用设置构建配置。
    /// `resource_dir` 来自 Tauri `app.path().resource_dir()`，用于定位打包的 TDM-GCC；
    /// 测试环境传 None，回退到 CARGO_MANIFEST_DIR。
    pub fn from_settings(
        settings: &AppSettings,
        resource_dir: Option<&Path>,
    ) -> Result<Self, AppError> {
        // 编译器路径：settings 优先，None 则自动探测
        let compiler_path = match &settings.compiler.compiler_path {
            Some(p) if !p.is_empty() => PathBuf::from(p),
            _ => detect_compiler(resource_dir)?,
        };

        // Windows：Tauri resource_dir() 返回带 \\?\ 前缀的路径，
        // g++ 内部无法据此定位 cc1plus，需去掉前缀
        #[cfg(windows)]
        let compiler_path = strip_verbatim_prefix(&compiler_path);

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
fn detect_compiler(resource_dir: Option<&Path>) -> Result<PathBuf, AppError> {
    #[cfg(unix)]
    {
        let _ = resource_dir; // unix 不使用打包编译器
        which::which("clang++")
            .or_else(|_| which::which("g++"))
            .map_err(|_| AppError::CompilerNotFound {
                detail: "找不到 clang++ 或 g++，请安装 Xcode Command Line Tools: xcode-select --install".into(),
            })
    }
    #[cfg(windows)]
    {
        // 1. 优先用打包的 TDM-GCC
        if let Some(bundled) = find_bundled_mingw(resource_dir) {
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
/// 候选 1：Tauri resource_dir()/tdm-gcc/bin/g++.exe（安装版，官方 API）
/// 候选 2：CARGO_MANIFEST_DIR/resources/tdm-gcc/bin/g++.exe（开发/测试，编译期常量）
#[cfg(windows)]
fn find_bundled_mingw(resource_dir: Option<&Path>) -> Option<PathBuf> {
    // 候选 1：安装版 —— Tauri resource_dir()/tdm-gcc/bin/g++.exe
    // Windows NSIS 下 resource_dir 指向 exe 同级安装目录。
    if let Some(dir) = resource_dir {
        let candidate = dir.join("tdm-gcc").join("bin").join("g++.exe");
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // 候选 2：开发/测试 —— CARGO_MANIFEST_DIR/resources/tdm-gcc/bin/g++.exe
    // CARGO_MANIFEST_DIR 是编译期常量，指向 src-tauri/；生产环境该路径不存在。
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("tdm-gcc")
        .join("bin")
        .join("g++.exe");
    if candidate.exists() {
        return Some(candidate);
    }

    None
}

/// 去掉 Windows verbatim 路径前缀（\\?\）
///
/// Tauri 的 resource_dir() 返回带 \\?\ 前缀的路径，g++ 内部用自身路径
/// 相对定位 cc1plus 时无法正确解析此前缀，导致 "cannot execute 'cc1plus'"。
#[cfg(windows)]
fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_from_settings_reads_test_time_limit() {
        let mut s = AppSettings::default();
        s.test.test_time_limit_ms = 3000;
        let config = CompilerConfig::from_settings(&s, None).unwrap();
        assert_eq!(config.test_time_limit_ms, 3000);
    }

    #[test]
    fn config_from_settings_default_time_limit() {
        let s = AppSettings::default();
        let config = CompilerConfig::from_settings(&s, None).unwrap();
        assert_eq!(config.test_time_limit_ms, 1000);
    }

    #[cfg(windows)]
    #[test]
    fn detect_compiler_uses_resource_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("tdm-gcc").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("g++.exe"), b"").unwrap();

        let s = AppSettings::default();
        let config = CompilerConfig::from_settings(&s, Some(tmp.path())).unwrap();
        assert_eq!(config.compiler_path, bin.join("g++.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn strip_verbatim_prefix_removes_prefix() {
        let p = PathBuf::from(r"\\?\C:\foo\bar\g++.exe");
        assert_eq!(strip_verbatim_prefix(&p), PathBuf::from(r"C:\foo\bar\g++.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn strip_verbatim_prefix_preserves_normal_path() {
        let p = PathBuf::from(r"C:\foo\bar\g++.exe");
        assert_eq!(strip_verbatim_prefix(&p), PathBuf::from(r"C:\foo\bar\g++.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn detect_compiler_strips_verbatim_prefix() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("tdm-gcc").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("g++.exe"), b"").unwrap();

        // 模拟 Tauri resource_dir() 返回带 \\?\ 前缀的路径
        let verbatim_dir = format!(r"\\?\{}", tmp.path().to_string_lossy());
        let s = AppSettings::default();
        let config = CompilerConfig::from_settings(&s, Some(Path::new(&verbatim_dir))).unwrap();
        // 最终路径不应含 \\?\ 前缀
        assert!(!config.compiler_path.to_string_lossy().starts_with(r"\\?\"));
        assert_eq!(config.compiler_path, bin.join("g++.exe"));
    }
}
