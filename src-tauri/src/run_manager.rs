use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tokio::sync::oneshot;
use uuid::Uuid;

/// 运行会话类型
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunKind {
    /// 单次编译运行
    CompileRun,
    /// 批量测试运行
    TestRun,
    /// PTY 交互运行（第 4 轮预留）
    Interactive,
}

/// 单个运行会话
struct RunSession {
    #[allow(dead_code)]
    kind: RunKind,
    /// 取消信号发送端；cancel() 时 drop 它，
    /// 执行内核的 oneshot::Receiver 会收到 None（或 recv 返回 Err）从而触发取消分支
    cancel_tx: Option<oneshot::Sender<()>>,
}

/// 全局运行会话管理器。
///
/// 设计要点：
/// - 单活动任务互斥：同一时间只允许一个会话活跃（compile_run / test_run / interactive）
/// - 取消能力：cancel() 通过 drop oneshot::Sender 触发执行内核的取消分支
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

    /// 注册新会话，返回 run_id。
    /// 若已有活动会话，返回错误（前端应先调用 cancel 停止旧任务）。
    pub fn register(&self, kind: RunKind) -> Result<(String, oneshot::Receiver<()>), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        if !sessions.is_empty() {
            return Err("已有运行任务在进行中".into());
        }
        let run_id = Uuid::new_v4().to_string();
        let (cancel_tx, cancel_rx) = oneshot::channel();
        sessions.insert(
            run_id.clone(),
            RunSession {
                kind,
                cancel_tx: Some(cancel_tx),
            },
        );
        Ok((run_id, cancel_rx))
    }

    /// 取消指定会话。drop cancel_tx 触发执行内核的取消分支。
    pub fn cancel(&self, run_id: &str) -> bool {
        let mut sessions = self.sessions.lock().ok();
        let Some(sessions) = sessions.as_mut() else {
            return false;
        };
        if let Some(session) = sessions.get_mut(run_id) {
            // drop Sender 触发 Receiver 端 recv() 返回 Err
            session.cancel_tx.take();
            return true;
        }
        false
    }

    /// 会话结束，从注册表移除。允许后续新任务注册。
    pub fn complete(&self, run_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(run_id);
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
