//! WebSocket attach handler - 连接到服务的 PTY 终端
//!
//! 协议设计：
//! - Binary 消息：双向传输原始终端数据
//! - Text 消息：JSON 控制命令
//!   - 客户端 -> 服务端: {"signal": "INT|TERM|KILL"}
//!   - 服务端 -> 客户端: {"type": "notice|error", "message": "..."}

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::Response;
use axum::Extension;
use futures::stream::StreamExt;
use futures::SinkExt;
use hypercraft_core::ServiceManager;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use sysinfo::Signal;

use crate::app::middleware::AuthInfo;
use crate::app::rate_limit::StreamPermit;
use crate::app::{ApiError, AppState};
use hypercraft_core::api_key_scopes;

const DEFAULT_PTY_COLS: u16 = 155;
/// attach 无读写活动时的空闲超时，超时后关闭连接并释放并发槽位
const ATTACH_IDLE_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// attach 回放日志的最大字节数
const ATTACH_REPLAY_BYTES: usize = 64 * 1024;

/// GET /services/:id/attach - WebSocket 连接到服务终端
pub async fn attach_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    auth.require_scope(api_key_scopes::ATTACH)?;
    if !auth.can_access_service(&id) {
        return Err(ApiError::forbidden(format!(
            "没有权限访问服务: {}",
            id
        )));
    }

    let stream_key = format!("ws:{}:{}", auth.claims.sub, id);
    let permit = state.stream_limiter.try_acquire(stream_key).ok_or_else(|| {
        ApiError::too_many_requests("too many concurrent attach sessions for this service")
    })?;

    let handle = match state.manager.attach(&id).await {
        Ok(handle) => handle,
        Err(err) => {
            drop(permit);
            return Err(ApiError::from(err));
        }
    };
    let manifest = state.manager.load_manifest(&id).await.ok();
    let replay_logs = manifest
        .as_ref()
        .map(|manifest| !manifest.terminal_tui)
        .unwrap_or(true);
    if let Some(manifest) = manifest.as_ref().filter(|manifest| manifest.terminal_tui) {
        let _ = state
            .manager
            .resize_pty(&id, manifest.pty_rows.clamp(5, 500), DEFAULT_PTY_COLS)
            .await;
    }
    let manager = state.manager.clone();

    Ok(ws.on_upgrade(move |socket| {
        handle_socket(socket, manager, id, handle, replay_logs, permit)
    }))
}

/// 处理 WebSocket 连接
async fn handle_socket(
    socket: WebSocket,
    manager: Arc<ServiceManager>,
    id: String,
    handle: hypercraft_core::AttachHandle,
    replay_logs: bool,
    _permit: StreamPermit,
) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let pty_tx = handle.input;
    let mut pty_rx = handle.output;

    // 发送最近的原始日志（保留所有控制序列，确保 xterm 状态同步）
    if replay_logs {
        if let Ok(logs) = manager.tail_logs_raw(&id, ATTACH_REPLAY_BYTES) {
            if !logs.is_empty() {
                let _ = ws_tx.send(Message::Binary(logs)).await;
            }
        }
    }

    loop {
        // 任意方向有活动都会重建空闲计时；双向静默超过阈值则断开。
        tokio::select! {
            // 客户端 -> PTY
            msg = ws_rx.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        // 原始终端输入
                        let _ = pty_tx.send(data).await;
                    }
                    Some(Ok(Message::Text(text))) => {
                        // JSON 控制命令
                        if let Some(sig) = parse_signal_command(&text) {
                            let _ = manager.send_signal(&id, sig).await;
                        }
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let _ = ws_tx.send(Message::Pong(data)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
            // PTY -> 客户端
            data = pty_rx.recv() => {
                match data {
                    Ok(bytes) => {
                        if ws_tx.send(Message::Binary(bytes)).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        // 客户端太慢，丢弃了一些输出
                        let msg = format!(r#"{{"type":"notice","message":"dropped {} messages"}}"#, n);
                        let _ = ws_tx.send(Message::Text(msg)).await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = tokio::time::sleep(ATTACH_IDLE_TIMEOUT) => {
                let _ = ws_tx
                    .send(Message::Text(
                        r#"{"type":"notice","message":"attach idle timeout"}"#.to_string(),
                    ))
                    .await;
                break;
            }
        }
    }
}

/// 解析信号命令: {"signal": "INT"}
fn parse_signal_command(text: &str) -> Option<Signal> {
    #[derive(Deserialize)]
    struct SignalCmd {
        signal: String,
    }

    serde_json::from_str::<SignalCmd>(text)
        .ok()
        .and_then(|cmd| match cmd.signal.to_uppercase().as_str() {
            "INT" | "SIGINT" => Some(Signal::Interrupt),
            "TERM" | "SIGTERM" => Some(Signal::Term),
            "KILL" | "SIGKILL" => Some(Signal::Kill),
            _ => None,
        })
}

#[cfg(test)]
mod tests {
    use crate::app::StreamConcurrencyLimiter;

    #[test]
    fn attach_stream_key_is_isolated_from_sse() {
        let limiter = StreamConcurrencyLimiter::new(1);
        let _sse = limiter.try_acquire("sse:user:svc").unwrap();
        // 攻击面：SSE 占满不应阻断 attach，attach 占满不应阻断 SSE
        assert!(limiter.try_acquire("ws:user:svc").is_some());
        assert!(limiter.try_acquire("sse:user:svc").is_none());
    }

    #[test]
    fn attach_concurrency_is_enforced_per_identity_service() {
        let limiter = StreamConcurrencyLimiter::new(2);
        let a = limiter.try_acquire("ws:alice:svc").unwrap();
        let b = limiter.try_acquire("ws:alice:svc").unwrap();
        assert!(limiter.try_acquire("ws:alice:svc").is_none());
        // 其他用户/服务不受影响
        assert!(limiter.try_acquire("ws:bob:svc").is_some());
        assert!(limiter.try_acquire("ws:alice:other").is_some());
        drop(a);
        drop(b);
        assert!(limiter.try_acquire("ws:alice:svc").is_some());
    }
}
