use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;

use axum::body::Body;
use axum::extract::{ConnectInfo, FromRequestParts, Path, State};
use axum::http::request::Parts;
use axum::http::Request;
use axum::middleware::Next;
use axum::response::Response;
use hypercraft_core::{API_KEY_RAW_PREFIX, TokenClaims, TokenType};

use super::error::ApiError;
use super::state::AppState;
use super::web_gateway::{extract_gateway_service_id, handle_web_gateway_request, request_host};

/// 认证信息扩展
#[derive(Debug, Clone)]
pub struct AuthInfo {
	pub claims: TokenClaims,
	/// JWT 为 None（沿用角色能力）；API Key 为 Some(scopes)
	pub scopes: Option<Vec<String>>,
}

impl AuthInfo {
	/// 从 JWT claims 构造（无 scope 裁剪）
	pub fn from_claims(claims: TokenClaims) -> Self {
		Self {
			claims,
			scopes: None,
		}
	}

	/// 从 API Key 合成 claims + scopes
	pub fn from_api_key(claims: TokenClaims, scopes: Vec<String>) -> Self {
		Self {
			claims,
			scopes: Some(scopes),
		}
	}

	/// 检查是否是超级管理员（仅 __devtoken__）
	pub fn is_super_admin(&self) -> bool {
		self.claims.sub == "__devtoken__"
	}

	/// 检查是否是管理员（超管或系统管理员）
	pub fn is_admin(&self) -> bool {
		self.is_super_admin() || self.claims.is_admin
	}

	/// 是否为 API Key 身份
	pub fn is_api_key(&self) -> bool {
		matches!(self.claims.token_type, TokenType::ApiKey)
	}

	/// 检查 scope：JWT 无 scopes 限制；API Key 必须显式拥有
	pub fn has_scope(&self, scope: &str) -> bool {
		match &self.scopes {
			None => true,
			Some(list) => list.iter().any(|s| s == scope),
		}
	}

	/// 缺少 scope 时返回 Forbidden
	pub fn require_scope(&self, scope: &str) -> Result<(), ApiError> {
		if self.has_scope(scope) {
			Ok(())
		} else {
			Err(ApiError::forbidden(format!("缺少权限 scope: {}", scope)))
		}
	}

	/// 检查是否有权限访问指定服务（仅超管全量旁路）
	pub fn can_access_service(&self, service_id: &str) -> bool {
		if self.is_super_admin() {
			return true;
		}
		match self.claims.token_type {
			TokenType::User | TokenType::ApiKey => {
				self.claims.service_ids.contains(&service_id.to_string())
			}
			TokenType::Web => self.claims.service_id.as_deref() == Some(service_id),
			_ => false,
		}
	}
}

/// 要求管理员权限的 Extractor（超管或系统管理员）
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

			// API Key 永远不能走管理员接口
			if auth.is_api_key() || !auth.is_admin() {
				return Err(ApiError::forbidden("admin access required"));
			}
			Ok(RequireAdmin(auth))
		})
	}
}

/// 要求超级管理员权限的 Extractor（仅 __devtoken__）
#[derive(Debug, Clone)]
pub struct RequireSuperAdmin(#[allow(dead_code)] pub AuthInfo);

impl<S: Send + Sync> FromRequestParts<S> for RequireSuperAdmin {
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

			if !auth.is_super_admin() {
				return Err(ApiError::forbidden("super admin access required"));
			}
			Ok(RequireSuperAdmin(auth))
		})
	}
}

/// 服务权限检查 Extractor - 从路径参数 :id 提取服务 ID 并验证权限
#[derive(Debug, Clone)]
pub struct ServicePermission {
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
const PUBLIC_PATHS: &[&str] = &[
	"/health",
	"/auth/login",
	"/auth/devtoken",
	"/auth/refresh",
	"/auth/logout",
];

/// 浏览器会话 access cookie（HttpOnly，由登录/刷新接口下发）
pub const ACCESS_TOKEN_COOKIE: &str = "hc_access_token";

/// 浏览器会话 refresh cookie（HttpOnly，由登录/刷新接口下发）
pub const REFRESH_TOKEN_COOKIE: &str = "hc_refresh_token";

/// Cookie 会话执行状态变更请求时必须携带的 CSRF 防护头
pub const CSRF_HEADER: &str = "x-hypercraft-csrf";

/// 从 Cookie 头解析指定名称的值
pub fn extract_cookie_value(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
	let cookie = headers
		.get(axum::http::header::COOKIE)
		.and_then(|v| v.to_str().ok())?;
	cookie.split(';').find_map(|part| {
		let (key, value) = part.trim().split_once('=')?;
		if key == name {
			Some(value.to_string())
		} else {
			None
		}
	})
}

/// 从请求中提取 token（Bearer > query token > access cookie）
fn extract_token(request: &Request<Body>) -> Option<(String, bool)> {
	// 优先从 Authorization header 获取（CLI / API Key / 兼容旧前端）
	if let Some(token) = request
		.headers()
		.get(axum::http::header::AUTHORIZATION)
		.and_then(|v| v.to_str().ok())
		.and_then(|v| v.strip_prefix("Bearer "))
	{
		return Some((token.to_string(), false));
	}

	// fallback 到 query param（旧 WebSocket 场景；新前端依赖 cookie）
	if let Some(token) = request.uri().query().and_then(|query| {
		query.split('&').find_map(|pair| {
			let (key, value) = pair.split_once('=')?;
			if key == "token" {
				urlencoding::decode(value).ok().map(|s| s.into_owned())
			} else {
				None
			}
		})
	}) {
		return Some((token, false));
	}

	// 浏览器会话：HttpOnly cookie（WebSocket 握手会自动带上）
	extract_cookie_value(request.headers(), ACCESS_TOKEN_COOKIE).map(|token| (token, true))
}

/// Cookie 是浏览器自动携带的环境凭据，状态变更必须要求脚本主动添加自定义头。
fn requires_csrf_header(request: &Request<Body>) -> bool {
	!matches!(
		*request.method(),
		axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
	)
}

/// 从请求中提取客户端 IP
/// 仅使用直连 socket 地址，不信任客户端可控的代理头，避免限流被伪造绕过。
fn extract_client_ip(request: &Request<Body>) -> String {
	request
		.extensions()
		.get::<ConnectInfo<SocketAddr>>()
		.map(|ci| ci.0.ip().to_string())
		.unwrap_or_else(|| "unknown".to_string())
}

/// 认证失败时记入限流并返回 Unauthorized
async fn reject_auth(state: &AppState, client_ip: &str, path: &str, reason: &str) -> ApiError {
	if !state.auth_limiter.allow(client_ip).await {
		tracing::warn!(
			"认证限流触发: IP={}, 路径={} ({})",
			client_ip,
			path,
			reason
		);
		return ApiError::too_many_requests("请求过于频繁，请稍后再试");
	}
	ApiError::unauthorized()
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
	let (token, cookie_auth) = match extract_token(&request) {
		Some(value) => value,
		None => {
			return Err(reject_auth(&state, &client_ip, &path, "无token").await);
		}
	};
	if cookie_auth
		&& requires_csrf_header(&request)
		&& request.headers().get(CSRF_HEADER).is_none()
	{
		return Err(ApiError::forbidden("missing CSRF protection header"));
	}

	// 长期 API Key 优先识别
	if token.starts_with(API_KEY_RAW_PREFIX) {
		let (claims, scopes) = match state.user_manager.verify_api_key(&token).await {
			Ok(v) => v,
			Err(_) => {
				return Err(reject_auth(&state, &client_ip, &path, "api key无效").await);
			}
		};
		request
			.extensions_mut()
			.insert(AuthInfo::from_api_key(claims, scopes));
		return Ok(next.run(request).await);
	}

	// JWT 校验
	let claims = match state.user_manager.verify_token(&token).await {
		Ok(c) => c,
		Err(_) => {
			return Err(reject_auth(&state, &client_ip, &path, "token无效").await);
		}
	};

	if matches!(claims.token_type, TokenType::Refresh | TokenType::Web) {
		return Err(ApiError::unauthorized_with_message(
			"this token cannot be used for API access",
		));
	}

	request
		.extensions_mut()
		.insert(AuthInfo::from_claims(claims));
	Ok(next.run(request).await)
}

pub async fn web_gateway_middleware(
	State(state): State<AppState>,
	request: Request<Body>,
	next: Next,
) -> Response {
	let Some(base_domain) = state.web_gateway_base_domain.as_deref() else {
		return next.run(request).await;
	};
	let Some(host) = request_host(request.headers()) else {
		return next.run(request).await;
	};
	let Some(service_id) = extract_gateway_service_id(&host, base_domain) else {
		return next.run(request).await;
	};
	handle_web_gateway_request(&state, request, service_id).await
}
