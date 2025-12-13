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
use sysinfo::Signal;

use crate::app::middleware::AuthInfo;
use crate::app::{ApiError, AppState};

/// POST /services/:id/attach - WebSocket 连接到服务终端
pub async fn attach_service(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    if !auth.can_access_service(&id) {
        return Err(ApiError::forbidden(format!(
            "no permission to access service: {}",
            id
        )));
    }

    let handle = state.manager.attach(&id).await?;
    let manager = state.manager.clone();

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, manager, id, handle)))
}

/// 处理 WebSocket 连接
async fn handle_socket(
    socket: WebSocket,
    manager: Arc<ServiceManager>,
    id: String,
    handle: hypercraft_core::AttachHandle,
) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let pty_tx = handle.input;
    let mut pty_rx = handle.output;

    // 发送最近的原始日志（保留所有控制序列，确保 xterm 状态同步）
    if let Ok(logs) = manager.tail_logs_raw(&id, 64 * 1024) {
        if !logs.is_empty() {
            let _ = ws_tx.send(Message::Binary(logs)).await;
        }
    }

    loop {
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


