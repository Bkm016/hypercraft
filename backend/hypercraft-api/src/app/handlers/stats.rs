//! 系统和进程资源统计 API

use axum::extract::State;
use axum::Extension;
use axum::Json;
use hypercraft_core::{ProcessStats, SystemStats};
use serde::Serialize;
use std::collections::HashMap;
use tracing::instrument;

use crate::app::middleware::AuthInfo;
use crate::app::{ApiError, AppState};

/// 系统资源响应
#[derive(Debug, Serialize)]
pub struct SystemStatsResponse {
    #[serde(flatten)]
    pub stats: SystemStats,
}

/// 进程资源响应
#[derive(Debug, Serialize)]
pub struct ProcessStatsResponse {
    pub processes: HashMap<String, ProcessStats>,
}

/// 获取系统资源统计
#[instrument(skip_all)]
pub async fn get_system_stats(
    State(state): State<AppState>,
) -> Result<Json<SystemStatsResponse>, ApiError> {
    let stats = state.manager.get_system_stats();
    Ok(Json(SystemStatsResponse { stats }))
}

/// 获取所有运行中服务的进程资源统计
#[instrument(skip_all)]
pub async fn get_process_stats(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
) -> Result<Json<ProcessStatsResponse>, ApiError> {
    // 获取所有服务
    let services = state.manager.list_services().await?;

    // 过滤用户有权限访问的运行中服务，收集 PID
    let mut service_pids: Vec<(String, u32)> = Vec::new();
    for svc in services {
        if !auth.is_admin() && !auth.can_access_service(&svc.id) {
            continue;
        }
        if svc.state != hypercraft_core::ServiceState::Running {
            continue;
        }
        // 获取服务状态以获取 PID
        if let Ok(status) = state.manager.status(&svc.id).await {
            if let Some(pid) = status.pid {
                service_pids.push((svc.id, pid));
            }
        }
    }

    // 批量获取进程资源
    let pids: Vec<u32> = service_pids.iter().map(|(_, pid)| *pid).collect();
    let stats_map = state.manager.get_processes_stats(&pids);

    // 构建响应：service_id -> ProcessStats
    let mut processes = HashMap::new();
    for (service_id, pid) in service_pids {
        if let Some(stats) = stats_map.get(&pid) {
            processes.insert(service_id, stats.clone());
        }
    }

    Ok(Json(ProcessStatsResponse { processes }))
}
