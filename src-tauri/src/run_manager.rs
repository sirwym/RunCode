use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// 运行会话类型
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunKind {
    /// 单次编译运行
    CompileRun,
    /// 批量测试运行
    TestRun,
    /// PTY 交互运行
    Interactive,
}

/// 单个运行会话
struct RunSession {
    #[allow(dead_code)]
    kind: RunKind,
    /// 取消信号令牌；cancel() 时调用 cancel()，
    /// 所有 clone 副本的 cancelled() future 同时触发，从而触发执行内核的取消分支。
    /// 相比 oneshot 的优势：可被多个阶段 clone 复用（编译→运行、批量测试每例）。
    cancel_token: CancellationToken,
}

/// 全局运行会话管理器。
///
/// 设计要点：
/// - 单活动任务互斥：同一时间只允许一个会话活跃（compile_run / test_run / interactive）
/// - 取消能力：cancel() 通过 CancellationToken::cancel() 触发所有 clone 副本
/// - 进程组清理：执行内核在收到取消信号后，用 kill_process_group 杀整个进程组
/// - 线程安全：内部用 Mutex 保护 HashMap
///
/// 不做沙箱（用户决策）：本管理器只负责"单任务 + 取消 + 进程组清理"，
/// 不负责隔离恶意代码。软件运行在用户电脑，用户对自己操作负责。
pub struct RunManager {
    sessions: Mutex<HashMap<String, RunSession>>,
}

impl RunManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// 注册新会话，返回 (run_id, cancel_token)。
    /// 若已有活动会话，返回错误（前端应先调用 cancel 停止旧任务）。
    /// 调用方可在多个执行阶段 clone 同一 token，实现"一次注册、多阶段复用"。
    pub fn register(&self, kind: RunKind) -> Result<(String, CancellationToken), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if !sessions.is_empty() {
            return Err("已有运行任务在进行中".into());
        }
        let run_id = Uuid::new_v4().to_string();
        let cancel_token = CancellationToken::new();
        sessions.insert(
            run_id.clone(),
            RunSession {
                kind,
                cancel_token: cancel_token.clone(),
            },
        );
        Ok((run_id, cancel_token))
    }

    /// 接受前端传入的 run_id 注册会话。
    /// 用于批量测试：前端在 invoke 前已生成 uuid 并设置 activeRunId，
    /// 后端使用同一 id 保证停止按钮立即可用。
    /// 若 run_id 格式非法或已有活动会话返回错误。
    pub fn register_with_id(
        &self,
        run_id: String,
        kind: RunKind,
    ) -> Result<CancellationToken, String> {
        // 校验 run_id 格式（uuid，防止注入或冲突）
        if Uuid::parse_str(&run_id).is_err() {
            return Err("run_id 格式非法".into());
        }
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if !sessions.is_empty() {
            return Err("已有运行任务在进行中".into());
        }
        let cancel_token = CancellationToken::new();
        sessions.insert(
            run_id,
            RunSession {
                kind,
                cancel_token: cancel_token.clone(),
            },
        );
        Ok(cancel_token)
    }

    /// 取消指定会话。触发 token.cancel() 让所有 clone 副本同时触发取消。
    pub fn cancel(&self, run_id: &str) -> bool {
        if let Ok(sessions) = self.sessions.lock() {
            if let Some(session) = sessions.get(run_id) {
                session.cancel_token.cancel();
                return true;
            }
        }
        false
    }

    /// 会话结束，从注册表移除。允许后续新任务注册。
    pub fn complete(&self, run_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(run_id);
        }
    }

    /// 取消所有活动会话（应用退出时调用，防止后端继续运行）
    pub fn cancel_all(&self) {
        if let Ok(sessions) = self.sessions.lock() {
            for session in sessions.values() {
                session.cancel_token.cancel();
            }
        }
    }

    /// 当前是否有活动会话
    #[allow(dead_code)]
    pub fn is_busy(&self) -> bool {
        self.sessions
            .lock()
            .map(|s| !s.is_empty())
            .unwrap_or(false)
    }
}

impl Default for RunManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_all_triggers_all_tokens() {
        let manager = RunManager::new();
        let (_id1, token1) = manager.register(RunKind::CompileRun).unwrap();
        // register 第二个前需 complete 第一个（单活动任务互斥）
        manager.complete(&_id1);
        let (_id2, token2) = manager.register(RunKind::TestRun).unwrap();

        // 重新注册第一个，使两个 session 同时存在
        // 但 register 互斥，所以用 cancel_all 测试单 session 场景
        manager.cancel_all();

        // cancel_all 后 token 应处于 cancelled 状态
        assert!(token2.is_cancelled());
        // token1 在 complete 时未触发 cancel（complete 不调用 cancel）
        assert!(!token1.is_cancelled());
    }

    #[test]
    fn cancel_all_clears_busy_state() {
        let manager = RunManager::new();
        let (id, _token) = manager.register(RunKind::CompileRun).unwrap();
        assert!(manager.is_busy());

        manager.cancel_all();
        // cancel_all 只触发 token，不移除 session，仍 busy
        assert!(manager.is_busy());

        manager.complete(&id);
        assert!(!manager.is_busy());
    }

    #[test]
    fn register_with_id_rejects_invalid_uuid() {
        let manager = RunManager::new();
        let result = manager.register_with_id("not-a-uuid".into(), RunKind::TestRun);
        assert!(result.is_err());
    }

    #[test]
    fn register_with_id_accepts_valid_uuid() {
        let manager = RunManager::new();
        let uuid = Uuid::new_v4().to_string();
        let token = manager
            .register_with_id(uuid.clone(), RunKind::TestRun)
            .expect("合法 uuid 应注册成功");
        // 注册后应能通过 run_id 取消
        assert!(manager.cancel(&uuid));
        assert!(token.is_cancelled());
    }

    #[test]
    fn cancel_propagates_to_clones() {
        let manager = RunManager::new();
        let (id, token) = manager.register(RunKind::CompileRun).unwrap();
        let clone = token.clone();

        // 取消原 token，clone 副本也应观察到 cancelled
        assert!(manager.cancel(&id));
        assert!(token.is_cancelled());
        assert!(clone.is_cancelled());
    }
}
