//! 系统资源监控

use super::*;
use serde::{Deserialize, Serialize};
use sysinfo::{CpuRefreshKind, Disks, MemoryRefreshKind, RefreshKind};

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
}
