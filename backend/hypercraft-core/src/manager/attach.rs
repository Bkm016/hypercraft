use super::*;

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
}
