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
use crate::app::rate_limit::StreamConcurrencyLimiter;
use crate::app::{ApiError, AppState};
use hypercraft_core::api_key_scopes;

/// 文本 tail 默认行数
const DEFAULT_TAIL_LINES: usize = 200;
/// 文本 tail 最大行数
const MAX_TAIL_LINES: usize = 5_000;
/// 原始字节 tail 默认大小
const DEFAULT_TAIL_BYTES: usize = 64 * 1024;
/// 原始字节 tail 上限（1 MiB）
const MAX_TAIL_BYTES: usize = 1024 * 1024;
/// 单条 SSE 日志流最长存活时间
const SSE_MAX_DURATION: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Deserialize)]
pub struct LogQuery {
    /// 返回的字节数（用于 raw 模式）或行数
    pub tail: Option<usize>,
    /// 是否实时跟随
    pub follow: Option<bool>,
    /// 输出格式：base64（默认，兼容 Web）或 text
    pub format: Option<String>,
}

#[instrument(skip_all)]
pub async fn get_logs(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Query(query): Query<LogQuery>,
) -> Result<Response, ApiError> {
    auth.require_scope(api_key_scopes::LOGS)?;
    // 权限检查（需要同时访问 Path 和 Query，无法使用 ServicePermission extractor）
    if !auth.can_access_service(&id) {
        return Err(ApiError::forbidden(format!(
            "没有权限访问服务: {}",
            id
        )));
    }

    let format = query.format.as_deref().unwrap_or("base64");
    let want_text = format.eq_ignore_ascii_case("text");

    let follow = query.follow.unwrap_or(false);
    if follow {
        let stream_key = format!("sse:{}:{}", auth.claims.sub, id);
        let permit = state.stream_limiter.try_acquire(stream_key).ok_or_else(|| {
            ApiError::too_many_requests("too many concurrent log streams for this service")
        })?;

        let service_id = id.clone();
        let as_text = want_text;
        let stream = state
            .manager
            .follow_logs_raw(&id, Duration::from_millis(100))
            .await
            .map_err(ApiError::from)?
            .map(move |data_res| -> Result<Event, Infallible> {
                match data_res {
                    Ok(data) => {
                        if as_text {
                            // Agent 友好：SSE 直接推纯文本
                            let text = String::from_utf8_lossy(&data).into_owned();
                            Ok(Event::default().data(text))
                        } else {
                            // Web 兼容：base64 编码原始字节
                            let encoded = BASE64.encode(&data);
                            Ok(Event::default().data(encoded))
                        }
                    }
                    Err(err) => {
                        tracing::error!(service_id = %service_id, error = %err, "Error in log stream");
                        let msg = format!("error: {}", err);
                        if as_text {
                            Ok(Event::default().data(msg))
                        } else {
                            let encoded = BASE64.encode(msg.as_bytes());
                            Ok(Event::default().data(encoded))
                        }
                    }
                }
            })
            // 最长存活时间到后结束流，释放连接与 permit
            .take_until(tokio::time::sleep(SSE_MAX_DURATION));

        let guarded = StreamConcurrencyLimiter::guard_stream(stream, permit);
        return Ok(Sse::new(guarded)
            .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
            .into_response());
    }

    if want_text {
        // Agent 友好：按行 tail，纯文本
        let lines = clamp_tail_lines(query.tail);
        let text_lines = state.manager.tail_logs(&id, lines)?;
        let body = text_lines.join("\n");
        return Ok(Response::builder()
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Body::from(body))
            .unwrap());
    }

    // 非实时：返回原始字节（base64 编码）
    let bytes = clamp_tail_bytes(query.tail);
    let data = state.manager.tail_logs_raw(&id, bytes)?;
    let encoded = BASE64.encode(&data);
    Ok(Json(json!({ "id": id, "data": encoded })).into_response())
}

/// 下载服务配置的日志文件
#[instrument(skip_all)]
pub async fn download_log_file(
    State(state): State<AppState>,
    ServicePermission { auth, service_id }: ServicePermission,
) -> Result<Response, ApiError> {
    auth.require_scope(api_key_scopes::LOGS)?;
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
        tracing::error!(service_id = %service_id, log_path = %log_path, error = %e, "无法读取日志文件");
        ApiError::new(
            "IoError",
            StatusCode::INTERNAL_SERVER_ERROR,
            "无法读取日志文件".to_string(),
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

fn clamp_tail_lines(tail: Option<usize>) -> usize {
    tail.unwrap_or(DEFAULT_TAIL_LINES).min(MAX_TAIL_LINES)
}

fn clamp_tail_bytes(tail: Option<usize>) -> usize {
    tail.unwrap_or(DEFAULT_TAIL_BYTES).min(MAX_TAIL_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_lines_are_clamped() {
        assert_eq!(clamp_tail_lines(None), DEFAULT_TAIL_LINES);
        assert_eq!(clamp_tail_lines(Some(10)), 10);
        assert_eq!(clamp_tail_lines(Some(MAX_TAIL_LINES + 100)), MAX_TAIL_LINES);
        assert_eq!(clamp_tail_lines(Some(0)), 0);
    }

    #[test]
    fn tail_bytes_are_clamped() {
        assert_eq!(clamp_tail_bytes(None), DEFAULT_TAIL_BYTES);
        assert_eq!(clamp_tail_bytes(Some(1024)), 1024);
        assert_eq!(
            clamp_tail_bytes(Some(MAX_TAIL_BYTES * 8)),
            MAX_TAIL_BYTES
        );
        // 攻击面：超大 tail 不能穿透上限
        assert_eq!(
            clamp_tail_bytes(Some(usize::MAX)),
            MAX_TAIL_BYTES
        );
    }
}
