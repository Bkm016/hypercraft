//! 认证相关 API handlers

use axum::extract::{ConnectInfo, State};
use axum::http::StatusCode;
use axum::Json;
use hypercraft_core::{LoginRequest, RefreshRequest};
use serde_json::{json, Value};
use std::net::SocketAddr;

use super::super::error::ApiError;
use super::super::state::AppState;

/// POST /auth/login - 用户登录
pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(req): Json<LoginRequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let ip = addr.ip().to_string();
    if !state.login_limiter.allow(&ip).await {
        return Err(ApiError::too_many_requests(
            "too many login attempts, try again later",
        ));
    }

    let auth_token = state
        .user_manager
        .login(&req.username, &req.password)
        .await?;

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
        return Err(ApiError::too_many_requests(
            "too many refresh requests, slow down",
        ));
    }

    let auth_token = state.user_manager.refresh(&req.refresh_token).await?;

    Ok((StatusCode::OK, Json(json!(auth_token))))
}
