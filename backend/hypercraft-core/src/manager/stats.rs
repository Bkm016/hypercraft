//! 系统和进程资源监控

use super::*;
use serde::{Deserialize, Serialize};
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, Pid, ProcessRefreshKind, RefreshKind};

/// 系统资源统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStats {
    /// CPU 使用率 (0-100)
    pub cpu_usage: f32,
    /// 总内存 (bytes)
    pub memory_total: u64,
    /// 已用内存 (bytes)
    pub memory_used: u64,
    /// 内存使用率 (0-100)
    pub memory_usage: f32,
    /// 磁盘总量 (bytes)
    pub disk_total: u64,
    /// 磁盘已用 (bytes)
    pub disk_used: u64,
    /// 磁盘使用率 (0-100)
    pub disk_usage: f32,
}

/// 单个进程资源统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessStats {
    /// 进程 ID
    pub pid: u32,
    /// CPU 使用率 (0-100)
    pub cpu_usage: f32,
    /// 内存占用 (bytes)
    pub memory_bytes: u64,
}

impl ServiceManager {
    /// 获取系统资源统计
    pub fn get_system_stats(&self) -> SystemStats {
        let mut sys = self.system.lock().unwrap_or_else(|e| e.into_inner());

        // 刷新 CPU 和内存信息
        sys.refresh_specifics(
            RefreshKind::new()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );

        // CPU 使用率 - 计算所有 CPU 核心的平均值
        let cpu_usage = {
            let cpus = sys.cpus();
            if cpus.is_empty() {
                0.0
            } else {
                cpus.iter().map(|cpu| cpu.cpu_usage()).sum::<f32>() / cpus.len() as f32
            }
        };

        // 内存信息
        let memory_total = sys.total_memory();
        let memory_used = sys.used_memory();
        let memory_usage = if memory_total > 0 {
            (memory_used as f64 / memory_total as f64 * 100.0) as f32
        } else {
            0.0
        };

        // 磁盘信息
        let disks = Disks::new_with_refreshed_list();
        let (disk_total, disk_used) = disks.iter().fold((0u64, 0u64), |(total, used), disk| {
            (
                total + disk.total_space(),
                used + (disk.total_space() - disk.available_space()),
            )
        });
        let disk_usage = if disk_total > 0 {
            (disk_used as f64 / disk_total as f64 * 100.0) as f32
        } else {
            0.0
        };

        SystemStats {
            cpu_usage,
            memory_total,
            memory_used,
            memory_usage,
            disk_total,
            disk_used,
            disk_usage,
        }
    }

    /// 获取指定进程的资源统计
    pub fn get_process_stats(&self, pid: u32) -> Option<ProcessStats> {
        let mut sys = self.system.lock().ok()?;
        let pid_sysinfo = Pid::from(pid as usize);

        let refresh_kind = ProcessRefreshKind::new().with_cpu().with_memory();
        let found = sys.refresh_process_specifics(pid_sysinfo, refresh_kind);

        if !found {
            return None;
        }

        sys.process(pid_sysinfo).map(|proc| ProcessStats {
            pid,
            cpu_usage: proc.cpu_usage(),
            memory_bytes: proc.memory(),
        })
    }

    /// 批量获取多个进程的资源统计
    /// 会累加整个进程树（包括子进程）的资源使用，以正确统计通过 shell/sudo 启动的服务。
    pub fn get_processes_stats(&self, pids: &[u32]) -> HashMap<u32, ProcessStats> {
        let mut result = HashMap::new();
        if pids.is_empty() {
            return result;
        }

        let mut sys = match self.system.lock() {
            Ok(guard) => guard,
            Err(e) => e.into_inner(),
        };

        // 刷新所有进程以获取 CPU 使用率和完整的父子关系
        // 注意：sysinfo 的 cpu_usage() 需要两次采样才能准确，
        // 但如果后台刷新任务在运行，这里直接返回已有数据即可
        let refresh_kind = ProcessRefreshKind::new().with_cpu().with_memory();
        sys.refresh_processes_specifics(refresh_kind);

        for &pid in pids {
            let pid_sysinfo = Pid::from(pid as usize);

            // 收集整个进程树
            let mut tree_pids = Vec::new();
            Self::collect_process_tree_static(&sys, pid_sysinfo, &mut tree_pids);

            if tree_pids.is_empty() {
                continue;
            }

            // 累加进程树中所有进程的 CPU 和内存
            let mut total_cpu: f32 = 0.0;
            let mut total_memory: u64 = 0;

            for tree_pid in &tree_pids {
                if let Some(proc) = sys.process(*tree_pid) {
                    total_cpu += proc.cpu_usage();
                    total_memory += proc.memory();
                }
            }

            result.insert(
                pid,
                ProcessStats {
                    pid,
                    cpu_usage: total_cpu,
                    memory_bytes: total_memory,
                },
            );
        }

        result
    }

    /// 递归收集进程树中的所有进程 ID（静态版本，用于 stats）
    fn collect_process_tree_static(sys: &sysinfo::System, pid: Pid, result: &mut Vec<Pid>) {
        if sys.process(pid).is_some() {
            result.push(pid);
        }

        for (child_pid, process) in sys.processes() {
            if process.parent() == Some(pid) {
                Self::collect_process_tree_static(sys, *child_pid, result);
            }
        }
    }

    /// 启动后台进程统计刷新任务
    /// sysinfo 的 cpu_usage() 需要两次采样才能计算准确值，
    /// 此任务定期刷新进程信息，使 API 调用时能获取准确数据。
    pub fn start_stats_refresh_task(self: &Arc<Self>, interval_secs: u64) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(interval_secs));
            loop {
                interval.tick().await;
                if let Ok(mut sys) = manager.system.lock() {
                    let refresh_kind = ProcessRefreshKind::new().with_cpu().with_memory();
                    sys.refresh_processes_specifics(refresh_kind);
                }
            }
        });
    }
}
