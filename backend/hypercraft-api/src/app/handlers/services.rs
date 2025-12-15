use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Extension;
use axum::Json;
use chrono::Utc;
use hypercraft_core::{Schedule, ServiceManifest, ServiceScheduler, ServiceStatus, ServiceSummary};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::str::FromStr;
use tracing::instrument;

use crate::app::middleware::{AuthInfo, RequireAdmin, ServicePermission};
use crate::app::{ApiError, AppState};

#[instrument(skip_all)]
pub async fn list_services(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
) -> Result<Json<Vec<ServiceSummary>>, ApiError> {
    let services = state.manager.list_services().await?;

    // 管理员可以看到所有服务，普通用户只能看到有权限的服务
    let filtered: Vec<ServiceSummary> = if auth.is_admin() {
        services
    } else {
        services
            .into_iter()
            .filter(|s| auth.can_access_service(&s.id))
            .collect()
    };

    Ok(Json(filtered))
}

#[instrument(skip_all)]
pub async fn create_service(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Json(payload): Json<ServiceManifest>,
) -> Result<Json<ServiceManifest>, ApiError> {
    let svc = state.manager.create_service(payload).await?;

    // 同步调度任务
    if let Some(schedule) = &svc.schedule {
        if let Err(e) = state.scheduler.upsert_schedule(&svc.id, schedule).await {
            tracing::warn!(service_id = %svc.id, error = %e, "failed to setup schedule");
        }
    }

    Ok(Json(svc))
}

#[instrument(skip_all)]
pub async fn get_service(
    State(state): State<AppState>,
    ServicePermission { service_id, .. }: ServicePermission,
) -> Result<Json<serde_json::Value>, ApiError> {
    let manifest = state.manager.load_manifest(&service_id).await?;
    let status = state.manager.status(&service_id).await?;
    Ok(Json(json!({
        "manifest": manifest,
        "status": status
    })))
}

#[instrument(skip_all)]
pub async fn delete_service(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    // 移除调度任务
    let _ = state.scheduler.remove_schedule(&id).await;

    state.manager.delete_service(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[instrument(skip_all)]
pub async fn update_service(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
    Json(payload): Json<ServiceManifest>,
) -> Result<StatusCode, ApiError> {
    state.manager.update_service(&id, payload.clone()).await?;

    // 同步调度任务
    if let Some(schedule) = &payload.schedule {
        if let Err(e) = state.scheduler.upsert_schedule(&id, schedule).await {
            tracing::warn!(service_id = %id, error = %e, "failed to update schedule");
        }
    } else {
        // 移除调度任务（如果存在）
        let _ = state.scheduler.remove_schedule(&id).await;
    }

    Ok(StatusCode::NO_CONTENT)
}

#[instrument(skip_all)]
pub async fn start_service(
    State(state): State<AppState>,
    ServicePermission { service_id, .. }: ServicePermission,
) -> Result<Json<ServiceStatus>, ApiError> {
    let status = state.manager.start(&service_id).await?;
    Ok(Json(status))
}

#[instrument(skip_all)]
pub async fn stop_service(
    State(state): State<AppState>,
    ServicePermission { service_id, .. }: ServicePermission,
) -> Result<Json<ServiceStatus>, ApiError> {
    let status = state.manager.stop(&service_id).await?;
    Ok(Json(status))
}

#[instrument(skip_all)]
pub async fn shutdown_service(
    State(state): State<AppState>,
    ServicePermission { service_id, .. }: ServicePermission,
) -> Result<Json<ServiceStatus>, ApiError> {
    let status = state.manager.shutdown(&service_id).await?;
    Ok(Json(status))
}

#[instrument(skip_all)]
pub async fn kill_service(
    State(state): State<AppState>,
    ServicePermission { service_id, .. }: ServicePermission,
) -> Result<Json<ServiceStatus>, ApiError> {
    let status = state.manager.kill(&service_id).await?;
    Ok(Json(status))
}

#[instrument(skip_all)]
pub async fn restart_service(
    State(state): State<AppState>,
    ServicePermission { service_id, .. }: ServicePermission,
) -> Result<Json<ServiceStatus>, ApiError> {
    let status = state.manager.restart(&service_id).await?;
    Ok(Json(status))
}

#[instrument(skip_all)]
pub async fn get_status(
    State(state): State<AppState>,
    ServicePermission { service_id, .. }: ServicePermission,
) -> Result<Json<ServiceStatus>, ApiError> {
    let status = state.manager.status(&service_id).await?;
    Ok(Json(status))
}

/// Schedule 响应结构
#[derive(Debug, Serialize)]
pub struct ScheduleResponse {
    pub schedule: Option<Schedule>,
    pub next_run: Option<String>,
}

/// Schedule 更新请求
#[derive(Debug, Deserialize)]
pub struct UpdateScheduleRequest {
    pub schedule: Option<Schedule>,
}

/// 获取服务的定时配置
#[instrument(skip_all)]
pub async fn get_schedule(
    State(state): State<AppState>,
    ServicePermission { service_id, .. }: ServicePermission,
) -> Result<Json<ScheduleResponse>, ApiError> {
    let manifest = state.manager.load_manifest(&service_id).await?;
    let next_run = manifest
        .schedule
        .as_ref()
        .filter(|s| s.enabled && !s.cron.is_empty())
        .and_then(|s| ServiceScheduler::next_run(&s.cron).ok().flatten())
        .map(|dt| dt.to_rfc3339());

    Ok(Json(ScheduleResponse {
        schedule: manifest.schedule,
        next_run,
    }))
}

/// 更新服务的定时配置
#[instrument(skip_all)]
pub async fn update_schedule(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
    Json(payload): Json<UpdateScheduleRequest>,
) -> Result<Json<ScheduleResponse>, ApiError> {
    // 验证 cron 表达式
    if let Some(schedule) = &payload.schedule {
        if schedule.enabled && !schedule.cron.is_empty() {
            ServiceScheduler::validate_cron(&schedule.cron).map_err(|e| {
                ApiError::bad_request(format!("invalid cron expression: {}", e))
            })?;
        }
    }

    // 加载并更新 manifest
    let mut manifest = state.manager.load_manifest(&id).await?;
    manifest.schedule = payload.schedule.clone();
    state.manager.update_service(&id, manifest).await?;

    // 同步调度器
    if let Some(schedule) = &payload.schedule {
        state.scheduler.upsert_schedule(&id, schedule).await?;
    } else {
        state.scheduler.remove_schedule(&id).await?;
    }

    // 计算下次运行时间
    let next_run = payload
        .schedule
        .as_ref()
        .filter(|s| s.enabled && !s.cron.is_empty())
        .and_then(|s| ServiceScheduler::next_run(&s.cron).ok().flatten())
        .map(|dt| dt.to_rfc3339());

    Ok(Json(ScheduleResponse {
        schedule: payload.schedule,
        next_run,
    }))
}

/// 验证 cron 表达式
#[derive(Debug, Deserialize)]
pub struct ValidateCronRequest {
    pub cron: String,
}

#[derive(Debug, Serialize)]
pub struct ValidateCronResponse {
    pub valid: bool,
    pub next_runs: Vec<String>,
    pub error: Option<String>,
}

#[instrument(skip_all)]
pub async fn validate_cron(
    Json(payload): Json<ValidateCronRequest>,
) -> Json<ValidateCronResponse> {
    match ServiceScheduler::validate_cron(&payload.cron) {
        Ok(_) => {
            // 计算接下来5次运行时间
            let next_runs: Vec<String> = cron::Schedule::from_str(&payload.cron)
                .map(|schedule| {
                    schedule
                        .upcoming(Utc)
                        .take(5)
                        .map(|dt| dt.to_rfc3339())
                        .collect()
                })
                .unwrap_or_default();

            Json(ValidateCronResponse {
                valid: true,
                next_runs,
                error: None,
            })
        }
        Err(e) => Json(ValidateCronResponse {
            valid: false,
            next_runs: vec![],
            error: Some(e.to_string()),
        }),
    }
}
