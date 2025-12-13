//! 密码管理：验证强度、修改密码

use super::models::*;
use super::UserManager;
use crate::error::{Result, ServiceError};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::Utc;
use tracing::instrument;

impl UserManager {
    /// 验证密码强度
    pub(super) fn validate_password_strength(password: &str) -> Result<()> {
        if password.len() < 8 {
            return Err(ServiceError::PolicyViolation(
                "password must be at least 8 characters".into(),
            ));
        }
        let mut has_upper = false;
        let mut has_lower = false;
        let mut has_digit = false;
        let mut has_symbol = false;
        for ch in password.chars() {
            if ch.is_ascii_uppercase() {
                has_upper = true;
            } else if ch.is_ascii_lowercase() {
                has_lower = true;
            } else if ch.is_ascii_digit() {
                has_digit = true;
            } else {
                has_symbol = true;
            }
        }
        if !(has_upper && has_lower && (has_digit || has_symbol)) {
            return Err(ServiceError::PolicyViolation(
                "password must include upper, lower, and number or symbol".into(),
            ));
        }
        Ok(())
    }

    /// 修改用户密码，可选择强制修改（管理员/dev token）。
    #[instrument(skip(self, current_password, new_password))]
    pub async fn change_password(
        &self,
        id: &str,
        current_password: Option<&str>,
        new_password: &str,
        force: bool,
    ) -> Result<User> {
        let mut user = self.get_user(id).await?;

        Self::validate_password_strength(new_password)?;
        // 校验旧密码（非强制模式，在阻塞线程中执行 bcrypt verify）
        if !force {
            let current = current_password
                .ok_or_else(|| ServiceError::Unauthorized("current password required".into()))?;
            let current_owned = current.to_string();
            let hash_clone = user.password_hash.clone();
            let valid = tokio::task::spawn_blocking(move || verify(&current_owned, &hash_clone))
                .await
                .map_err(|e| ServiceError::Other(e.to_string()))?
                .map_err(|e| ServiceError::Other(e.to_string()))?;
            if !valid {
                return Err(ServiceError::Unauthorized(
                    "invalid current password".into(),
                ));
            }
        }

        // 在阻塞线程中执行 bcrypt hash
        let new_password_owned = new_password.to_string();
        user.password_hash = tokio::task::spawn_blocking(move || hash(&new_password_owned, DEFAULT_COST))
            .await
            .map_err(|e| ServiceError::Other(e.to_string()))?
            .map_err(|e| ServiceError::Other(e.to_string()))?;
        user.token_version = user.token_version.saturating_add(1);
        Self::rotate_refresh_nonce(&mut user);
        user.updated_at = Some(Utc::now());

        self.persist_user(&user)?;

        Ok(user)
    }
}
