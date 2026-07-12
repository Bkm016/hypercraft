//! 认证相关 API handlers

use axum::extract::{ConnectInfo, State};
use axum::http::header::{HeaderMap, HeaderValue, SET_COOKIE};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use hypercraft_core::{AuthToken, DevTokenLoginRequest, LoginRequest, RefreshRequest, UserSummary};
use serde_json::json;
use std::net::SocketAddr;

use super::super::error::ApiError;
use super::super::middleware::{
    extract_cookie_value, AuthInfo, ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE,
    CSRF_HEADER,
};
use super::super::state::AppState;
use super::verify_user_2fa;

/// 根据请求 Origin 判断是否应下发 Secure cookie（不信任代理头）
fn cookie_secure(headers: &HeaderMap) -> bool {
    if let Some(origin) = headers
        .get(axum::http::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
    {
        return origin.starts_with("https://");
    }
    if let Some(referer) = headers
        .get(axum::http::header::REFERER)
        .and_then(|v| v.to_str().ok())
    {
        return referer.starts_with("https://");
    }
    false
}

fn build_auth_cookie(name: &str, value: &str, max_age: i64, secure: bool) -> String {
    if secure {
        // 跨站 HTTPS 前端需要 SameSite=None + Secure，才能在 credentialed 请求中携带会话
        format!(
            "{}={}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age={}",
            name, value, max_age
        )
    } else {
        format!(
            "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
            name, value, max_age
        )
    }
}

fn clear_auth_cookie(name: &str, secure: bool) -> String {
    if secure {
        format!(
            "{}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0",
            name
        )
    } else {
        format!("{}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0", name)
    }
}

fn append_set_cookie(response: &mut Response, cookie: String) {
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().append(SET_COOKIE, value);
    }
}

/// 登录/刷新成功后附带 HttpOnly 会话 cookie；JSON body 仍返回 token 以兼容 CLI Bearer。
fn auth_token_response(
    auth_token: AuthToken,
    access_ttl: i64,
    refresh_ttl: i64,
    secure: bool,
) -> Response {
    let access_cookie = build_auth_cookie(
        ACCESS_TOKEN_COOKIE,
        &auth_token.access_token,
        access_ttl,
        secure,
    );
    let refresh_cookie = build_auth_cookie(
        REFRESH_TOKEN_COOKIE,
        &auth_token.refresh_token,
        refresh_ttl,
        secure,
    );

    let mut response = (StatusCode::OK, Json(json!(auth_token))).into_response();
    append_set_cookie(&mut response, access_cookie);
    append_set_cookie(&mut response, refresh_cookie);
    response
}

/// POST /auth/login - 用户登录
pub async fn login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<Response, ApiError> {
    let ip = addr.ip().to_string();
    tracing::info!("登录请求: 用户={}, IP={}", req.username, ip);

    if !state.login_limiter.allow(&ip).await {
        tracing::warn!("登录限流: 用户={}, IP={}", req.username, ip);
        return Err(ApiError::too_many_requests("请求过于频繁，请稍后再试"));
    }

    let result = state
        .user_manager
        .login(&req.username, &req.password, req.totp_code.as_deref())
        .await;

    match &result {
        Ok(_) => tracing::info!("登录成功: 用户={}, IP={}", req.username, ip),
        Err(e) => tracing::warn!(
            "登录失败: 用户={}, IP={}, 错误={}",
            req.username,
            ip,
            e
        ),
    }

    let auth_token = result?;
    Ok(auth_token_response(
        auth_token,
        state.user_manager.access_token_ttl(),
        state.user_manager.refresh_token_ttl(),
        cookie_secure(&headers),
    ))
}

/// POST /auth/devtoken - DevToken 登录
pub async fn devtoken_login(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<DevTokenLoginRequest>,
) -> Result<Response, ApiError> {
    let ip = addr.ip().to_string();
    tracing::info!("DevToken 登录请求: IP={}", ip);

    if !state.login_limiter.allow(&ip).await {
        tracing::warn!("DevToken 登录限流: IP={}", ip);
        return Err(ApiError::too_many_requests("请求过于频繁，请稍后再试"));
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
    let auth_token = state.user_manager.issue_dev_token().await.map_err(|e| {
        tracing::error!("DevToken 签发失败: IP={}, 错误={}", ip, e);
        ApiError::new(
            "INTERNAL_ERROR",
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("签发 Token 失败: {}", e),
        )
    })?;

    tracing::info!("DevToken 登录成功: IP={}", ip);
    Ok(auth_token_response(
        auth_token,
        state.user_manager.access_token_ttl(),
        state.user_manager.refresh_token_ttl(),
        cookie_secure(&headers),
    ))
}

/// POST /auth/refresh - 刷新 token
pub async fn refresh(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<RefreshRequest>,
) -> Result<Response, ApiError> {
    let ip = addr.ip().to_string();
    if !state.refresh_limiter.allow(&ip).await {
        tracing::warn!("刷新限流: IP={}", ip);
        return Err(ApiError::too_many_requests("请求过于频繁，请稍后再试"));
    }

    // JSON body 优先（CLI）；浏览器可仅依赖 HttpOnly refresh cookie
    let body_refresh_token = req.refresh_token.filter(|s| !s.is_empty());
    if body_refresh_token.is_none() && headers.get(CSRF_HEADER).is_none() {
        return Err(ApiError::forbidden("missing CSRF protection header"));
    }
    let refresh_token = body_refresh_token
        .or_else(|| extract_cookie_value(&headers, REFRESH_TOKEN_COOKIE))
        .ok_or_else(|| ApiError::unauthorized_with_message("缺少 refresh token"))?;

    let auth_token = state.user_manager.refresh(&refresh_token).await?;

    Ok(auth_token_response(
        auth_token,
        state.user_manager.access_token_ttl(),
        state.user_manager.refresh_token_ttl(),
        cookie_secure(&headers),
    ))
}

/// POST /auth/logout - 清除浏览器会话 cookie
pub async fn logout(headers: HeaderMap) -> Response {
    if headers.get(CSRF_HEADER).is_none() {
        return ApiError::forbidden("missing CSRF protection header").into_response();
    }
    let secure = cookie_secure(&headers);
    let mut response = (StatusCode::OK, Json(json!({ "success": true }))).into_response();
    append_set_cookie(
        &mut response,
        clear_auth_cookie(ACCESS_TOKEN_COOKIE, secure),
    );
    append_set_cookie(
        &mut response,
        clear_auth_cookie(REFRESH_TOKEN_COOKIE, secure),
    );
    // 兼容同时存在 Secure/非 Secure 两套 cookie 的清理
    if secure {
        append_set_cookie(
            &mut response,
            clear_auth_cookie(ACCESS_TOKEN_COOKIE, false),
        );
        append_set_cookie(
            &mut response,
            clear_auth_cookie(REFRESH_TOKEN_COOKIE, false),
        );
    }
    response
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
            use chrono::Utc;
            use hypercraft_core::user::User;

            User {
                id: "__devtoken__".to_string(),
                username: "DevToken".to_string(),
                password_hash: String::new(),
                service_ids: vec![],
                is_admin: true,
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
