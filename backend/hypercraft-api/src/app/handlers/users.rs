//! 用户管理 API handlers（仅管理员可访问）

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use hypercraft_core::{CreateUserRequest, UpdateUserRequest, UserSummary};
use serde::Deserialize;

use super::super::error::ApiError;
use super::super::middleware::{AuthInfo, RequireAdmin};
use super::super::state::AppState;
use axum::Extension;

/// 禁止操作系统管理员账号 __devtoken__
fn forbid_devtoken_target(id: &str) -> Result<(), ApiError> {
    if id == "__devtoken__" {
        return Err(ApiError::forbidden("不能操作系统管理员账号"));
    }
    Ok(())
}

/// 非超管赋权时，service_ids 必须全部在本人可访问范围内
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

/// 仅超管可写入 is_admin 字段
fn ensure_can_write_is_admin(auth: &AuthInfo, is_admin: Option<bool>) -> Result<(), ApiError> {
    if is_admin.is_some() && !auth.is_super_admin() {
        return Err(ApiError::forbidden("仅超级管理员可设置系统管理员"));
    }
    Ok(())
}

/// GET /users - 列出所有用户
pub async fn list_users(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
) -> Result<Json<Vec<UserSummary>>, ApiError> {
    let users = state.user_manager.list_users().await?;
    let summaries: Vec<UserSummary> = users.into_iter().map(|u| u.into()).collect();
    Ok(Json(summaries))
}

/// POST /users - 创建用户
pub async fn create_user(
    State(state): State<AppState>,
    RequireAdmin(auth): RequireAdmin,
    Json(req): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserSummary>), ApiError> {
    if req.username.is_empty() {
        return Err(ApiError::bad_request("username is required"));
    }
    if req.password.is_empty() {
        return Err(ApiError::bad_request("password is required"));
    }
    // 非超管创建用户时，初始服务权限不得超出本人范围
    ensure_service_ids_in_scope(&auth, &req.service_ids)?;
    // 密码强度验证由 core 层 UserManager::create_user 执行
    let user = state.user_manager.create_user(req).await?;
    let summary: UserSummary = user.into();
    Ok((StatusCode::CREATED, Json(summary)))
}

/// GET /users/:id - 获取用户详情
pub async fn get_user(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
) -> Result<Json<UserSummary>, ApiError> {
    let user = state.user_manager.get_user(&id).await?;
    let summary: UserSummary = user.into();
    Ok(Json(summary))
}

/// PUT /users/:id - 更新用户
pub async fn update_user(
    State(state): State<AppState>,
    RequireAdmin(auth): RequireAdmin,
    Path(id): Path<String>,
    Json(req): Json<UpdateUserRequest>,
) -> Result<Json<UserSummary>, ApiError> {
    forbid_devtoken_target(&id)?;
    // is_admin 仅超管可写
    ensure_can_write_is_admin(&auth, req.is_admin)?;
    // 非超管赋权范围受限
    if let Some(ref service_ids) = req.service_ids {
        ensure_service_ids_in_scope(&auth, service_ids)?;
    }
    // 密码强度验证由 core 层 UserManager::update_user 执行
    let user = state.user_manager.update_user(&id, req).await?;
    let summary: UserSummary = user.into();
    Ok(Json(summary))
}

/// DELETE /users/:id - 删除用户
pub async fn delete_user(
    State(state): State<AppState>,
    RequireAdmin(_): RequireAdmin,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    forbid_devtoken_target(&id)?;
    state.user_manager.delete_user(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// 服务权限请求
#[derive(Debug, Deserialize)]
pub struct ServiceIdsRequest {
    pub service_ids: Vec<String>,
}

/// PUT /users/:id/services - 设置用户的服务权限
pub async fn set_user_services(
    State(state): State<AppState>,
    RequireAdmin(auth): RequireAdmin,
    Path(id): Path<String>,
    Json(req): Json<ServiceIdsRequest>,
) -> Result<Json<UserSummary>, ApiError> {
    forbid_devtoken_target(&id)?;
    ensure_service_ids_in_scope(&auth, &req.service_ids)?;
    let user = state
        .user_manager
        .update_user(
            &id,
            UpdateUserRequest {
                password: None,
                service_ids: Some(req.service_ids),
                is_admin: None,
            },
        )
        .await?;
    let summary: UserSummary = user.into();
    Ok(Json(summary))
}

/// POST /users/:user_id/services/:service_id - 添加服务权限
pub async fn add_user_service(
    State(state): State<AppState>,
    RequireAdmin(auth): RequireAdmin,
    Path((user_id, service_id)): Path<(String, String)>,
) -> Result<Json<UserSummary>, ApiError> {
    forbid_devtoken_target(&user_id)?;
    ensure_service_ids_in_scope(&auth, &[service_id.clone()])?;
    // 验证服务是否存在
    let _ = state.manager.load_manifest(&service_id).await?;

    let user = state
        .user_manager
        .add_service_permission(&user_id, &service_id)
        .await?;
    let summary: UserSummary = user.into();
    Ok(Json(summary))
}

/// DELETE /users/:user_id/services/:service_id - 移除服务权限
pub async fn remove_user_service(
    State(state): State<AppState>,
    RequireAdmin(auth): RequireAdmin,
    Path((user_id, service_id)): Path<(String, String)>,
) -> Result<Json<UserSummary>, ApiError> {
    forbid_devtoken_target(&user_id)?;
    // 非超管只能收回自己权限范围内的服务
    ensure_service_ids_in_scope(&auth, &[service_id.clone()])?;
    let user = state
        .user_manager
        .remove_service_permission(&user_id, &service_id)
        .await?;
    let summary: UserSummary = user.into();
    Ok(Json(summary))
}

/// 修改密码请求
#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub new_password: String,
    #[serde(default)]
    pub current_password: Option<String>,
}

/// POST /users/:id/password - 修改用户密码（管理员或本人）
pub async fn change_password(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<Json<UserSummary>, ApiError> {
    // 限流检查（按用户 ID，防止暴力破解当前密码）
    if !state.password_limiter.allow(&id).await {
        tracing::warn!("修改密码限流: UserID={}", id);
        return Err(ApiError::too_many_requests(
            "请求过于频繁，请稍后再试",
        ));
    }

    // 密码强度验证由 core 层 UserManager::change_password 执行
    // is_admin() 含系统管理员，可代改他人密码
    let is_admin = auth.is_admin();
    let is_self = auth.claims.sub == id;
    if !is_admin && !is_self {
        return Err(ApiError::forbidden(
            "你不能更改其他人的密码",
        ));
    }
    if is_admin && !is_self {
        forbid_devtoken_target(&id)?;
    }

    let user = state
        .user_manager
        .change_password(
            &id,
            req.current_password.as_deref(),
            &req.new_password,
            is_admin,
        )
        .await?;
    let summary: UserSummary = user.into();
    Ok(Json(summary))
}
