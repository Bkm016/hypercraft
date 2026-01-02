use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;

use axum::body::Body;
use axum::extract::{ConnectInfo, FromRequestParts, Path, State};
use axum::http::request::Parts;
use axum::http::Request;
use axum::middleware::Next;
use axum::response::Response;
use hypercraft_core::{TokenClaims, TokenType};

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
		self.claims.sub == "__devtoken__"
	}

	/// 检查是否有权限访问指定服务
	pub fn can_access_service(&self, service_id: &str) -> bool {
		if self.is_admin() {
			return true;
		}
		match self.claims.token_type {
			TokenType::User => self.claims.service_ids.contains(&service_id.to_string()),
			_ => false,
		}
	}
}

/// 要求管理员权限的 Extractor
#[derive(Debug, Clone)]
pub struct RequireAdmin(#[allow(dead_code)] pub AuthInfo);

impl<S: Send + Sync> FromRequestParts<S> for RequireAdmin {
	type Rejection = ApiError;

	fn from_request_parts<'a, 'b, 'c>(
		parts: &'a mut Parts,
		_state: &'b S,
	) -> Pin<Box<dyn Future<Output = Result<Self, Self::Rejection>> + Send + 'c>>
	where
		'a: 'c,
		'b: 'c,
	{
		Box::pin(async move {
			let auth = parts
				.extensions
				.get::<AuthInfo>()
				.cloned()
				.ok_or_else(ApiError::unauthorized)?;

			if !auth.is_admin() {
				return Err(ApiError::forbidden("admin access required"));
			}
			Ok(RequireAdmin(auth))
		})
	}
}

/// 服务权限检查 Extractor - 从路径参数 :id 提取服务 ID 并验证权限
#[derive(Debug, Clone)]
pub struct ServicePermission {
	#[allow(dead_code)]
	pub auth: AuthInfo,
	pub service_id: String,
}

impl<S: Send + Sync> FromRequestParts<S> for ServicePermission {
	type Rejection = ApiError;

	fn from_request_parts<'a, 'b, 'c>(
		parts: &'a mut Parts,
		state: &'b S,
	) -> Pin<Box<dyn Future<Output = Result<Self, Self::Rejection>> + Send + 'c>>
	where
		'a: 'c,
		'b: 'c,
	{
		Box::pin(async move {
			let auth = parts
				.extensions
				.get::<AuthInfo>()
				.cloned()
				.ok_or_else(ApiError::unauthorized)?;

			let Path(service_id) = Path::<String>::from_request_parts(parts, state)
				.await
				.map_err(|_| ApiError::bad_request("无效的服务"))?;

			if !auth.can_access_service(&service_id) {
				return Err(ApiError::forbidden(format!(
					"没有权限访问服务: {}",
					service_id
				)));
			}
			Ok(ServicePermission { auth, service_id })
		})
	}
}

/// 不需要认证的路径
const PUBLIC_PATHS: &[&str] = &["/health", "/auth/login", "/auth/devtoken", "/auth/refresh"];

/// 从请求中提取 token（优先 header，fallback 到 query param）
fn extract_token(request: &Request<Body>) -> Option<String> {
	// 优先从 Authorization header 获取
	if let Some(token) = request
		.headers()
		.get(axum::http::header::AUTHORIZATION)
		.and_then(|v| v.to_str().ok())
		.and_then(|v| v.strip_prefix("Bearer "))
	{
		return Some(token.to_string());
	}

	// fallback 到 query param（WebSocket 场景）
	request.uri().query().and_then(|query| {
		query.split('&').find_map(|pair| {
			let (key, value) = pair.split_once('=')?;
			if key == "token" {
				urlencoding::decode(value).ok().map(|s| s.into_owned())
			} else {
				None
			}
		})
	})
}

/// 从请求中提取客户端 IP
/// 优先级：X-Real-IP > X-Forwarded-For（第一个） > Socket Address
fn extract_client_ip(request: &Request<Body>) -> String {
	// 1. 优先从 X-Real-IP header 获取（Nginx 常用）
	if let Some(real_ip) = request
		.headers()
		.get("X-Real-IP")
		.and_then(|v| v.to_str().ok())
	{
		return real_ip.to_string();
	}

	// 2. 从 X-Forwarded-For 获取第一个 IP（最左边是真实客户端）
	if let Some(forwarded) = request
		.headers()
		.get("X-Forwarded-For")
		.and_then(|v| v.to_str().ok())
	{
		if let Some(first_ip) = forwarded.split(',').next().map(|s| s.trim()) {
			if !first_ip.is_empty() {
				return first_ip.to_string();
			}
		}
	}

	// 3. fallback 到直连 socket 地址
	request
		.extensions()
		.get::<ConnectInfo<SocketAddr>>()
		.map(|ci| ci.0.ip().to_string())
		.unwrap_or_else(|| "unknown".to_string())
}

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

	let client_ip = extract_client_ip(&request);
	let token = match extract_token(&request) {
		Some(t) => t,
		None => {
			// 无 token，检查并记录认证失败（使用 allow 原子化操作）
			if !state.auth_limiter.allow(&client_ip).await {
				tracing::warn!("认证限流触发: IP={}, 路径={} (无token)", client_ip, path);
				return Err(ApiError::too_many_requests(
					"请求过于频繁，请稍后再试",
				));
			}
			return Err(ApiError::unauthorized());
		}
	};

	// 尝试验证为 JWT UserToken
	let claims = match state.user_manager.verify_token(&token).await {
		Ok(c) => c, // ✅ 验证成功，直接返回 claims，后续会放行（不受 auth_limiter 影响）
		Err(_) => {
			// Token 验证失败，检查并记录认证失败（使用 allow 原子化操作）
			if !state.auth_limiter.allow(&client_ip).await {
				tracing::warn!("认证限流触发: IP={}, 路径={} (token无效)", client_ip, path);
				return Err(ApiError::too_many_requests(
					"请求过于频繁，请稍后再试",
				));
			}
			return Err(ApiError::unauthorized());
		}
	};

	if claims.token_type == TokenType::Refresh {
		return Err(ApiError::unauthorized_with_message(
			"refresh token cannot be used for API access",
		));
	}

	// JWT 验证成功，已认证用户不受限流限制，直接放行
	let auth_info = AuthInfo { claims };
	request.extensions_mut().insert(auth_info);
	Ok(next.run(request).await)
}
