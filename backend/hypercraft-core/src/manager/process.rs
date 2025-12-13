//! 进程管理底层操作：PID 文件读写、进程状态检查、进程终止。

use super::*;
use std::fs;
use sysinfo::{Pid, ProcessRefreshKind};

impl ServiceManager {
    /// 读取 PID 文件，返回进程 ID（如果存在）。
    pub(super) fn read_pid(&self, id: &str) -> Result<Option<u32>> {
        let path = self.pid_path(id);
        if !path.exists() {
            return Ok(None);
        }
        // pid 文件单行整数
        let content = fs::read_to_string(path)?;
        let pid: u32 = content
            .trim()
            .parse()
            .map_err(|_| ServiceError::Other("invalid pid".into()))?;
        Ok(Some(pid))
    }

    /// 写入 PID 文件。
    pub(super) fn write_pid(&self, id: &str, pid: u32) -> Result<()> {
        fs::create_dir_all(self.runtime_dir(id))?;
        // 直接覆盖写入，保持简单
        fs::write(self.pid_path(id), pid.to_string())?;
        Ok(())
    }

    /// 查询进程存活与粗略运行时长（毫秒）。
    ///
    /// 返回 `Some((alive, uptime_ms))`，其中：
    /// - `alive`: 进程是否仍在运行
    /// - `uptime_ms`: 运行时长（毫秒），可能为 None
    pub(super) fn process_alive(&self, pid: u32) -> Option<(bool, Option<u64>)> {
        let mut sys = self.system.lock().ok()?;
        // 使用 refresh_process_specifics 仅刷新需要的信息
        let refresh_kind = ProcessRefreshKind::new();
        let pid_sysinfo = Pid::from(pid as usize);

        // 仅刷新指定进程，不进行全量扫描
        let found = sys.refresh_process_specifics(pid_sysinfo, refresh_kind);
        if !found {
            // 进程不存在，直接返回 None 而不是尝试全量刷新
            return None;
        }

        sys.process(pid_sysinfo).map(|proc_ref| {
            let uptime_ms = proc_ref.run_time().saturating_mul(1000);
            (true, Some(uptime_ms))
        })
    }

    /// 杀死进程树；失败返回 false。
    ///
    /// 对于 Java OOM 等场景，单独杀父进程可能无效，需要杀死整个进程树。
    /// - Windows: 使用 taskkill /F /T 强制杀死进程树
    /// - Unix: 先收集子进程，再从叶子节点向上逐一 SIGKILL
    pub(super) fn kill_process(&self, pid: u32) -> bool {
        // 优先使用平台原生方式强制杀死进程树
        if self.kill_process_tree_native(pid) {
            return true;
        }

        // 回退：使用 sysinfo 逐个杀死进程树
        self.kill_process_tree_fallback(pid)
    }

    /// 使用平台原生命令杀死进程树
    #[cfg(windows)]
    fn kill_process_tree_native(&self, pid: u32) -> bool {
        // taskkill /F 强制终止，/T 终止进程树
        let output = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();

        match output {
            Ok(out) => out.status.success(),
            Err(_) => false,
        }
    }

    #[cfg(unix)]
    fn kill_process_tree_native(&self, _pid: u32) -> bool {
        // Unix 上不使用进程组杀死，直接返回 false 让 fallback 方案处理
        // fallback 方案通过 sysinfo 收集父子关系，逐个杀死进程树中的进程
        // 这样可以避免误杀 screen/tmux/SSH 等外部会话中的进程
        false
    }

    /// 使用 sysinfo 收集并杀死进程树（回退方案）
    fn kill_process_tree_fallback(&self, pid: u32) -> bool {
        let mut sys = match self.system.lock() {
            Ok(guard) => guard,
            Err(_) => return false,
        };

        // 刷新所有进程以获取完整的父子关系
        sys.refresh_processes();

        let root_pid = Pid::from(pid as usize);

        // 收集整个进程树（包括所有子进程）
        let mut tree_pids = Vec::new();
        self.collect_process_tree(&sys, root_pid, &mut tree_pids);

        if tree_pids.is_empty() {
            // 进程已不存在，视为成功
            return true;
        }

        // 从叶子节点向上杀死（反转顺序），避免子进程成为僵尸
        tree_pids.reverse();

        let mut all_killed = true;
        for tree_pid in tree_pids {
            if let Some(process) = sys.process(tree_pid) {
                // 直接使用 SIGKILL，不再尝试温和的 SIGTERM
                let killed = process.kill();
                if !killed {
                    all_killed = false;
                }
            }
        }

        all_killed
    }

    /// 递归收集进程树中的所有进程 ID
    fn collect_process_tree(&self, sys: &sysinfo::System, pid: Pid, result: &mut Vec<Pid>) {
        // 先添加当前进程
        if sys.process(pid).is_some() {
            result.push(pid);
        }

        // 查找所有以此进程为父进程的子进程
        for (child_pid, process) in sys.processes() {
            if process.parent() == Some(pid) {
                self.collect_process_tree(sys, *child_pid, result);
            }
        }
    }
}
