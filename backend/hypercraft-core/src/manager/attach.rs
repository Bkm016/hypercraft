use super::*;
use portable_pty::PtySize;

impl ServiceManager {
    /// 建立 attach：需要当前 manager 已经持有子进程句柄。
    pub async fn attach(&self, id: &str) -> Result<AttachHandle> {
        let status = self.status(id).await?;
        if !matches!(status.state, ServiceState::Running) {
            return Err(ServiceError::NotRunning(id.to_string()));
        }
        let guard = self.runtime.lock().await;
        if let Some(entry) = guard.get(id) {
            Ok(AttachHandle {
                pid: entry.pid,
                input: entry.input.clone(),
                output: entry.output.subscribe(),
            })
        } else {
            Err(ServiceError::Other(
                "服务正在运行，但当前 API 进程未持有 stdin/stdout 句柄，无法 attach；请通过本 API 重启后再试"
                    .into(),
            ))
        }
    }

    /// 调整运行中服务的 PTY 尺寸，用于触发 TUI 程序重绘当前屏幕。
    pub async fn resize_pty(&self, id: &str, rows: u16, cols: u16) -> Result<()> {
        let guard = self.runtime.lock().await;
        let Some(entry) = guard.get(id) else {
            return Err(ServiceError::NotRunning(id.to_string()));
        };
        entry
            .pty
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| ServiceError::Other(error.to_string()))
    }
}
