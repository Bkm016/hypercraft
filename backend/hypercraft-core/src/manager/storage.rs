use super::*;
use futures::future::join_all;
use tracing::instrument;

impl ServiceManager {
    /// 创建并落盘 manifest。
    #[instrument(skip(self, manifest))]
    pub async fn create_service(&self, mut manifest: ServiceManifest) -> Result<ServiceManifest> {
        self.ensure_base_dirs_async().await?;
        self.validate_id(&manifest.id)?;
        self.enforce_policy(&manifest)?;

        let manifest_path = self.manifest_path(&manifest.id);
        if tokio::fs::try_exists(&manifest_path).await.unwrap_or(false) {
            return Err(ServiceError::AlreadyExists(manifest.id));
        }

        tokio::fs::create_dir_all(self.service_dir(&manifest.id)).await?;
        tokio::fs::create_dir_all(self.runtime_dir(&manifest.id)).await?;
        tokio::fs::create_dir_all(self.logs_dir(&manifest.id)).await?;

        if manifest.created_at.is_none() {
            manifest.created_at = Some(chrono::Utc::now());
        }

        let data = serde_json::to_vec(&manifest)?;
        tokio::fs::write(&manifest_path, data).await?;
        Ok(manifest)
    }

    /// 更新 manifest（保持 id 不变，补齐 created_at）。
    #[instrument(skip(self, manifest))]
    pub async fn update_service(&self, id: &str, mut manifest: ServiceManifest) -> Result<()> {
        self.ensure_base_dirs_async().await?;
        self.validate_id(id)?;
        if manifest.id != id {
            return Err(ServiceError::InvalidId);
        }
        let manifest_path = self.manifest_path(id);
        if !tokio::fs::try_exists(&manifest_path).await.unwrap_or(false) {
            return Err(ServiceError::NotFound(id.to_string()));
        }

        self.enforce_policy(&manifest)?;

        if manifest.created_at.is_none() {
            if let Ok(existing) = self.load_manifest(id).await {
                manifest.created_at = existing.created_at;
            }
        }

        let data = serde_json::to_vec(&manifest)?;
        tokio::fs::write(&manifest_path, data).await?;
        Ok(())
    }

    /// 列出服务以及状态（并发查询优化）。
    #[instrument(skip(self))]
    pub async fn list_services(&self) -> Result<Vec<ServiceSummary>> {
        self.ensure_base_dirs_async().await?;
        
        // 先收集所有服务 ID
        let services_dir = self.services_dir();
        let mut service_ids = Vec::new();
        let mut entries = tokio::fs::read_dir(&services_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let file_type = entry.file_type().await?;
            if !file_type.is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            let manifest_path = entry.path().join("service.json");
            if tokio::fs::try_exists(&manifest_path).await.unwrap_or(false) {
                service_ids.push(id);
            }
        }

        // 并发加载所有 manifest 和 status
        let futures: Vec<_> = service_ids
            .into_iter()
            .map(|id| {
                let manager = self.clone();
                async move {
                    let manifest = manager.load_manifest(&id).await?;
                    let status = manager.status(&id).await?;
                    Ok::<_, ServiceError>(ServiceSummary {
                        id,
                        name: manifest.name,
                        state: status.state,
                        tags: manifest.tags,
                        group: manifest.group,
                        order: manifest.order,
                    })
                }
            })
            .collect();

        let results = join_all(futures).await;
        let mut summaries = Vec::with_capacity(results.len());
        for result in results {
            summaries.push(result?);
        }
        Ok(summaries)
    }

    /// 从磁盘读 manifest（异步版本）。
    pub async fn load_manifest(&self, id: &str) -> Result<ServiceManifest> {
        let path = self.manifest_path(id);
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            return Err(ServiceError::NotFound(id.to_string()));
        }
        let data = tokio::fs::read(&path).await?;
        let manifest: ServiceManifest = serde_json::from_slice(&data)?;
        Ok(manifest)
    }

    /// 删除服务，要求已停止。
    #[instrument(skip(self))]
    pub async fn delete_service(&self, id: &str) -> Result<()> {
        let status = self.status(id).await?;
        if matches!(status.state, ServiceState::Running) {
            return Err(ServiceError::AlreadyRunning(id.to_string()));
        }
        let dir = self.service_dir(id);
        if !tokio::fs::try_exists(&dir).await.unwrap_or(false) {
            return Err(ServiceError::NotFound(id.to_string()));
        }
        tokio::fs::remove_dir_all(dir).await?;
        Ok(())
    }

    /// 确保基础目录存在（异步版本）。
    pub async fn ensure_base_dirs_async(&self) -> Result<()> {
        tokio::fs::create_dir_all(self.services_dir()).await?;
        Ok(())
    }
}
