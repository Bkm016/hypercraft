//! 运行环境管理（Java / Node.js / Python / Go … 任意 mise 工具）
//!
//! - 列表：任意已登录用户（创建服务时需要选择）
//! - 工具 / 版本查询、安装、取消、清理、登记、删除、下载源：管理员（超管 / 系统管理员）

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use hypercraft_core::{api_key_scopes, JavaRuntime, RuntimeSource};
use serde::{Deserialize, Serialize};

use crate::app::middleware::{AuthInfo, RequireAdmin};
use crate::app::{ApiError, AppState};
use crate::runtime_installer::{
    CleanupResult, DownloadSettings, InstallRequest, InstallTask, JavaCatalog, StorageUsage,
    ToolListResponse, ToolVersions,
};

#[derive(Debug, Serialize)]
pub struct RuntimeView {
    #[serde(flatten)]
    pub runtime: JavaRuntime,
    /// 正在使用该运行环境的服务 ID（仅管理员可见）
    pub used_by: Vec<String>,
}

async fn usage_map(state: &AppState) -> std::collections::HashMap<String, Vec<String>> {
    let mut map: std::collections::HashMap<String, Vec<String>> = Default::default();
    if let Ok(list) = state.manager.list_services().await {
        for s in list {
            if let Ok(m) = state.manager.load_manifest(&s.id).await {
                for rt in m.runtimes {
                    map.entry(rt).or_default().push(s.id.clone());
                }
            }
        }
    }
    map
}

fn upstream_err(e: String) -> ApiError {
    ApiError::new("UpstreamUnavailable", StatusCode::BAD_GATEWAY, e)
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    #[serde(default)]
    pub tool: Option<String>,
}

/// GET /runtimes?tool=java
pub async fn list_runtimes(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<RuntimeView>>, ApiError> {
    auth.require_scope(api_key_scopes::READ)?;
    let runtimes = state.runtimes.registry().list()?;
    let usage = if auth.is_admin() { usage_map(&state).await } else { Default::default() };
    Ok(Json(
        runtimes
            .into_iter()
            .filter(|r| q.tool.as_deref().map_or(true, |t| r.tool == t))
            .map(|r| RuntimeView { used_by: usage.get(&r.id).cloned().unwrap_or_default(), runtime: r })
            .collect(),
    ))
}

/// GET /runtimes/tools - mise registry 工具列表
pub async fn list_tools(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
) -> Result<Json<ToolListResponse>, ApiError> {
    state.runtimes.tools().await.map(Json).map_err(upstream_err)
}

#[derive(Debug, Deserialize)]
pub struct RefreshQuery {
    #[serde(default)]
    pub refresh: bool,
}

/// GET /runtimes/tools/:tool/versions?refresh=true
pub async fn tool_versions(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(tool): Path<String>,
    Query(q): Query<RefreshQuery>,
) -> Result<Json<ToolVersions>, ApiError> {
    state.runtimes.versions(&tool, q.refresh).await.map(Json).map_err(upstream_err)
}

/// GET /runtimes/java/catalog?refresh=true - Java 发行版 × 主版本目录
pub async fn java_catalog(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Query(q): Query<RefreshQuery>,
) -> Result<Json<JavaCatalog>, ApiError> {
    state.runtimes.java_catalog(q.refresh).await.map(Json).map_err(upstream_err)
}

/// POST /runtimes/install
pub async fn install_runtime(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Json(req): Json<InstallRequest>,
) -> Result<(StatusCode, Json<InstallTask>), ApiError> {
    let task = state.runtimes.start_install(req).await.map_err(ApiError::bad_request)?;
    Ok((StatusCode::ACCEPTED, Json(task)))
}

/// GET /runtimes/tasks
pub async fn list_install_tasks(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
) -> Json<Vec<InstallTask>> {
    Json(state.runtimes.list_tasks().await)
}

#[derive(Debug, Serialize)]
pub struct ClearTasksResponse {
    pub removed: usize,
}

/// DELETE /runtimes/tasks - 清理全部已结束的任务记录
pub async fn clear_install_tasks(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
) -> Json<ClearTasksResponse> {
    Json(ClearTasksResponse { removed: state.runtimes.clear_finished_tasks().await })
}

/// GET /runtimes/tasks/:id
pub async fn get_install_task(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
) -> Result<Json<InstallTask>, ApiError> {
    state
        .runtimes
        .get_task(&id)
        .await
        .map(Json)
        .ok_or_else(|| ApiError::new("NotFound", StatusCode::NOT_FOUND, "task not found"))
}

/// DELETE /runtimes/tasks/:id - 删除单条已结束任务记录
pub async fn delete_install_task(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state.runtimes.remove_task(&id).await.map_err(ApiError::bad_request)?;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /runtimes/tasks/:id/cancel - 取消进行中的任务（会清理半成品）
pub async fn cancel_install_task(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state.runtimes.cancel_task(&id).await.map_err(ApiError::bad_request)?;
    Ok(StatusCode::ACCEPTED)
}

/// GET /runtimes/storage - 磁盘占用与可清理项
pub async fn runtime_storage(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
) -> Json<StorageUsage> {
    Json(state.runtimes.storage().await)
}

#[derive(Debug, Deserialize)]
pub struct CleanupRequest {
    /// 清理已结束的任务记录
    #[serde(default = "yes")]
    pub tasks: bool,
    /// 清理 mise 下载缓存
    #[serde(default = "yes")]
    pub cache: bool,
    /// 卸载未被任何运行环境引用的安装
    #[serde(default)]
    pub orphans: bool,
}

fn yes() -> bool {
    true
}

/// POST /runtimes/cleanup
pub async fn cleanup_runtimes(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Json(req): Json<CleanupRequest>,
) -> Result<Json<CleanupResult>, ApiError> {
    state
        .runtimes
        .cleanup(req.tasks, req.cache, req.orphans)
        .await
        .map(Json)
        .map_err(|e| ApiError::new("Conflict", StatusCode::CONFLICT, e))
}

#[derive(Debug, Deserialize)]
pub struct RegisterJavaRequest {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub home: String,
}

/// POST /runtimes - 登记外部已有的 JAVA_HOME
pub async fn register_runtime(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Json(req): Json<RegisterJavaRequest>,
) -> Result<(StatusCode, Json<JavaRuntime>), ApiError> {
    let rt = state
        .runtimes
        .register_custom(&req.id, req.name, &req.home)
        .await
        .map_err(ApiError::bad_request)?;
    Ok((StatusCode::CREATED, Json(rt)))
}

#[derive(Debug, Deserialize)]
pub struct UpdateRuntimeRequest {
    pub name: String,
}

/// PATCH /runtimes/:id - 重命名
pub async fn update_runtime(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
    Json(req): Json<UpdateRuntimeRequest>,
) -> Result<Json<JavaRuntime>, ApiError> {
    let mut rt = state.runtimes.registry().get(&id)?;
    if rt.source == RuntimeSource::System {
        return Err(ApiError::bad_request("系统运行环境不可修改"));
    }
    let name = req.name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("名称不能为空"));
    }
    rt.name = name.to_string();
    state.runtimes.registry().save(&rt)?;
    Ok(Json(rt))
}

/// DELETE /runtimes/:id - 被服务引用时拒绝删除
pub async fn delete_runtime(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let usage = usage_map(&state).await;
    if let Some(services) = usage.get(&id).filter(|v| !v.is_empty()) {
        return Err(ApiError::new(
            "InUse",
            StatusCode::CONFLICT,
            format!("运行环境正在被以下服务使用：{}", services.join(", ")),
        ));
    }
    state.runtimes.remove(&id).await.map_err(ApiError::bad_request)?;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /runtimes/settings - 下载源配置
pub async fn get_runtime_settings(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
) -> Json<DownloadSettings> {
    Json(state.runtimes.settings().await)
}

/// PUT /runtimes/settings
pub async fn update_runtime_settings(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Json(req): Json<DownloadSettings>,
) -> Result<Json<DownloadSettings>, ApiError> {
    state.runtimes.update_settings(req).await.map(Json).map_err(ApiError::bad_request)
}
