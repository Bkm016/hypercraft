use crossterm::{
    event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers},
    terminal::{disable_raw_mode, enable_raw_mode},
};
use futures::{SinkExt, StreamExt};
use serde_json::json;
use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, protocol::Message},
};

/// Attach to a running service via WebSocket, forwarding stdin/stdout.
pub async fn attach_service(base: &str, id: &str, token: Option<&str>) -> anyhow::Result<()> {
    let ws_url = build_ws_url(base, &format!("services/{}/attach", id));
    let mut request = ws_url.into_client_request()?;
    request
        .headers_mut()
        .insert("User-Agent", "hypercraft-cli".parse()?);
    if let Some(tok) = token {
        request
            .headers_mut()
            .insert("Authorization", format!("Bearer {}", tok).parse()?);
    }

    let (ws_stream, _resp) = connect_async(request).await?;
    println!(
        "# attach to {}. Real PTY stream; remote echoes input. \
         Ctrl+Q exits; Ctrl+C/Ctrl+I/Ctrl+T/Ctrl+K send INT/INT/TERM/KILL.",
        id
    );
    let (mut write, mut read) = ws_stream.split();

    enum InputEvent {
        Bytes(Vec<u8>),
        Signal(&'static str),
        Quit,
    }

    let (input_tx, mut input_rx) = mpsc::channel::<InputEvent>(64);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = stop.clone();
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        enable_raw_mode()?;
        let _guard = scopeguard::guard((), |_| {
            let _ = disable_raw_mode();
        });
        loop {
            if !event::poll(Duration::from_millis(50))? {
                if stop_for_thread.load(Ordering::Relaxed) {
                    break;
                }
                continue;
            }
            match event::read()? {
                Event::Key(KeyEvent {
                    code,
                    modifiers,
                    kind,
                    ..
                }) => {
                    // 只处理按下事件，忽略释放事件（Windows 上会触发两次）
                    if kind != KeyEventKind::Press {
                        continue;
                    }
                    if modifiers.contains(KeyModifiers::CONTROL)
                        && matches!(code, KeyCode::Char('q'))
                    {
                        let _ = input_tx.blocking_send(InputEvent::Quit);
                        break;
                    }
                    if modifiers.contains(KeyModifiers::CONTROL) {
                        match code {
                            KeyCode::Char('c') | KeyCode::Char('i') => {
                                let _ = input_tx.blocking_send(InputEvent::Signal("INT"));
                                continue;
                            }
                            KeyCode::Char('t') => {
                                let _ = input_tx.blocking_send(InputEvent::Signal("TERM"));
                                continue;
                            }
                            KeyCode::Char('k') => {
                                let _ = input_tx.blocking_send(InputEvent::Signal("KILL"));
                                continue;
                            }
                            _ => {}
                        }
                    }
                    // Forward keys as bytes immediately; remote side handles echo/editing.
                    let bytes: Option<Vec<u8>> = match code {
                        KeyCode::Enter => Some(vec![b'\n']),
                        KeyCode::Tab => Some(vec![b'\t']),
                        KeyCode::Backspace => Some(vec![0x7f]), // DEL for most terminals
                        KeyCode::Esc => Some(vec![0x1b]),
                        KeyCode::Char(ch) => Some(ch.to_string().into_bytes()),
                        KeyCode::Left => Some(b"\x1b[D".to_vec()),
                        KeyCode::Right => Some(b"\x1b[C".to_vec()),
                        KeyCode::Up => Some(b"\x1b[A".to_vec()),
                        KeyCode::Down => Some(b"\x1b[B".to_vec()),
                        KeyCode::Home => Some(b"\x1b[H".to_vec()),
                        KeyCode::End => Some(b"\x1b[F".to_vec()),
                        KeyCode::PageUp => Some(b"\x1b[5~".to_vec()),
                        KeyCode::PageDown => Some(b"\x1b[6~".to_vec()),
                        KeyCode::Delete => Some(b"\x1b[3~".to_vec()),
                        KeyCode::Insert => Some(b"\x1b[2~".to_vec()),
                        _ => None,
                    };
                    if let Some(bytes) = bytes {
                        let _ = input_tx.blocking_send(InputEvent::Bytes(bytes));
                    }
                }
                Event::Paste(s) => {
                    if !s.is_empty() {
                        let bytes = s.into_bytes();
                        let _ = input_tx.blocking_send(InputEvent::Bytes(bytes));
                    }
                }
                _ => {}
            }
            if stop_for_thread.load(Ordering::Relaxed) {
                break;
            }
        }
        Ok(())
    });

    loop {
        tokio::select! {
            maybe_input = input_rx.recv() => {
                match maybe_input {
                    Some(InputEvent::Quit) | None => {
                        let _ = write.send(Message::Close(None)).await;
                        break;
                    }
                    Some(InputEvent::Signal(sig)) => {
                        let body = json!({"type": "signal", "signal": sig});
                        let payload = Message::Text(body.to_string());
                        if write.send(payload).await.is_err() {
                            break;
                        }
                    }
                    Some(InputEvent::Bytes(bytes)) => {
                        if write.send(Message::Binary(bytes)).await.is_err() {
                            break;
                        }
                    }
                }
            }
            ws_msg = read.next() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                            if let Some(ty) = v.get("type").and_then(|t| t.as_str()) {
                                match ty {
                                    "notice" => {
                                        if let Some(msg) = v.get("message").and_then(|d| d.as_str()) {
                                            println!("# {}", msg);
                                        }
                                    }
                                    "error" => {
                                        if let Some(msg) = v.get("message").and_then(|d| d.as_str()) {
                                            eprintln!("error: {}", msg);
                                        }
                                    }
                                    _ => {
                                        println!("{text}");
                                    }
                                }
                            } else {
                                println!("{text}");
                            }
                        } else {
                            println!("{text}");
                        }
                    }
                    Some(Ok(Message::Binary(data))) => {
                        let mut stdout = io::stdout();
                        // 在 raw mode 下，\n 不会自动回车，需要转换成 \r\n
                        let converted = convert_lf_to_crlf(&data);
                        let _ = stdout.write_all(&converted);
                        let _ = stdout.flush();
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    stop.store(true, Ordering::Relaxed);
    // Ensure terminal mode is restored on exit.
    let _ = crossterm::terminal::disable_raw_mode();
    Ok(())
}

fn build_ws_url(base: &str, path: &str) -> String {
    let mut ws_base = base
        .replace("https://", "wss://")
        .replace("http://", "ws://");
    while ws_base.ends_with('/') {
        ws_base.pop();
    }
    format!("{}/{}", ws_base, path.trim_start_matches('/'))
}

/// 将 LF (\n) 转换为 CRLF (\r\n)，在 raw mode 下确保光标正确回到行首
fn convert_lf_to_crlf(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len() + data.len() / 10);
    for &byte in data {
        if byte == b'\n' {
            // 检查前一个字节是否已经是 \r，避免重复添加
            if result.last() != Some(&b'\r') {
                result.push(b'\r');
            }
        }
        result.push(byte);
    }
    result
}
