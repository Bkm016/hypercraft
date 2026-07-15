//! API Key 管理（仅超级管理员）
//! API Key 可访问全部服务，因此管理端点仅向超级管理员开放。

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use hypercraft_core::{
    ApiKeySecretResponse, ApiKeySummary, CreateApiKeyRequest, CreateApiKeyResponse,
    UpdateApiKeyRequest,
};

use super::super::error::ApiError;
use super::super::middleware::RequireSuperAdmin;
use super::super::state::AppState;

/// GET /api-keys - 列出当前管理员可见的 API Key
pub async fn list_api_keys(
    State(state): State<AppState>,
    RequireSuperAdmin(_): RequireSuperAdmin,
) -> Result<Json<Vec<ApiKeySummary>>, ApiError> {
    let keys = state.user_manager.list_api_keys().await?;
    let summaries: Vec<ApiKeySummary> = keys
        .into_iter()
        .map(Into::into)
        .collect();
    Ok(Json(summaries))
}

/// POST /api-keys - 创建 API Key（明文仅返回一次）
pub async fn create_api_key(
    State(state): State<AppState>,
    RequireSuperAdmin(auth): RequireSuperAdmin,
    Json(req): Json<CreateApiKeyRequest>,
) -> Result<(StatusCode, Json<CreateApiKeyResponse>), ApiError> {
    let resp = state
        .user_manager
        .create_api_key(req, &auth.claims.sub)
        .await?;
    Ok((StatusCode::CREATED, Json(resp)))
}

/// GET /api-keys/:id - 获取单个 Key 摘要
pub async fn get_api_key(
    State(state): State<AppState>,
    RequireSuperAdmin(_): RequireSuperAdmin,
    Path(id): Path<String>,
) -> Result<Json<ApiKeySummary>, ApiError> {
    let key = state.user_manager.get_api_key(&id).await?;
    Ok(Json(key.into()))
}

/// GET /api-keys/:id/secret - 随时查看完整明文
pub async fn reveal_api_key_secret(
    State(state): State<AppState>,
    RequireSuperAdmin(_): RequireSuperAdmin,
    Path(id): Path<String>,
) -> Result<Json<ApiKeySecretResponse>, ApiError> {
    let resp = state.user_manager.reveal_api_key_secret(&id).await?;
    Ok(Json(resp))
}

/// PUT /api-keys/:id - 更新名称 / scopes
pub async fn update_api_key(
    State(state): State<AppState>,
    RequireSuperAdmin(_): RequireSuperAdmin,
    Path(id): Path<String>,
    Json(req): Json<UpdateApiKeyRequest>,
) -> Result<Json<ApiKeySummary>, ApiError> {
    let key = state.user_manager.update_api_key(&id, req).await?;
    Ok(Json(key.into()))
}

/// POST /api-keys/:id/rotate - 重新生成明文（旧密钥立即失效）
pub async fn rotate_api_key(
    State(state): State<AppState>,
    RequireSuperAdmin(_): RequireSuperAdmin,
    Path(id): Path<String>,
) -> Result<Json<CreateApiKeyResponse>, ApiError> {
    let resp = state.user_manager.rotate_api_key_secret(&id).await?;
    Ok(Json(resp))
}

/// DELETE /api-keys/:id - 撤销 API Key
pub async fn revoke_api_key(
    State(state): State<AppState>,
    RequireSuperAdmin(_): RequireSuperAdmin,
    Path(id): Path<String>,
) -> Result<Json<ApiKeySummary>, ApiError> {
    let key = state.user_manager.revoke_api_key(&id).await?;
    Ok(Json(key.into()))
}
