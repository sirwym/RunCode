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
            _ => which::which("clang++")
                .or_else(|_| which::which("g++"))
                .map_err(|_| AppError::CompilerNotFound {
                    detail: "找不到 clang++ 或 g++，请安装 Xcode Command Line Tools: xcode-select --install".into(),
                })?,
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
