use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::sse::{Event, KeepAlive};
use axum::response::{IntoResponse, Response, Sse};
use axum::Extension;
use axum::Json;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures::stream::StreamExt;
use serde::Deserialize;
use serde_json::json;
use std::convert::Infallible;
use std::time::Duration;
use tracing::instrument;

use crate::app::middleware::{AuthInfo, ServicePermission};
use crate::app::{ApiError, AppState};

#[derive(Debug, Deserialize)]
pub struct LogQuery {
    /// 返回的字节数（用于 raw 模式）或行数
    pub tail: Option<usize>,
    /// 是否实时跟随
    pub follow: Option<bool>,
}

#[instrument(skip_all)]
pub async fn get_logs(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Query(query): Query<LogQuery>,
) -> Result<Response, ApiError> {
    // 权限检查（需要同时访问 Path 和 Query，无法使用 ServicePermission extractor）
    if !auth.can_access_service(&id) {
        return Err(ApiError::forbidden(format!(
            "no permission to access service: {}",
            id
        )));
    }

    let follow = query.follow.unwrap_or(false);
    if follow {
        // 实时跟随：返回 base64 编码的原始数据流
        let service_id = id.clone();
        let stream = state
            .manager
            .follow_logs_raw(&id, Duration::from_millis(100))
            .await
            .map_err(ApiError::from)?
            .map(move |data_res| -> Result<Event, Infallible> {
                match data_res {
                    Ok(data) => {
                        // 用 base64 编码原始字节，避免 SSE 格式问题
                        let encoded = BASE64.encode(&data);
                        Ok(Event::default().data(encoded))
                    }
                    Err(err) => {
                        tracing::error!(service_id = %service_id, error = %err, "Error in log stream");
                        // 错误信息也用 base64 编码
                        let msg = format!("error: {}", err);
                        let encoded = BASE64.encode(msg.as_bytes());
                        Ok(Event::default().data(encoded))
                    }
                }
            });
        return Ok(Sse::new(stream)
            .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
            .into_response());
    }

    // 非实时：返回原始字节（base64 编码）
    let bytes = query.tail.unwrap_or(64 * 1024); // 默认 64KB
    let data = state.manager.tail_logs_raw(&id, bytes)?;
    let encoded = BASE64.encode(&data);
    Ok(Json(json!({ "id": id, "data": encoded })).into_response())
}

/// 下载服务配置的日志文件
#[instrument(skip_all)]
pub async fn download_log_file(
    State(state): State<AppState>,
    ServicePermission { service_id, .. }: ServicePermission,
) -> Result<Response, ApiError> {
    tracing::info!(service_id = %service_id, "download_log_file called");

    // 获取服务 manifest
    let manifest = state
        .manager
        .load_manifest(&service_id)
        .await
        .map_err(|e| {
            tracing::error!(service_id = %service_id, error = %e, "failed to load manifest");
            ApiError::from(e)
        })?;

    // 检查是否配置了日志路径
    let log_path = manifest
        .log_path
        .as_ref()
        .ok_or_else(|| {
            tracing::warn!(service_id = %service_id, "service has no log_path configured");
            ApiError::bad_request("service has no log_path configured")
        })?;

    tracing::info!(service_id = %service_id, log_path = %log_path, "reading log file");

    // 读取日志文件内容
    let content = tokio::fs::read(log_path).await.map_err(|e| {
        tracing::error!(service_id = %service_id, log_path = %log_path, error = %e, "failed to read log file");
        ApiError::new(
            "IoError",
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to read log file '{}': {}", log_path, e),
        )
    })?;

    // 获取文件名用于下载
    let filename = std::path::Path::new(log_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("service.log");

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename),
        )
        .body(Body::from(content))
        .unwrap())
}
