//! 双因素认证 API 处理器
//!
//! @author sky

use axum::extract::State;
use axum::http::StatusCode;
use axum::{Extension, Json};
use hypercraft_core::{Disable2FARequest, Enable2FARequest, Setup2FARequest};
use serde_json::{json, Value};

use super::super::error::ApiError;
use super::super::middleware::AuthInfo;
use super::super::state::AppState;

/// 验证用户的 2FA（如果启用）
///
/// 返回：
/// - Ok(()) - 2FA 验证通过或未启用
/// - Err(ApiError::2FA_REQUIRED) - 需要 2FA 但未提供验证码
/// - Err(ApiError::Unauthorized) - 2FA 验证码错误
pub async fn verify_user_2fa(
    state: &AppState,
    user_id: &str,
    totp_code: Option<&str>,
) -> Result<(), ApiError> {
    // 查找用户
    let user = match state.user_manager.find_by_username(user_id).await {
        Ok(Some(u)) => u,
        Ok(None) => return Ok(()), // 用户不存在，不验证 2FA
        Err(_) => return Ok(()),    // 查询失败，不验证 2FA
    };

    // 检查是否启用了 2FA
    if let Some(totp_cfg) = &user.totp_config {
        if totp_cfg.enabled {
            // 需要 2FA，检查是否提供了验证码
            let code = totp_code.ok_or_else(|| {
                ApiError::new("2FA_REQUIRED", StatusCode::UNAUTHORIZED, "请输入双因素认证码")
            })?;

            // 验证 TOTP 码
            if !state
                .user_manager
                .verify_totp(&user, code)
                .await
                .unwrap_or(false)
            {
                return Err(ApiError::unauthorized_with_message("双因素认证码错误"));
            }
        }
    }

    Ok(())
}

/// POST /auth/2fa/setup - 生成 TOTP secret 和 QR 码
pub async fn setup_2fa(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Json(_req): Json<Setup2FARequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let response = state.user_manager.setup_2fa(&auth.claims.sub).await?;

    Ok((StatusCode::OK, Json(json!(response))))
}

/// POST /auth/2fa/enable - 验证并启用 2FA
pub async fn enable_2fa(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Json(req): Json<Enable2FARequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    state
        .user_manager
        .enable_2fa(
            &auth.claims.sub,
            &req.totp_code,
            &req.secret,
            &req.recovery_codes,
        )
        .await?;

    Ok((StatusCode::OK, Json(json!({"success": true}))))
}

/// POST /auth/2fa/disable - 禁用 2FA
pub async fn disable_2fa(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Json(req): Json<Disable2FARequest>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    state
        .user_manager
        .disable_2fa(&auth.claims.sub, &req.verification)
        .await?;

    Ok((StatusCode::OK, Json(json!({"success": true}))))
}
