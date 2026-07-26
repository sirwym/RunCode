use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};

use portable_pty::{ChildKiller, MasterPty, PtySize};
use tempfile::TempDir;

/// 单个 PTY 会话。持有 master（用于 resize）、writer（用于 stdin 写入）、
/// killer（用于停止子进程）和临时目录（防止 exe 被删）。
pub struct PtySession {
    /// master 用于 resize（resize 接收 &self）
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    /// 从 master take 的独立 writer，供 write_pty_stdin 使用
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// 从 child clone 的独立 killer，供 stop_pty_run 使用（避免与 wait 竞争锁）
    killer: Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>,
    /// 持有临时编译目录，drop 时自动清理
    _work_dir: TempDir,
}

impl PtySession {
    /// 创建 PTY 会话（字段私有，通过构造函数初始化）
    pub fn new(
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn Write + Send>,
        killer: Box<dyn ChildKiller + Send + Sync>,
        work_dir: TempDir,
    ) -> Self {
        Self {
            master: Arc::new(Mutex::new(master)),
            writer: Arc::new(Mutex::new(writer)),
            killer: Mutex::new(Some(killer)),
            _work_dir: work_dir,
        }
    }

    pub fn write_stdin(&self, data: &[u8]) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        writer.write_all(data).map_err(|e| e.to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self.master.lock().map_err(|e| e.to_string())?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self) {
        if let Ok(mut killer) = self.killer.lock() {
            if let Some(mut k) = killer.take() {
                let _ = k.kill();
            }
        }
    }
}

/// 全局 PTY 会话管理器（与 RunManager 配合使用）。
///
/// - RunManager 负责单活动任务互斥（compile_run / test_run / interactive）
/// - PtyManager 负责管理 PTY 会话的生命周期（写入、resize、kill）
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn insert(&self, run_id: &str, session: PtySession) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(run_id.to_string(), session);
        }
    }

    pub fn remove(&self, run_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(run_id);
        }
    }

    pub fn write_stdin(&self, run_id: &str, data: &[u8]) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions.get(run_id).ok_or("PTY 会话不存在")?;
        session.write_stdin(data)
    }

    pub fn resize(&self, run_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions.get(run_id).ok_or("PTY 会话不存在")?;
        session.resize(cols, rows)
    }

    pub fn kill(&self, run_id: &str) {
        if let Ok(sessions) = self.sessions.lock() {
            if let Some(session) = sessions.get(run_id) {
                session.kill();
            }
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}
