use axum::body::Body;
use axum::extract::State;
use axum::http::Request;
use axum::middleware::Next;
use axum::response::Response;
use hypercraft_core::{TokenClaims, TokenType, UserManager};

use super::error::ApiError;
use super::state::AppState;

/// 认证信息扩展
#[derive(Debug, Clone)]
pub struct AuthInfo {
    pub claims: TokenClaims,
}

impl AuthInfo {
    /// 检查是否是管理员
    pub fn is_admin(&self) -> bool {
        self.claims.token_type == TokenType::Dev
    }

    /// 检查是否有权限访问指定服务
    pub fn can_access_service(&self, service_id: &str) -> bool {
        match self.claims.token_type {
            TokenType::Dev => true,
            TokenType::User => self.claims.service_ids.contains(&service_id.to_string()),
            TokenType::Refresh => false,
        }
    }
}

/// 不需要认证的路径
const PUBLIC_PATHS: &[&str] = &["/health", "/auth/login", "/auth/refresh"];

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Result<Response, ApiError> {
    let path = request.uri().path().to_string();

    // 公开端点不需要认证
    if PUBLIC_PATHS.iter().any(|p| path == *p) {
        return Ok(next.run(request).await);
    }

    // 获取 Authorization header
    let provided = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_string);

    // 如果 header 中没有 token，尝试从 URL 查询参数中获取
    // 这主要是为了支持浏览器 WebSocket（不支持自定义 headers）
    let token = match provided {
        Some(t) => t,
        None => {
            // 从 URL 查询参数中获取 token
            request
                .uri()
                .query()
                .and_then(|query| {
                    query.split('&').find_map(|pair| {
                        let mut parts = pair.splitn(2, '=');
                        let key = parts.next()?;
                        let value = parts.next()?;
                        if key == "token" {
                            // URL 解码
                            urlencoding::decode(value).ok().map(|s| s.into_owned())
                        } else {
                            None
                        }
                    })
                })
                .ok_or_else(ApiError::unauthorized)?
        }
    };

    // 首先检查是否是 DevToken
    if let Some(ref dev_token) = state.dev_token {
        if &token == dev_token {
            // DevToken 认证成功，注入管理员身份
            let auth_info = AuthInfo {
                claims: UserManager::dev_token_claims(),
            };
            request.extensions_mut().insert(auth_info);
            return Ok(next.run(request).await);
        }
    }

    // 尝试验证为 JWT UserToken
    match state.user_manager.verify_token(&token).await {
        Ok(claims) => {
            // 检查 token 类型
            if claims.token_type == TokenType::Refresh {
                return Err(ApiError::unauthorized_with_message(
                    "refresh token cannot be used for API access",
                ));
            }

            let auth_info = AuthInfo { claims };
            request.extensions_mut().insert(auth_info);
            Ok(next.run(request).await)
        }
        Err(_) => Err(ApiError::unauthorized()),
    }
}

/// 要求管理员权限的中间件
pub async fn require_admin(
    State(_state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, ApiError> {
    let auth_info = request
        .extensions()
        .get::<AuthInfo>()
        .ok_or_else(ApiError::unauthorized)?;

    if !auth_info.is_admin() {
        return Err(ApiError::forbidden("admin access required"));
    }

    Ok(next.run(request).await)
}
