use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Serialize;

use crate::app::middleware::ServicePermission;
use crate::app::web_gateway::{
    build_gateway_url, detect_request_scheme, validate_gateway_upstream,
};
use crate::app::{ApiError, AppState};

#[derive(Debug, Serialize)]
pub struct WebSessionResponse {
    pub url: String,
}

/// 为浏览器 tab 创建一个单服务 Web 会话。
pub async fn create_web_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    ServicePermission { service_id, auth }: ServicePermission,
) -> Result<Json<WebSessionResponse>, ApiError> {
    let manifest = state.manager.load_manifest(&service_id).await?;
    let web = manifest
        .web
        .as_ref()
        .filter(|web| web.enabled)
        .ok_or_else(|| ApiError::bad_request("service web gateway is not enabled"))?;
    if web.upstream.trim().is_empty() {
        return Err(ApiError::bad_request("service web upstream is empty"));
    }
    if let Err(message) = validate_gateway_upstream(&web.upstream, state.api_bind) {
        return Err(ApiError::bad_request(message));
    }

    let base_domain = state.web_gateway_base_domain.clone().ok_or_else(|| {
        ApiError::new(
            "ServiceUnavailable",
            StatusCode::SERVICE_UNAVAILABLE,
            "web gateway base domain is not configured",
        )
    })?;
    let scheme = detect_request_scheme(&headers);
    let session_token = state
        .user_manager
        .issue_web_token(&auth.claims, &service_id, state.web_proxy_session_ttl)
        .map_err(ApiError::from)?;

    Ok(Json(WebSessionResponse {
        url: build_gateway_url(&service_id, &scheme, &base_domain, &session_token),
    }))
}
