use super::output::OutputFormat;
use super::ui::{print_header, print_hint, print_info, print_section};
use crate::client::handle_error;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use crossterm::event::{self, Event, KeyCode, KeyModifiers};
use crossterm::style::Stylize;
use crossterm::terminal;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::io::{self, Write};
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize)]
pub struct LogsResponse {
    pub id: String,
    /// Base64 编码的原始日志数据
    pub data: String,
}

/// Tail logs.
pub async fn logs_service(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    tail: usize,
    follow: bool,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let url = format!(
        "{}/services/{}/logs?tail={}&follow={}",
        base, id, tail, follow
    );
    let resp = client.get(url).send().await?;

    if follow {
        print_header(&format!("📜 FOLLOW LOGS: {}", id.to_uppercase()));
        print_info("Streaming logs in real-time. Press Ctrl+Q to stop.");
        println!();
        println!("  {}", "─".repeat(60).dark_grey());

        // 启用原始模式以捕获键盘事件
        terminal::enable_raw_mode()?;

        let mut stream = handle_error(resp).await?.bytes_stream();

        'outer: loop {
            // 检查键盘输入（非阻塞）
            if event::poll(Duration::from_millis(10))? {
                if let Event::Key(key_event) = event::read()? {
                    // Ctrl+Q 退出
                    if key_event.modifiers.contains(KeyModifiers::CONTROL)
                        && key_event.code == KeyCode::Char('q')
                    {
                        break 'outer;
                    }
                }
            }

            // 使用 tokio::select! 来同时处理流和超时
            tokio::select! {
                chunk_opt = stream.next() => {
                    match chunk_opt {
                        Some(Ok(chunk)) => {
                            let data = String::from_utf8_lossy(&chunk);
                            for line in data.lines() {
                                if let Some(rest) = line.strip_prefix("data:") {
                                    let encoded = rest.trim();
                                    if !encoded.is_empty() {
                                        // 解码 base64 并写入 stdout
                                        if let Ok(decoded) = BASE64.decode(encoded) {
                                            let _ = io::stdout().write_all(&decoded);
                                            let _ = io::stdout().flush();
                                        }
                                    }
                                }
                            }
                        }
                        Some(Err(e)) => {
                            terminal::disable_raw_mode()?;
                            return Err(e.into());
                        }
                        None => break 'outer,
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(100)) => {
                    // 超时，继续循环以检查键盘输入
                }
            }
        }

        terminal::disable_raw_mode()?;
        println!();
        println!("  {}\r", "─".repeat(60).dark_grey());
        print_info("Log stream stopped.");
        println!("\r");
        return Ok(());
    }

    let resp = handle_error(resp).await?;
    let logs: LogsResponse = resp.json().await?;

    // 解码 base64 数据
    let decoded = BASE64
        .decode(&logs.data)
        .map_err(|e| anyhow::anyhow!("failed to decode base64: {}", e))?;
    let content = String::from_utf8_lossy(&decoded);
    let lines: Vec<&str> = content.lines().collect();

    match output {
        OutputFormat::Json => {
            // JSON 输出保持 lines 格式以兼容
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "id": logs.id,
                    "lines": lines
                }))?
            )
        }
        OutputFormat::Table => {
            print_header(&format!("📜 LOGS: {}", id.to_uppercase()));

            if lines.is_empty() {
                print_section("Log Output");
                println!();
                println!("  {}", "No logs available.".dark_grey().italic());
                println!();
            } else {
                print_info(&format!(
                    "Showing last {} lines",
                    lines.len().to_string().cyan()
                ));
                println!();
                println!("  {}", "─".repeat(60).dark_grey());

                for line in &lines {
                    println!("  {}", line);
                }

                println!("  {}", "─".repeat(60).dark_grey());
            }
            println!();
            print_hint(&format!("Use 'logs {} -f' to follow logs in real-time", id));
            println!();
        }
    }
    Ok(())
}
