use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Extension;
use axum::Json;
use hypercraft_core::ServiceGroup;
use serde::Deserialize;
use tracing::instrument;

use crate::app::middleware::{AuthInfo, RequireAdmin};
use crate::app::{ApiError, AppState};

/// 列出所有分组
#[instrument(skip_all)]
pub async fn list_groups(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthInfo>,
) -> Result<Json<Vec<ServiceGroup>>, ApiError> {
    let groups = state.manager.list_groups().await?;
    Ok(Json(groups))
}

#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

/// 创建分组
#[instrument(skip_all)]
pub async fn create_group(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Json(payload): Json<CreateGroupRequest>,
) -> Result<Json<ServiceGroup>, ApiError> {
    let group = state
        .manager
        .create_group(payload.id, payload.name, payload.color)
        .await?;
    Ok(Json(group))
}

#[derive(Debug, Deserialize)]
pub struct UpdateGroupRequest {
    pub name: Option<String>,
    pub color: Option<Option<String>>,
}

/// 更新分组
#[instrument(skip_all)]
pub async fn update_group(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
    Json(payload): Json<UpdateGroupRequest>,
) -> Result<Json<ServiceGroup>, ApiError> {
    let group = state
        .manager
        .update_group(&id, payload.name, payload.color)
        .await?;
    Ok(Json(group))
}

/// 删除分组
#[instrument(skip_all)]
pub async fn delete_group(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state.manager.delete_group(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct ReorderGroupsRequest {
    pub group_ids: Vec<String>,
}

/// 重新排序分组
#[instrument(skip_all)]
pub async fn reorder_groups(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Json(payload): Json<ReorderGroupsRequest>,
) -> Result<Json<Vec<ServiceGroup>>, ApiError> {
    let groups = state.manager.reorder_groups(payload.group_ids).await?;
    Ok(Json(groups))
}

#[derive(Debug, Deserialize)]
pub struct UpdateServiceTagsRequest {
    pub tags: Vec<String>,
}

/// 更新服务 tags
#[instrument(skip_all)]
pub async fn update_service_tags(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
    Json(payload): Json<UpdateServiceTagsRequest>,
) -> Result<StatusCode, ApiError> {
    state.manager.update_service_tags(&id, payload.tags).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct UpdateServiceGroupRequest {
    pub group: Option<String>,
}

/// 更新服务分组
#[instrument(skip_all)]
pub async fn update_service_group(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
    Json(payload): Json<UpdateServiceGroupRequest>,
) -> Result<StatusCode, ApiError> {
    state
        .manager
        .update_service_group(&id, payload.group)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct ReorderServicesRequest {
    /// Vec of (service_id, group_id, order)
    pub services: Vec<ServiceOrderItem>,
}

#[derive(Debug, Deserialize)]
pub struct ServiceOrderItem {
    pub id: String,
    pub group: Option<String>,
    pub order: i32,
}

/// 批量更新服务排序（用于拖拽）
#[instrument(skip_all)]
pub async fn reorder_services(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Json(payload): Json<ReorderServicesRequest>,
) -> Result<StatusCode, ApiError> {
    let orders: Vec<(String, Option<String>, i32)> = payload
        .services
        .into_iter()
        .map(|s| (s.id, s.group, s.order))
        .collect();
    state.manager.reorder_services(orders).await?;
    Ok(StatusCode::NO_CONTENT)
}
