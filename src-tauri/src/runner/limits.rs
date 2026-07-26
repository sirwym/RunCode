use crate::settings::{RuntimeSettings, TestSettings};

/// 资源限制集合
///
/// 平台限制说明：
///
/// **Unix（macOS/Linux）**：
/// - RLIMIT_CPU：有效，限制 CPU 时间，限制失控代码消耗过多 CPU
/// - RLIMIT_FSIZE：有效，限制文件大小，限制失控代码写爆磁盘
/// - RLIMIT_NPROC：限制的是"用户总进程数"，无法用来限制单次运行 fork。
///   实测当前用户已有数百进程，设为 1/5/10 会导致所有 fork 失败。
/// - RLIMIT_DATA/AS/RSS：只接受 RLIM_INFINITY，无法限制内存。
///
/// **Windows**：
/// - JobObject LIMIT_JOB_TIME：有效，限制 CPU 时间（等价 RLIMIT_CPU）
/// - fsize 限制：**不实现**（Windows 无 RLIMIT_FSIZE 等价 API）
/// - 内存限制：**不实现**（与 macOS 一致，不限制内存）
/// - 内存采集：用 GetProcessMemoryInfo 轮询 PeakWorkingSetSize
///
/// 不做沙箱（用户决策）：这些限制用于防止"失控代码"（死循环、爆输出），
/// 不用于隔离恶意代码。软件运行在用户电脑，用户对自己操作负责。
#[derive(Clone, Copy, Debug)]
pub struct ResourceLimits {
    /// CPU 时间上限（秒）
    /// - Unix: RLIMIT_CPU
    /// - Windows: JobObject LIMIT_JOB_TIME
    pub cpu_secs: u64,
    /// 可创建文件大小上限（MB）
    /// - Unix: RLIMIT_FSIZE（有效）
    /// - Windows: 不实现（API 不支持，字段被忽略）
    pub fsize_mb: u64,
}

impl ResourceLimits {
    /// 从运行时设置 + 测试设置构建（fsize_mb 从 TestSettings 读取）
    pub fn from_settings(runtime: &RuntimeSettings, test: &TestSettings) -> Self {
        Self {
            cpu_secs: runtime.cpu_secs,
            fsize_mb: test.fsize_mb,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_limits_from_settings_reads_test_fsize() {
        let runtime = RuntimeSettings {
            compile_timeout_secs: 10,
            run_timeout_secs: 5,
            cpu_secs: 3,
            fsize_mb: 999, // runtime.fsize_mb 不再被读取
        };
        let test = TestSettings {
            fsize_mb: 50,
            test_time_limit_ms: 1000,
        };
        let limits = ResourceLimits::from_settings(&runtime, &test);
        assert_eq!(limits.fsize_mb, 50); // 从 test 读取
    }

    #[test]
    fn resource_limits_from_settings_reads_runtime_cpu() {
        let runtime = RuntimeSettings {
            compile_timeout_secs: 10,
            run_timeout_secs: 5,
            cpu_secs: 7,
            fsize_mb: 10,
        };
        let test = TestSettings {
            fsize_mb: 10,
            test_time_limit_ms: 1000,
        };
        let limits = ResourceLimits::from_settings(&runtime, &test);
        assert_eq!(limits.cpu_secs, 7); // 从 runtime 读取
    }
}
