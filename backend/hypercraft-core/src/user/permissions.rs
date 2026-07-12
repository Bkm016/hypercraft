//! 服务权限管理

use super::models::*;
use super::UserManager;
use crate::error::Result;
use chrono::Utc;
use tracing::instrument;

impl UserManager {
    /// 添加服务权限
    #[instrument(skip(self))]
    pub async fn add_service_permission(&self, user_id: &str, service_id: &str) -> Result<User> {
        let mut user = self.get_user(user_id).await?;
        if !user.service_ids.contains(&service_id.to_string()) {
            user.service_ids.push(service_id.to_string());
            user.token_version = user.token_version.saturating_add(1);
            Self::rotate_refresh_nonce(&mut user);
            user.updated_at = Some(Utc::now());
            self.persist_user(&user)?;
        }
        Ok(user)
    }

    /// 移除服务权限
    #[instrument(skip(self))]
    pub async fn remove_service_permission(&self, user_id: &str, service_id: &str) -> Result<User> {
        let mut user = self.get_user(user_id).await?;
        user.service_ids.retain(|id| id != service_id);
        user.token_version = user.token_version.saturating_add(1);
        Self::rotate_refresh_nonce(&mut user);
        user.updated_at = Some(Utc::now());
        self.persist_user(&user)?;
        Ok(user)
    }

    /// 检查用户是否有权限访问服务
    /// 仅 `__devtoken__` 可全量旁路；系统管理员不旁路服务访问。
    pub fn has_service_permission(&self, claims: &TokenClaims, service_id: &str) -> bool {
        if claims.sub == "__devtoken__" {
            return true;
        }
        match claims.token_type {
            TokenType::Dev => false,
            TokenType::User => claims.service_ids.contains(&service_id.to_string()),
            TokenType::Web => claims.service_id.as_deref() == Some(service_id),
            TokenType::Refresh => false, // refresh token 不能用于访问服务
        }
    }
}
