use super::*;
use crate::models::ServiceGroup;
use tracing::instrument;

impl ServiceManager {
    /// 分组配置文件路径
    fn groups_path(&self) -> PathBuf {
        self.data_dir.join("groups.json")
    }

    /// 加载所有分组（异步版本）
    #[instrument(skip(self))]
    pub async fn list_groups(&self) -> Result<Vec<ServiceGroup>> {
        let path = self.groups_path();
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            return Ok(vec![]);
        }
        let data = tokio::fs::read(&path).await?;
        let groups: Vec<ServiceGroup> = serde_json::from_slice(&data)?;
        Ok(groups)
    }

    /// 保存分组列表（异步版本）
    async fn save_groups_async(&self, groups: &[ServiceGroup]) -> Result<()> {
        let data = serde_json::to_vec(groups)?;
        tokio::fs::write(self.groups_path(), data).await?;
        Ok(())
    }

    /// 创建分组
    #[instrument(skip(self))]
    pub async fn create_group(
        &self,
        id: String,
        name: String,
        color: Option<String>,
    ) -> Result<ServiceGroup> {
        let mut groups = self.list_groups().await?;

        // 检查 ID 是否已存在
        if groups.iter().any(|g| g.id == id) {
            return Err(ServiceError::AlreadyExists(id));
        }

        // 计算新分组的顺序
        let max_order = groups.iter().map(|g| g.order).max().unwrap_or(-1);

        let group = ServiceGroup {
            id,
            name,
            order: max_order + 1,
            color,
        };

        groups.push(group.clone());
        self.save_groups_async(&groups).await?;

        Ok(group)
    }

    /// 更新分组
    #[instrument(skip(self))]
    pub async fn update_group(
        &self,
        id: &str,
        name: Option<String>,
        color: Option<Option<String>>,
    ) -> Result<ServiceGroup> {
        let mut groups = self.list_groups().await?;

        let group = groups
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or_else(|| ServiceError::NotFound(id.to_string()))?;

        if let Some(n) = name {
            group.name = n;
        }
        if let Some(c) = color {
            group.color = c;
        }

        let updated = group.clone();
        self.save_groups_async(&groups).await?;

        Ok(updated)
    }

    /// 删除分组（不会删除服务，只是将服务的 group 设为 None）
    #[instrument(skip(self))]
    pub async fn delete_group(&self, id: &str) -> Result<()> {
        let mut groups = self.list_groups().await?;
        let initial_len = groups.len();
        groups.retain(|g| g.id != id);

        if groups.len() == initial_len {
            return Err(ServiceError::NotFound(id.to_string()));
        }

        self.save_groups_async(&groups).await?;

        // 将属于该分组的服务的 group 设为 None
        let services = self.list_services().await?;
        for svc in services {
            if svc.group.as_deref() == Some(id) {
                let mut manifest = self.load_manifest(&svc.id).await?;
                manifest.group = None;
                self.update_service(&svc.id, manifest).await?;
            }
        }

        Ok(())
    }

    /// 重新排序分组
    #[instrument(skip(self, group_ids))]
    pub async fn reorder_groups(&self, group_ids: Vec<String>) -> Result<Vec<ServiceGroup>> {
        let mut groups = self.list_groups().await?;

        // 按照传入的顺序重新排列
        for (index, gid) in group_ids.iter().enumerate() {
            if let Some(group) = groups.iter_mut().find(|g| &g.id == gid) {
                group.order = index as i32;
            }
        }

        // 按 order 排序
        groups.sort_by_key(|g| g.order);
        self.save_groups_async(&groups).await?;

        Ok(groups)
    }

    /// 更新服务的 tags
    #[instrument(skip(self, tags))]
    pub async fn update_service_tags(&self, id: &str, tags: Vec<String>) -> Result<()> {
        let mut manifest = self.load_manifest(id).await?;
        manifest.tags = tags;
        self.update_service(id, manifest).await
    }

    /// 更新服务的分组
    #[instrument(skip(self))]
    pub async fn update_service_group(&self, id: &str, group: Option<String>) -> Result<()> {
        let mut manifest = self.load_manifest(id).await?;
        manifest.group = group;
        self.update_service(id, manifest).await
    }

    /// 更新服务的顺序
    #[instrument(skip(self))]
    pub async fn update_service_order(&self, id: &str, order: i32) -> Result<()> {
        let mut manifest = self.load_manifest(id).await?;
        manifest.order = order;
        self.update_service(id, manifest).await
    }

    /// 批量更新服务顺序（用于拖拽排序）
    #[instrument(skip(self, service_orders))]
    pub async fn reorder_services(
        &self,
        service_orders: Vec<(String, Option<String>, i32)>,
    ) -> Result<()> {
        for (service_id, group, order) in service_orders {
            let mut manifest = self.load_manifest(&service_id).await?;
            manifest.group = group;
            manifest.order = order;
            self.update_service(&service_id, manifest).await?;
        }
        Ok(())
    }
}
