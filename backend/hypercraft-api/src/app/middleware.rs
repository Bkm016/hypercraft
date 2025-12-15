use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;

use axum::body::Body;
use axum::extract::{ConnectInfo, FromRequestParts, Path, State};
use axum::http::request::Parts;
use axum::http::Request;
use axum::middleware::Next;
use axum::response::Response;
use hypercraft_core::{TokenClaims, TokenType, UserManager};
use subtle::ConstantTimeEq;

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
				.map_err(|_| ApiError::bad_request("missing service id in path"))?;

			if !auth.can_access_service(&service_id) {
				return Err(ApiError::forbidden(format!(
					"no permission to access service: {}",
					service_id
				)));
			}
			Ok(ServicePermission { auth, service_id })
		})
	}
}

/// 不需要认证的路径
const PUBLIC_PATHS: &[&str] = &["/health", "/auth/login", "/auth/refresh"];

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
fn extract_client_ip(request: &Request<Body>) -> String {
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

	// 检查该 IP 是否因认证失败过多而被封禁
	if !state.auth_limiter.check(&client_ip).await {
		return Err(ApiError::too_many_requests(
			"too many authentication failures, try again later",
		));
	}

	let token = match extract_token(&request) {
		Some(t) => t,
		None => {
			// 记录认证失败
			state.auth_limiter.record(&client_ip).await;
			return Err(ApiError::unauthorized());
		}
	};

	// 首先检查是否是 DevToken（使用常量时间比较防止时序攻击）
	if let Some(ref dev_token) = state.dev_token {
		if token.as_bytes().ct_eq(dev_token.as_bytes()).into() {
			let auth_info = AuthInfo {
				claims: UserManager::dev_token_claims(),
			};
			request.extensions_mut().insert(auth_info);
			return Ok(next.run(request).await);
		}
		// DevToken 配置了但不匹配，记录失败（可能是暴力破解尝试）
		state.auth_limiter.record(&client_ip).await;
	}

	// 尝试验证为 JWT UserToken
	let claims = match state.user_manager.verify_token(&token).await {
		Ok(c) => c,
		Err(_) => {
			// JWT 验证失败，记录（如果前面没有 DevToken 配置）
			if state.dev_token.is_none() {
				state.auth_limiter.record(&client_ip).await;
			}
			return Err(ApiError::unauthorized());
		}
	};

	if claims.token_type == TokenType::Refresh {
		return Err(ApiError::unauthorized_with_message(
			"refresh token cannot be used for API access",
		));
	}

	let auth_info = AuthInfo { claims };
	request.extensions_mut().insert(auth_info);
	Ok(next.run(request).await)
}
