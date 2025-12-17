//! 认证相关 API handlers

use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use hypercraft_core::{DevTokenLoginRequest, LoginRequest, RefreshRequest, UserSummary};
use serde_json::{json, Value};
use std::net::SocketAddr;

use super::super::error::ApiError;
use super::super::middleware::AuthInfo;
use super::super::state::AppState;
use super::verify_user_2fa;

/// POST /auth/login - 用户登录
pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<LoginRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ip = addr.ip().to_string();
    tracing::info!("登录请求: 用户={}, IP={}", req.username, ip);
    
    if !state.login_limiter.allow(&ip).await {
        tracing::warn!("登录限流: 用户={}, IP={}", req.username, ip);
        return Err(ApiError::too_many_requests(
            "请求过于频繁，请稍后再试",
        ));
    }

    let result = state
        .user_manager
        .login(&req.username, &req.password, req.totp_code.as_deref())
        .await;

    match &result {
        Ok(_) => tracing::info!("登录成功: 用户={}, IP={}", req.username, ip),
        Err(e) => tracing::warn!("登录失败: 用户={}, IP={}, 错误={}", req.username, ip, e),
    }

    let auth_token = result?;
    Ok((StatusCode::OK, Json(json!(auth_token))))
}

/// POST /auth/devtoken - DevToken 登录
pub async fn devtoken_login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<DevTokenLoginRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ip = addr.ip().to_string();
    tracing::info!("DevToken 登录请求: IP={}", ip);
    
    if !state.login_limiter.allow(&ip).await {
        tracing::warn!("DevToken 登录限流: IP={}", ip);
        return Err(ApiError::too_many_requests(
            "请求过于频繁，请稍后再试",
        ));
    }

    // 验证 DevToken
    let dev_token = state
        .dev_token
        .as_ref()
        .ok_or_else(|| ApiError::unauthorized_with_message("未启用 DevToken"))?;

    if &req.dev_token != dev_token {
        tracing::warn!("DevToken 登录失败: 无效的 token, IP={}", ip);
        return Err(ApiError::unauthorized_with_message("无效的 DevToken"));
    }

    // 验证 2FA（如果启用）
    if let Err(e) = verify_user_2fa(&state, "__devtoken__", req.totp_code.as_deref()).await {
        tracing::warn!("DevToken 登录失败: 2FA 验证失败, IP={}", ip);
        return Err(e);
    }

    // 签发 JWT token（使用虚拟 dev 用户）
    let auth_token = state
        .user_manager
        .issue_dev_token()
        .await
        .map_err(|e| {
            tracing::error!("DevToken 签发失败: IP={}, 错误={}", ip, e);
            ApiError::new(
                "INTERNAL_ERROR",
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("签发 Token 失败: {}", e),
            )
        })?;

    tracing::info!("DevToken 登录成功: IP={}", ip);
    Ok((StatusCode::OK, Json(json!(auth_token))))
}

/// POST /auth/refresh - 刷新 token
pub async fn refresh(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<RefreshRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ip = addr.ip().to_string();
    if !state.refresh_limiter.allow(&ip).await {
        tracing::warn!("刷新限流: IP={}", ip);
        return Err(ApiError::too_many_requests(
            "请求过于频繁，请稍后再试",
        ));
    }

    let auth_token = state.user_manager.refresh(&req.refresh_token).await?;

    Ok((StatusCode::OK, Json(json!(auth_token))))
}

/// GET /auth/me - 获取当前用户信息
pub async fn get_me(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
) -> Result<Json<UserSummary>, ApiError> {
    // 获取用户信息，如果是 DevToken 且不存在，返回默认信息
    let user = match state.user_manager.get_user(&auth.claims.sub).await {
        Ok(user) => user,
        Err(_) if auth.claims.sub == "__devtoken__" => {
            // DevToken 用户不存在时返回默认信息
            use hypercraft_core::user::User;
            use chrono::Utc;

            User {
                id: "__devtoken__".to_string(),
                username: "DevToken".to_string(),
                password_hash: String::new(),
                service_ids: vec![],
                token_version: 0,
                refresh_nonce: String::new(),
                totp_config: None,
                created_at: Some(Utc::now()),
                updated_at: Some(Utc::now()),
            }
        }
        Err(e) => return Err(e.into()),
    };

    let summary: UserSummary = user.into();
    Ok(Json(summary))
}
