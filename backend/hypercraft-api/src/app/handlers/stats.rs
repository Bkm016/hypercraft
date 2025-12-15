//! 系统资源统计 API

use axum::extract::State;
use axum::Json;
use hypercraft_core::SystemStats;
use serde::Serialize;
use tracing::instrument;

use crate::app::{ApiError, AppState};

/// 系统资源响应
#[derive(Debug, Serialize)]
pub struct SystemStatsResponse {
    #[serde(flatten)]
    pub stats: SystemStats,
}

/// 获取系统资源统计
#[instrument(skip_all)]
pub async fn get_system_stats(
    State(state): State<AppState>,
) -> Result<Json<SystemStatsResponse>, ApiError> {
    let stats = state.manager.get_system_stats();
    Ok(Json(SystemStatsResponse { stats }))
}
