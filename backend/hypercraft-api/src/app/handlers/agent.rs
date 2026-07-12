//! Agent 薄封装：复用 service 运维能力，默认文本日志

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Extension;
use axum::Json;
use hypercraft_core::{ServiceManifest, ServiceStatus, ServiceSummary};
use serde::Serialize;
use serde_json::json;
use tracing::instrument;

use super::attach::attach_service;
use super::logs::{get_logs, LogQuery};
use super::services::{
    create_service, delete_service, get_service, get_status, kill_service, list_services,
    restart_service, shutdown_service, start_service, stop_service, update_service,
};
use super::super::error::ApiError;
use super::super::middleware::{AuthInfo, ServicePermission};
use super::super::state::AppState;

/// GET /agent/me - 当前身份与 scopes
#[instrument(skip_all)]
pub async fn agent_me(Extension(auth): Extension<AuthInfo>) -> Json<serde_json::Value> {
    Json(json!({
        "sub": auth.claims.sub,
        "username": auth.claims.username,
        "token_type": auth.claims.token_type,
        "service_ids": auth.claims.service_ids,
        "scopes": auth.scopes,
        "is_admin": auth.is_admin(),
        "is_api_key": auth.is_api_key(),
    }))
}

/// GET /agent/help - 机器可读能力说明
#[instrument(skip_all)]
pub async fn agent_help() -> Json<AgentHelp> {
    Json(AgentHelp {
        auth: "Authorization: Bearer hc_ak_<id>_<secret> 或 JWT access token",
        scopes: vec![
            "read — list/get/status".into(),
            "control — start/stop/restart/shutdown/kill".into(),
            "manage — create/update/delete service".into(),
            "logs — logs tail/follow".into(),
            "attach — WebSocket PTY".into(),
        ],
        endpoints: vec![
            AgentEndpoint {
                method: "GET",
                path: "/agent/me",
                scope: None,
                note: "当前身份",
            },
            AgentEndpoint {
                method: "GET",
                path: "/agent/help",
                scope: None,
                note: "能力说明",
            },
            AgentEndpoint {
                method: "GET",
                path: "/agent/services",
                scope: Some("read"),
                note: "可见服务列表",
            },
            AgentEndpoint {
                method: "POST",
                path: "/agent/services",
                scope: Some("manage"),
                note: "创建服务（body=ServiceManifest；创建后自动写入 Key.service_ids）",
            },
            AgentEndpoint {
                method: "GET",
                path: "/agent/services/:id",
                scope: Some("read"),
                note: "manifest + status",
            },
            AgentEndpoint {
                method: "PUT",
                path: "/agent/services/:id",
                scope: Some("manage"),
                note: "更新服务定义（body=ServiceManifest）",
            },
            AgentEndpoint {
                method: "DELETE",
                path: "/agent/services/:id",
                scope: Some("manage"),
                note: "删除服务",
            },
            AgentEndpoint {
                method: "GET",
                path: "/agent/services/:id/status",
                scope: Some("read"),
                note: "运行状态",
            },
            AgentEndpoint {
                method: "POST",
                path: "/agent/services/:id/start",
                scope: Some("control"),
                note: "启动",
            },
            AgentEndpoint {
                method: "POST",
                path: "/agent/services/:id/stop",
                scope: Some("control"),
                note: "停止",
            },
            AgentEndpoint {
                method: "POST",
                path: "/agent/services/:id/restart",
                scope: Some("control"),
                note: "重启",
            },
            AgentEndpoint {
                method: "POST",
                path: "/agent/services/:id/shutdown",
                scope: Some("control"),
                note: "优雅关闭",
            },
            AgentEndpoint {
                method: "POST",
                path: "/agent/services/:id/kill",
                scope: Some("control"),
                note: "强杀",
            },
            AgentEndpoint {
                method: "GET",
                path: "/agent/services/:id/logs?tail=200&follow=false",
                scope: Some("logs"),
                note: "默认 text/plain；follow=true 为 SSE 纯文本",
            },
            AgentEndpoint {
                method: "GET",
                path: "/agent/services/:id/attach",
                scope: Some("attach"),
                note: "WebSocket PTY；可用 ?token=",
            },
        ],
    })
}

#[derive(Debug, Serialize)]
pub struct AgentHelp {
    pub auth: &'static str,
    pub scopes: Vec<String>,
    pub endpoints: Vec<AgentEndpoint>,
}

#[derive(Debug, Serialize)]
pub struct AgentEndpoint {
    pub method: &'static str,
    pub path: &'static str,
    pub scope: Option<&'static str>,
    pub note: &'static str,
}

/// GET /agent/services
pub async fn agent_list_services(
    state: State<AppState>,
    auth: Extension<AuthInfo>,
) -> Result<Json<Vec<ServiceSummary>>, ApiError> {
    list_services(state, auth).await
}

/// POST /agent/services — 创建服务
pub async fn agent_create_service(
    state: State<AppState>,
    auth: Extension<AuthInfo>,
    body: Json<ServiceManifest>,
) -> Result<Json<ServiceManifest>, ApiError> {
    create_service(state, auth, body).await
}

/// GET /agent/services/:id
pub async fn agent_get_service(
    state: State<AppState>,
    perm: ServicePermission,
) -> Result<Json<serde_json::Value>, ApiError> {
    get_service(state, perm).await
}

/// PUT /agent/services/:id — 更新服务定义
pub async fn agent_update_service(
    state: State<AppState>,
    auth: Extension<AuthInfo>,
    Path(id): Path<String>,
    body: Json<ServiceManifest>,
) -> Result<StatusCode, ApiError> {
    update_service(state, auth, Path(id), body).await
}

/// DELETE /agent/services/:id — 删除服务
pub async fn agent_delete_service(
    state: State<AppState>,
    auth: Extension<AuthInfo>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    delete_service(state, auth, Path(id)).await
}

/// GET /agent/services/:id/status
pub async fn agent_get_status(
    state: State<AppState>,
    perm: ServicePermission,
) -> Result<Json<ServiceStatus>, ApiError> {
    get_status(state, perm).await
}

/// POST /agent/services/:id/start
pub async fn agent_start(
    state: State<AppState>,
    perm: ServicePermission,
) -> Result<Json<ServiceStatus>, ApiError> {
    start_service(state, perm).await
}

/// POST /agent/services/:id/stop
pub async fn agent_stop(
    state: State<AppState>,
    perm: ServicePermission,
) -> Result<Json<ServiceStatus>, ApiError> {
    stop_service(state, perm).await
}

/// POST /agent/services/:id/restart
pub async fn agent_restart(
    state: State<AppState>,
    perm: ServicePermission,
) -> Result<Json<ServiceStatus>, ApiError> {
    restart_service(state, perm).await
}

/// POST /agent/services/:id/shutdown
pub async fn agent_shutdown(
    state: State<AppState>,
    perm: ServicePermission,
) -> Result<Json<ServiceStatus>, ApiError> {
    shutdown_service(state, perm).await
}

/// POST /agent/services/:id/kill
pub async fn agent_kill(
    state: State<AppState>,
    perm: ServicePermission,
) -> Result<Json<ServiceStatus>, ApiError> {
    kill_service(state, perm).await
}

/// GET /agent/services/:id/logs — 默认 format=text
pub async fn agent_logs(
    state: State<AppState>,
    auth: Extension<AuthInfo>,
    Path(id): Path<String>,
    Query(mut query): Query<LogQuery>,
) -> Result<Response, ApiError> {
    // Agent 路径默认纯文本
    if query.format.is_none() {
        query.format = Some("text".into());
    }
    // 默认 tail 按行 200
    if query.tail.is_none() && !query.follow.unwrap_or(false) {
        query.tail = Some(200);
    }
    get_logs(state, auth, Path(id), Query(query)).await
}

/// GET /agent/services/:id/attach — 同现有 attach
pub async fn agent_attach(
    state: State<AppState>,
    auth: Extension<AuthInfo>,
    Path(id): Path<String>,
    ws: axum::extract::ws::WebSocketUpgrade,
) -> Result<Response, ApiError> {
    attach_service(state, auth, Path(id), ws).await
}
