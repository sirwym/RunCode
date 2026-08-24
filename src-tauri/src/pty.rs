use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
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
    /// 子进程 PID。Unix 上用于 kill(-pid) 杀整个进程组（portable_pty 后端 setsid
    /// 创建新会话，子进程是组长，孙进程同组）；Windows 上用于查询进程内存峰值。
    #[cfg(unix)]
    pid: Option<u32>,
    /// Windows 子进程 PID，用于查询进程内存峰值（PeakWorkingSetSize）。
    #[cfg(windows)]
    pid: Option<u32>,
    /// Windows: KILL_ON_JOB_CLOSE JobObject（含整棵进程树）。
    /// Some = 子进程已成功加入（kill 时树杀，对齐 Unix kill(-pgid)）；
    /// None = 创建或加入失败（降级为仅终止主进程，旧行为）。
    /// 会话 drop 时句柄关闭，KILL_ON_JOB_CLOSE 兜底杀掉残留孙进程。
    #[cfg(windows)]
    job: Mutex<Option<crate::runner::executor::windows::SendHandle>>,
    /// 持有临时编译目录，drop 时自动清理
    _work_dir: TempDir,
}

impl PtySession {
    /// 创建 PTY 会话（字段私有，通过构造函数初始化）
    #[cfg(unix)]
    pub fn new(
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn Write + Send>,
        killer: Box<dyn ChildKiller + Send + Sync>,
        pid: Option<u32>,
        work_dir: TempDir,
    ) -> Self {
        Self {
            master: Arc::new(Mutex::new(master)),
            writer: Arc::new(Mutex::new(writer)),
            killer: Mutex::new(Some(killer)),
            pid,
            _work_dir: work_dir,
        }
    }

    /// 创建 PTY 会话（Windows 版：job 为 KILL_ON_JOB_CLOSE JobObject，
    /// Some = 子进程已加入（kill 时树杀）；None = 降级为仅终止主进程）
    #[cfg(windows)]
    pub fn new(
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn Write + Send>,
        killer: Box<dyn ChildKiller + Send + Sync>,
        pid: Option<u32>,
        work_dir: TempDir,
        job: Option<crate::runner::executor::windows::SendHandle>,
    ) -> Self {
        Self {
            master: Arc::new(Mutex::new(master)),
            writer: Arc::new(Mutex::new(writer)),
            killer: Mutex::new(Some(killer)),
            pid,
            job: Mutex::new(job),
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
        // Unix：优先用 kill(-pid, SIGKILL) 杀整个进程组（含孙进程）。
        // portable_pty 后端 setsid() 让子进程成为会话组长，PGID == PID，
        // 因此 kill(-pid) 能杀掉同组的所有进程（学生程序 fork/system 产生的孙进程）。
        // killer.kill() 退化为兜底：pid 不可用或 kill 失败时再用。
        #[cfg(unix)]
        {
            if let Some(pid) = self.pid {
                let pgid = pid as i32;
                let result = unsafe { libc::kill(-pgid, libc::SIGKILL) };
                if result == 0 {
                    return;
                }
                // kill 失败（进程已退出或权限不足），回退到 killer
            }
        }
        // Windows：优先 JobObject 树杀（TerminateJobObject 终止 JobObject 内所有
        // 进程，含学生程序 system()/fork 产生的孙进程，对齐 Unix kill(-pgid) 行为）。
        // killer/杀主进程退化为兜底：JobObject 不可用时使用（孙进程可能残留）。
        #[cfg(windows)]
        {
            if let Ok(job) = self.job.lock() {
                if let Some(j) = job.as_ref() {
                    if j.terminate_tree() {
                        return;
                    }
                }
            }
            // 降级：portable_pty 的 killer.kill() 在 ConPTY 下可能不生效，
            // 用 TerminateProcess 直接终止主进程作为主要手段。
            if let Some(pid) = self.pid {
                use windows::Win32::Foundation::CloseHandle;
                use windows::Win32::System::Threading::{
                    OpenProcess, TerminateProcess, PROCESS_TERMINATE,
                };
                unsafe {
                    if let Ok(h_process) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                        let _ = TerminateProcess(h_process, 1);
                        let _ = CloseHandle(h_process);
                    }
                }
            }
        }
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
    /// 已收到首次输入的 run_id 集合（用于 pty_first_input 事件去重）
    first_input_emitted: Mutex<HashSet<String>>,
    /// 已取消的 run_id 集合对应的取消标志。
    /// stop_pty_run 设置标志，等待线程 emit pty_exit 前检查，
    /// 若已取消则跳过 emit，保证 pty_exit 单次 emit 语义。
    cancelled_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// pty_exit 事件的 emit 抢占标志。
    /// stop_pty_run 与等待线程两条 emit 路径首次 swap(true) 者负责 emit，
    /// 另一方跳过，保证 pty_exit 恰好一次（覆盖快速连点停止、
    /// 自然退出与用户停止同时发生的竞态窗口）。
    exit_claims: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            first_input_emitted: Mutex::new(HashSet::new()),
            cancelled_flags: Mutex::new(HashMap::new()),
            exit_claims: Mutex::new(HashMap::new()),
        }
    }

    pub fn insert(&self, run_id: &str, session: PtySession) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(run_id.to_string(), session);
        }
    }

    /// 注册 cancelled 标志并返回 Arc 副本，供等待线程检查。
    /// 必须在 spawn 等待线程前调用。
    pub fn register_cancelled_flag(&self, run_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut flags) = self.cancelled_flags.lock() {
            flags.insert(run_id.to_string(), flag.clone());
        }
        flag
    }

    /// 标记会话已取消（stop_pty_run 调用）。
    /// 等待线程检查此标志以跳过重复 emit。
    pub fn mark_cancelled(&self, run_id: &str) {
        if let Ok(flags) = self.cancelled_flags.lock() {
            if let Some(flag) = flags.get(run_id) {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }

    /// 注册 pty_exit emit 抢占标志并返回 Arc 副本，供等待线程检查。
    /// 必须在 spawn 等待线程前调用（与 register_cancelled_flag 同期）。
    pub fn register_exit_claim(&self, run_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut claims) = self.exit_claims.lock() {
            claims.insert(run_id.to_string(), flag.clone());
        }
        flag
    }

    /// 抢占 pty_exit 的 emit 权（stop_pty_run 调用，须在 remove 之前）。
    /// 返回 true = 抢占成功（首次调用），调用方负责 emit；
    /// false = 已被等待线程或上一次停止抢占（含 run 不存在），跳过 emit。
    pub fn try_claim_exit(&self, run_id: &str) -> bool {
        if let Ok(claims) = self.exit_claims.lock() {
            if let Some(flag) = claims.get(run_id) {
                return !flag.swap(true, Ordering::Relaxed);
            }
        }
        false
    }

    pub fn remove(&self, run_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(run_id);
        }
        // 清理首次输入标记
        if let Ok(mut set) = self.first_input_emitted.lock() {
            set.remove(run_id);
        }
        // 清理 cancelled 标记
        if let Ok(mut flags) = self.cancelled_flags.lock() {
            flags.remove(run_id);
        }
        // 清理 emit 抢占标记（等待线程持有 Arc 副本，不受影响）
        if let Ok(mut claims) = self.exit_claims.lock() {
            claims.remove(run_id);
        }
    }

    /// 标记首次输入并返回是否需要 emit 事件（true=首次，false=已标记过）
    pub fn mark_first_input(&self, run_id: &str) -> bool {
        if let Ok(mut set) = self.first_input_emitted.lock() {
            if set.contains(run_id) {
                return false;
            }
            set.insert(run_id.to_string());
            return true;
        }
        false
    }

    pub fn write_stdin(&self, run_id: &str, data: &[u8]) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions.get(run_id).ok_or("PTY 会话不存在")?;
        session.write_stdin(data)
    }

    /// 获取 PTY 子进程 PID（用于 Windows 内存查询）
    pub fn get_pid(&self, run_id: &str) -> Option<u32> {
        if let Ok(sessions) = self.sessions.lock() {
            if let Some(session) = sessions.get(run_id) {
                return session.pid;
            }
        }
        None
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

    /// 杀掉所有 PTY 会话的子进程（应用退出时调用，防止残留）
    pub fn kill_all(&self) {
        if let Ok(sessions) = self.sessions.lock() {
            for session in sessions.values() {
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

#[cfg(test)]
mod tests {
    use super::*;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::time::{Duration, Instant};

    /// 构造一个真实的 PtySession，spawn 一个长时间运行的子进程。
    /// Unix: sleep 30；Windows: ping -n 31 127.0.0.1（约 30 秒）。
    /// 用于测试 kill / kill_all 是否能正确杀掉子进程。
    fn spawn_sleep_session(label: &str) -> (PtySession, Box<dyn portable_pty::Child + Send>) {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty failed");

        #[cfg(unix)]
        let cmd = {
            let mut c = CommandBuilder::new("sleep");
            c.arg("30");
            c
        };
        #[cfg(windows)]
        let cmd = {
            let mut c = CommandBuilder::new("ping");
            c.arg("-n");
            c.arg("31");
            c.arg("127.0.0.1");
            c
        };
        let child = pair.slave.spawn_command(cmd).expect("spawn failed");
        let pid = child.process_id();
        drop(pair.slave);

        let _reader = pair
            .master
            .try_clone_reader()
            .expect("try_clone_reader failed");
        let writer = pair.master.take_writer().expect("take_writer failed");
        let killer = child.clone_killer();
        let work_dir = TempDir::new().expect("TempDir failed");

        let _ = label; // 仅用于调试识别
        #[cfg(windows)]
        let session = PtySession::new(pair.master, writer, killer, pid, work_dir, None);
        #[cfg(not(windows))]
        let session = PtySession::new(pair.master, writer, killer, pid, work_dir);
        (session, child)
    }

    /// 等待 child 退出，最多等 timeout。返回 true 表示已退出。
    fn wait_child_exit(child: &mut Box<dyn portable_pty::Child + Send>, timeout: Duration) -> bool {
        let pid = child.process_id();
        let deadline = Instant::now() + timeout;
        loop {
            // Windows ConPTY: try_wait() 可能阻塞且不检测外部 TerminateProcess 终止的进程，
            // 优先用 GetExitCodeProcess 检查进程状态。
            #[cfg(windows)]
            {
                if let Some(pid) = pid {
                    if !is_process_alive(pid) {
                        return true;
                    }
                }
            }
            // try_wait 非阻塞：Some(status) 表示已退出，None 表示仍在运行
            match child.try_wait() {
                Ok(Some(_)) => return true,
                Ok(None) => {}
                Err(_) => return true, // wait 出错视为已退出
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Windows 专用：通过 GetExitCodeProcess 检查进程是否仍在运行。
    #[cfg(windows)]
    fn is_process_alive(pid: u32) -> bool {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        const STILL_ACTIVE: u32 = 259;
        unsafe {
            if let Ok(h_process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut exit_code: u32 = 0;
                let ok = GetExitCodeProcess(h_process, &mut exit_code);
                let _ = CloseHandle(h_process);
                ok.is_ok() && exit_code == STILL_ACTIVE
            } else {
                false // 无法打开进程说明已退出
            }
        }
    }

    #[test]
    fn kill_all_terminates_all_sessions() {
        let manager = PtyManager::new();
        let (session1, mut child1) = spawn_sleep_session("s1");
        let (session2, mut child2) = spawn_sleep_session("s2");
        manager.insert("run-1", session1);
        manager.insert("run-2", session2);

        manager.kill_all();

        // 两个子进程都应该在 2 秒内退出
        assert!(
            wait_child_exit(&mut child1, Duration::from_secs(2)),
            "child1 未在 2s 内退出"
        );
        assert!(
            wait_child_exit(&mut child2, Duration::from_secs(2)),
            "child2 未在 2s 内退出"
        );

        // kill_all 不移除 session（与 cancel_all 行为一致），map 中仍有 2 个
        let count = manager
            .sessions
            .lock()
            .map(|s| s.len())
            .unwrap_or(0);
        assert_eq!(count, 2);

        // Windows ConPTY: Child::Drop 和 MasterPty::Drop 会阻塞（wait 不检测外部终止），
        // 用 forget 避免。进程已被 TerminateProcess 终止，无僵尸进程风险。
        #[cfg(windows)]
        {
            std::mem::forget(child1);
            std::mem::forget(child2);
            std::mem::forget(manager);
        }
    }

    #[test]
    fn kill_all_on_empty_manager_is_noop() {
        let manager = PtyManager::new();
        // 不应 panic
        manager.kill_all();
    }

    #[test]
    fn kill_single_session_leaves_others_running() {
        let manager = PtyManager::new();
        let (session1, mut child1) = spawn_sleep_session("keep");
        let (session2, mut child2) = spawn_sleep_session("kill");
        manager.insert("keep", session1);
        manager.insert("kill", session2);

        manager.kill("kill");

        // 只有 kill 这一个会话的子进程被杀掉
        assert!(
            wait_child_exit(&mut child2, Duration::from_secs(2)),
            "killed child 未在 2s 内退出"
        );
        // keep 仍在运行：等待 200ms 确认它没有立即退出
        std::thread::sleep(Duration::from_millis(200));
        assert!(
            !wait_child_exit(&mut child1, Duration::from_millis(50)),
            "keep child 不应被杀"
        );

        // 清理：杀掉剩下的 keep 会话，避免子进程残留
        manager.kill("keep");
        let _ = wait_child_exit(&mut child1, Duration::from_secs(2));

        // Windows ConPTY: 同上，forget 避免 Drop 阻塞
        #[cfg(windows)]
        {
            std::mem::forget(child1);
            std::mem::forget(child2);
            std::mem::forget(manager);
        }
    }

    #[test]
    fn exit_claim_first_wins_second_skips() {
        // pty_exit emit 抢占语义：首次抢占成功，第二次（另一条 emit 路径）被拦截
        let manager = PtyManager::new();
        manager.register_exit_claim("run-1");

        assert!(
            manager.try_claim_exit("run-1"),
            "首次抢占应成功（负责 emit）"
        );
        assert!(
            !manager.try_claim_exit("run-1"),
            "第二次抢占应失败（跳过 emit）"
        );
    }

    #[test]
    fn exit_claim_waiter_arc_survives_remove() {
        // 等待线程持有 Arc 副本：remove 清空标志表后，线程内 swap 仍生效，
        // 且 stop_pty_run 侧（表查找）此后抢占失败 → 恰好一次 emit
        let manager = PtyManager::new();
        let waiter_flag = manager.register_exit_claim("run-2");
        manager.remove("run-2"); // 等待线程自身清理路径

        // stop 侧走表查找：run 已被移除 → 不 emit
        assert!(!manager.try_claim_exit("run-2"));
        // 等待线程走 Arc 副本：仍可正常抢占 → emit 一次
        assert!(!waiter_flag.swap(true, Ordering::Relaxed));
    }

    #[test]
    fn exit_claim_unknown_run_returns_false() {
        // 双重停止（连点）：第二次 stop 时 run 已被 remove → 不再 emit
        let manager = PtyManager::new();
        assert!(!manager.try_claim_exit("nonexistent"));
    }

    /// tasklist 中是否存在指定镜像名的进程（Windows 树杀验证用）
    #[cfg(windows)]
    fn tasklist_has_image(image: &str) -> bool {
        let out = std::process::Command::new("tasklist")
            .args([
                "/FI",
                &format!("IMAGENAME eq {image}"),
                "/FO",
                "CSV",
                "/NH",
            ])
            .output()
            .expect("tasklist 执行失败");
        String::from_utf8_lossy(&out.stdout).contains(image)
    }

    /// B1-4 回归：PTY kill 经 JobObject 杀整棵进程树。
    /// 主进程 cmd.exe 启动孙进程 timeout.exe（存活 30s）；kill 后孙进程应一并终止。
    /// （AssignProcessToJobObject 在 CI 等受限环境会降级，降级时跳过孙进程断言）
    #[cfg(windows)]
    #[test]
    fn pty_kill_with_job_kills_process_tree() {
        use crate::runner::executor::windows::{assign_process_to_job, create_kill_on_close_job};

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty failed");

        let mut cmd = CommandBuilder::new("cmd");
        cmd.arg("/c");
        cmd.arg("timeout");
        cmd.arg("/t");
        cmd.arg("30");
        cmd.arg("/nobreak");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn failed");
        let pid = child.process_id();
        drop(pair.slave);
        let _reader = pair.master.try_clone_reader().expect("clone reader failed");
        let writer = pair.master.take_writer().expect("take writer failed");
        let killer = child.clone_killer();

        let job = create_kill_on_close_job().expect("create job failed");
        let assigned = pid
            .map(|p| assign_process_to_job(&job, p).unwrap_or(false))
            .unwrap_or(false);
        let work_dir = TempDir::new().expect("TempDir failed");
        let session = PtySession::new(pair.master, writer, killer, pid, work_dir, Some(job));

        // 等 cmd 完成启动孙进程 timeout.exe
        std::thread::sleep(Duration::from_millis(500));
        assert!(
            tasklist_has_image("timeout.exe"),
            "前置条件失败：孙进程 timeout.exe 未启动"
        );

        session.kill();

        // 主进程（cmd.exe）被终止
        assert!(
            wait_child_exit(&mut child, Duration::from_secs(5)),
            "主进程未在 5s 内退出"
        );

        if assigned {
            // 孙进程被 JobObject 树杀（留 500ms 让终止传播）
            std::thread::sleep(Duration::from_millis(500));
            assert!(
                !tasklist_has_image("timeout.exe"),
                "孙进程未被 JobObject 树杀"
            );
        }

        // Windows ConPTY: forget 避免 Drop 阻塞（同本模块既有约定）
        std::mem::forget(child);
        std::mem::forget(session);
    }
}
