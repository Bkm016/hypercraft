use super::*;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::Mutex;

impl ServiceManager {
    /// 返回日志末尾的原始字节（用于 attach 回放）
    pub fn tail_logs_raw(&self, id: &str, max_bytes: usize) -> Result<Vec<u8>> {
        let path = self.log_path(id);
        if !path.exists() || max_bytes == 0 {
            return Ok(vec![]);
        }
        let mut file = File::open(path)?;
        let meta = file.metadata()?;
        let file_len = meta.len() as usize;
        let read_size = max_bytes.min(file_len);
        
        if read_size == 0 {
            return Ok(vec![]);
        }
        
        // 从文件末尾读取
        let start_pos = file_len.saturating_sub(read_size);
        file.seek(SeekFrom::Start(start_pos as u64))?;
        let mut buf = vec![0u8; read_size];
        file.read_exact(&mut buf)?;
        
        Ok(buf)
    }

    /// 返回日志末尾 N 行。
    pub fn tail_logs(&self, id: &str, lines: usize) -> Result<Vec<String>> {
        let path = self.log_path(id);
        if !path.exists() || lines == 0 {
            return Ok(vec![]);
        }
        let mut file = File::open(path)?;
        let meta = file.metadata()?;
        let mut pos: i64 = meta.len() as i64;
        let mut chunks: Vec<Vec<u8>> = Vec::new();
        let mut newline_count = 0usize;
        const CHUNK_SIZE: usize = 8 * 1024;

        while pos > 0 && newline_count <= lines {
            let read_size = CHUNK_SIZE.min(pos as usize);
            pos -= read_size as i64;
            file.seek(SeekFrom::Start(pos as u64))?;
            let mut buf = vec![0u8; read_size];
            file.read_exact(&mut buf)?;

            // 从尾部开始计数，找到开始位置后截断
            let mut boundary = None;
            for (idx, &b) in buf.iter().enumerate().rev() {
                if b == b'\n' {
                    newline_count += 1;
                    if newline_count > lines {
                        boundary = Some(idx + 1);
                        break;
                    }
                }
            }

            if let Some(start) = boundary {
                chunks.push(buf.split_off(start));
                break;
            } else {
                chunks.push(buf);
            }

            if pos <= 0 {
                break;
            }
        }

        if chunks.is_empty() {
            return Ok(vec![]);
        }

        chunks.reverse();
        let mut data = Vec::new();
        for chunk in chunks {
            data.extend_from_slice(&chunk);
        }

        // 拆分成行再解码，避免一次性加载整文件
        let mut result = Vec::new();
        let mut start = 0usize;
        for (i, &b) in data.iter().enumerate() {
            if b == b'\n' {
                result.push(decode_line(&data[start..=i]));
                start = i + 1;
            }
        }
        if start < data.len() {
            result.push(decode_line(&data[start..]));
        }

        if result.len() > lines {
            let drop = result.len().saturating_sub(lines);
            result.drain(0..drop);
        }

        Ok(result)
    }

    /// 追踪日志（follow）- 返回原始字节流，不按行切割
    /// 优先使用 broadcast channel（如果服务正在运行且由当前进程管理），
    /// 否则回退到文件轮询方式。
    pub async fn follow_logs_raw(
        &self,
        id: &str,
        poll: std::time::Duration,
    ) -> Result<futures::stream::BoxStream<'static, std::io::Result<Vec<u8>>>> {
        // 尝试订阅 broadcast channel
        let maybe_rx = {
            let guard = self.runtime.lock().await;
            guard.get(id).map(|h| h.output.subscribe())
        };

        if let Some(mut rx) = maybe_rx {
            // 使用 broadcast channel 实时获取输出
            let id_owned = id.to_string();
            let stream = async_stream::stream! {
                tracing::debug!(service_id = %id_owned, "Started following logs via broadcast channel (raw)");
                loop {
                    match rx.recv().await {
                        Ok(bytes) => {
                            // 直接返回原始字节，不做任何处理
                            yield Ok(bytes);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!(service_id = %id_owned, dropped = n, "Log receiver lagged");
                            // 返回一个提示消息
                            yield Ok(format!("[dropped {} messages]\n", n).into_bytes());
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            tracing::info!(service_id = %id_owned, "Broadcast channel closed, stopping log follow");
                            break;
                        }
                    }
                }
            };
            return Ok(Box::pin(stream));
        }

        // 回退到文件轮询方式
        self.follow_logs_file_raw(id, poll).await
    }

    /// 通过文件轮询方式追踪日志（raw 版本）
    async fn follow_logs_file_raw(
        &self,
        id: &str,
        poll: std::time::Duration,
    ) -> Result<futures::stream::BoxStream<'static, std::io::Result<Vec<u8>>>> {
        let path = self.log_path(id);
        // 确保文件存在
        if !path.exists() {
            std::fs::create_dir_all(self.logs_dir(id))?;
            std::fs::write(&path, b"")?;
        }

        // 使用 OpenOptions 以共享模式打开文件，允许其他进程同时写入
        let file = tokio::fs::OpenOptions::new().read(true).open(&path).await?;
        let mut reader = tokio::io::BufReader::new(file);
        // 从文件末尾开始
        reader.seek(std::io::SeekFrom::End(0)).await?;

        let stream = async_stream::try_stream! {
            let mut buf = [0u8; 4096];
            loop {
                match tokio::io::AsyncReadExt::read(&mut reader, &mut buf).await {
                    Ok(0) => {
                        // 没有新数据，等待后继续
                        tokio::time::sleep(poll).await;
                        continue;
                    }
                    Ok(n) => {
                        yield buf[..n].to_vec();
                    }
                    Err(e) => {
                        // 记录错误但继续尝试
                        tracing::warn!("Error reading log file: {}", e);
                        tokio::time::sleep(poll).await;
                        continue;
                    }
                }
            }
        };

        Ok(Box::pin(stream))
    }
}

#[allow(dead_code)]
/// 后台转发 stdout/stderr：写入日志文件并广播给 attach 订阅者。
pub(super) fn spawn_output_forward<R>(
    reader: R,
    tx: tokio::sync::broadcast::Sender<String>,
    log_path: PathBuf,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::task::spawn(async move {
        let mut reader = tokio::io::BufReader::new(reader);
        let mut buf = Vec::new();
        // 独立打开写日志，避免与其他 writer 互斥
        let file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .await;
        let writer = Mutex::new(file.ok());

        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf).await {
                Ok(0) => break,
                Ok(_) => {
                    if let Some(file) = writer.lock().await.as_mut() {
                        let _ = file.write_all(&buf).await;
                        let _ = file.flush().await;
                    }
                    let line = decode_line(&buf);
                    let _ = tx.send(line);
                }
                Err(_) => break,
            }
        }
    });
}

/// 尝试从 UTF-8 解码，否则回退 GB18030；移除行尾换行。
fn decode_line(raw: &[u8]) -> String {
    let mut s = match std::str::from_utf8(raw) {
        Ok(v) => v.to_string(),
        Err(_) => {
            // UTF-8 解码失败，尝试 GB18030
            let (cow, _, had_errors) = encoding_rs::GB18030.decode(raw);
            if had_errors {
                // 如果 GB18030 也有问题，使用有损 UTF-8 转换
                String::from_utf8_lossy(raw).to_string()
            } else {
                cow.to_string()
            }
        }
    };
    // 移除行尾换行
    while s.ends_with('\n') || s.ends_with('\r') {
        s.pop();
    }
    s
}
