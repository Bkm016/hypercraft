use axum::extract::ConnectInfo;
use axum::http::{StatusCode, Uri};
use axum::Json;
use serde_json::json;
use std::net::SocketAddr;

pub async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}

/// 处理 404 错误，记录可疑请求
pub async fn handler_404(
    uri: Uri,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> (StatusCode, Json<serde_json::Value>) {
    let path = uri.path();
    let ip = addr.ip().to_string();
    
    // 记录所有 404 请求
    tracing::warn!("404 请求: path={}, IP={}", path, ip);
    
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": "NOT_FOUND",
            "message": "请求的资源不存在"
        })),
    )
}
