//! 密码管理：验证强度、修改密码

use super::crypto::{hash_password, verify_password};
use super::models::*;
use super::UserManager;
use crate::error::{Result, ServiceError};
use chrono::Utc;
use tracing::instrument;

impl UserManager {
    /// 验证密码强度
    pub(super) fn validate_password_strength(password: &str) -> Result<()> {
        if password.len() < 8 {
            return Err(ServiceError::PolicyViolation(
                "密码长度至少为 8 个字符".into(),
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
                "密码必须包含大写字母、小写字母以及数字或符号".into(),
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
        // 校验旧密码（非强制模式）
        if !force {
            let current = current_password
                .ok_or_else(|| ServiceError::Unauthorized("需要输入当前密码".into()))?;
            let valid = verify_password(current, &user.password_hash).await?;
            if !valid {
                return Err(ServiceError::Unauthorized(
                    "当前密码错误".into(),
                ));
            }
        }

        // 哈希新密码
        user.password_hash = hash_password(new_password).await?;
        user.token_version = user.token_version.saturating_add(1);
        Self::rotate_refresh_nonce(&mut user);
        user.updated_at = Some(Utc::now());

        self.persist_user(&user)?;

        Ok(user)
    }
}
