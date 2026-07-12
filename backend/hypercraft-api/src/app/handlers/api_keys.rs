//! API Key 管理（仅管理员）

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use hypercraft_core::{
    ApiKey, ApiKeySecretResponse, ApiKeySummary, CreateApiKeyRequest, CreateApiKeyResponse,
    UpdateApiKeyRequest,
};

use super::super::error::ApiError;
use super::super::middleware::{AuthInfo, RequireAdmin};
use super::super::state::AppState;

/// 当前管理员是否可管理该 Key
/// 超管全量；系统管理员仅当 Key 的 service_ids 全部在本人权限内
/// service_ids 为空的 Key 仅创建者或超管可管（避免空壳 Key 被横向枚举/撤销）
fn can_manage_api_key(auth: &AuthInfo, key: &ApiKey) -> bool {
    if auth.is_super_admin() {
        return true;
    }
    if key.service_ids.is_empty() {
        return key.created_by == auth.claims.sub;
    }
    key.service_ids
        .iter()
        .all(|sid| auth.can_access_service(sid))
}

/// 无权限时统一 Forbidden
fn forbid_manage() -> ApiError {
    ApiError::forbidden("没有权限管理该 API Key")
}

/// 非超管创建/更新时，service_ids 不得超出本人范围
fn ensure_service_ids_in_scope(auth: &AuthInfo, service_ids: &[String]) -> Result<(), ApiError> {
    if auth.is_super_admin() {
        return Ok(());
    }
    for sid in service_ids {
        if !auth.can_access_service(sid) {
            return Err(ApiError::forbidden(format!(
                "没有权限分配服务: {}",
                sid
            )));
        }
    }
    Ok(())
}

/// GET /api-keys - 列出当前管理员可见的 API Key
pub async fn list_api_keys(
    State(state): State<AppState>,
    RequireAdmin(auth): RequireAdmin,
) -> Result<Json<Vec<ApiKeySummary>>, ApiError> {
    let keys = state.user_manager.list_api_keys().await?;
    let summaries: Vec<ApiKeySummary> = keys
        .into_iter()
        .filter(|k| can_manage_api_key(&auth, k))
        .map(Into::into)
        .collect();
    Ok(Json(summaries))
}

/// POST /api-keys - 创建 API Key（明文仅返回一次）
pub async fn create_api_key(
    State(state): State<AppState>,
    RequireAdmin(auth): RequireAdmin,
    Json(req): Json<CreateApiKeyRequest>,
) -> Result<(StatusCode, Json<CreateApiKeyResponse>), ApiError> {
    ensure_service_ids_in_scope(&auth, &req.service_ids)?;

    let resp = state
        .user_manager
        .create_api_key(req, &auth.claims.sub)
        .await?;
    Ok((StatusCode::CREATED, Json(resp)))
}

/// GET /api-keys/:id - 获取单个 Key 摘要
pub async fn get_api_key(
    State(state): State<AppState>,
    RequireAdmin(auth): RequireAdmin,
    Path(id): Path<String>,
) -> Result<Json<ApiKeySummary>, ApiError> {
    let key = state.user_manager.get_api_key(&id).await?;
    if !can_manage_api_key(&auth, &key) {
        return Err(forbid_manage());
    }
    Ok(Json(key.into()))
}

/// GET /api-keys/:id/secret - 随时查看完整明文
pub async fn reveal_api_key_secret(
    State(state): State<AppState>,
    RequireAdmin(auth): RequireAdmin,
    Path(id): Path<String>,
) -> Result<Json<ApiKeySecretResponse>, ApiError> {
    let key = state.user_manager.get_api_key(&id).await?;
    if !can_manage_api_key(&auth, &key) {
        return Err(forbid_manage());
    }
    let resp = state.user_manager.reveal_api_key_secret(&id).await?;
    Ok(Json(resp))
}

/// PUT /api-keys/:id - 更新名称 / 服务 / scopes
pub async fn update_api_key(
    State(state): State<AppState>,
    RequireAdmin(auth): RequireAdmin,
    Path(id): Path<String>,
    Json(req): Json<UpdateApiKeyRequest>,
) -> Result<Json<ApiKeySummary>, ApiError> {
    let key = state.user_manager.get_api_key(&id).await?;
    if !can_manage_api_key(&auth, &key) {
        return Err(forbid_manage());
    }
    if let Some(ref service_ids) = req.service_ids {
        ensure_service_ids_in_scope(&auth, service_ids)?;
    }

    let key = state.user_manager.update_api_key(&id, req).await?;
    // 更新后若服务范围超出当前管理员，也不应再返回敏感信息——但超管无此问题
    if !can_manage_api_key(&auth, &key) {
        return Err(forbid_manage());
    }
    Ok(Json(key.into()))
}

/// POST /api-keys/:id/rotate - 重新生成明文（旧密钥立即失效）
pub async fn rotate_api_key(
    State(state): State<AppState>,
    RequireAdmin(auth): RequireAdmin,
    Path(id): Path<String>,
) -> Result<Json<CreateApiKeyResponse>, ApiError> {
    let key = state.user_manager.get_api_key(&id).await?;
    if !can_manage_api_key(&auth, &key) {
        return Err(forbid_manage());
    }
    let resp = state.user_manager.rotate_api_key_secret(&id).await?;
    Ok(Json(resp))
}

/// DELETE /api-keys/:id - 撤销 API Key
pub async fn revoke_api_key(
    State(state): State<AppState>,
    RequireAdmin(auth): RequireAdmin,
    Path(id): Path<String>,
) -> Result<Json<ApiKeySummary>, ApiError> {
    let key = state.user_manager.get_api_key(&id).await?;
    if !can_manage_api_key(&auth, &key) {
        return Err(forbid_manage());
    }
    let key = state.user_manager.revoke_api_key(&id).await?;
    Ok(Json(key.into()))
}
