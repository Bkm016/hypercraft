//! TOTP 双因素认证核心逻辑
//!
//! 基于 RFC 6238 实现 TOTP 验证
//!
//! @author sky

use chrono::Utc;
use rand::{Rng, RngCore};
use totp_rs::{Algorithm, Secret, TOTP};
use tracing::{info, instrument, warn};

use super::crypto::{hash_password, verify_password};
use super::models::{Setup2FAResponse, TotpConfig, TwoFactorVerification, User};
use super::UserManager;
use crate::error::{Result, ServiceError};

/// 生成恢复码（格式: ABCD-1234）
fn generate_recovery_code() -> String {
    // 排除易混淆字符 (0, O, I, L, 1)
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();

    let part1: String = (0..4)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect();
    let part2: String = (0..4)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect();

    format!("{}-{}", part1, part2)
}

impl UserManager {
    /// 验证 TOTP code 或恢复码
    #[instrument(skip(self, user, code))]
    pub async fn verify_totp(&self, user: &User, code: &str) -> Result<bool> {
        let totp_cfg = user
            .totp_config
            .as_ref()
            .ok_or_else(|| ServiceError::Other("双因素认证未配置".into()))?;

        if !totp_cfg.enabled {
            return Ok(false);
        }

        // 1. 尝试验证 TOTP code
        let secret = self.decrypt_totp_secret(&totp_cfg.secret)?;
        let secret_bytes = Secret::Encoded(secret.clone())
            .to_bytes()
            .map_err(|e| ServiceError::Other(format!("TOTP secret 无效: {}", e)))?;

        let totp = TOTP::new(Algorithm::SHA1, 6, 1, 30, secret_bytes)
            .map_err(|e| ServiceError::Other(format!("TOTP creation failed: {}", e)))?;

        if totp
            .check_current(code)
            .map_err(|e| ServiceError::Other(format!("TOTP 验证失败: {}", e)))?
        {
            return Ok(true);
        }

        // 2. 尝试验证恢复码
        for recovery_hash in &totp_cfg.recovery_codes {
            if verify_password(code, recovery_hash).await? {
                warn!(
                    user_id = %user.id,
                    "recovery code used for 2FA verification"
                );
                // TODO: 恢复码一次性使用，需要从列表删除并持久化
                return Ok(true);
            }
        }

        Ok(false)
    }

    /// 生成 TOTP secret 和恢复码（第一步：setup）
    #[instrument(skip(self))]
    pub async fn setup_2fa(&self, user_id: &str) -> Result<Setup2FAResponse> {
        // 如果是 DevToken 用户（sub="dev"），使用虚拟用户 __devtoken__
        let actual_user_id = if user_id == "dev" {
            "__devtoken__"
        } else {
            user_id
        };

        // 检查用户是否存在，如果是 __devtoken__ 且不存在，则创建
        let user = match self.get_user(actual_user_id).await {
            Ok(user) => user,
            Err(ServiceError::NotFound(_)) if actual_user_id == "__devtoken__" => {
                // 创建 __devtoken__ 虚拟用户
                info!("Creating __devtoken__ virtual user for DevToken 2FA");
                self.create_devtoken_user().await?
            }
            Err(e) => return Err(e),
        };

        // 生成 secret（生成 32 字节随机数据）
        let mut secret_bytes = vec![0u8; 32];
        rand::thread_rng().fill_bytes(&mut secret_bytes);
        let secret = Secret::Raw(secret_bytes);
        let secret_base32 = secret.to_encoded().to_string();

        // 生成 QR URI（手动构造 otpauth URL）
        let qr_uri = format!(
            "otpauth://totp/Hypercraft:{}?secret={}&issuer=Hypercraft",
            urlencoding::encode(&user.username),
            secret_base32
        );

        // 生成 8 个恢复码
        let recovery_codes: Vec<String> = (0..8).map(|_| generate_recovery_code()).collect();

        info!(user_id = %user_id, "2FA setup initiated");

        Ok(Setup2FAResponse {
            secret: secret_base32,
            qr_uri,
            recovery_codes,
        })
    }

    /// 确认启用 2FA（第二步：enable）
    #[instrument(skip(self, totp_code, secret, recovery_codes))]
    pub async fn enable_2fa(
        &self,
        user_id: &str,
        totp_code: &str,
        secret: &str,
        recovery_codes: &[String],
    ) -> Result<()> {
        // 如果是 DevToken 用户（sub="dev"），使用虚拟用户 __devtoken__
        let actual_user_id = if user_id == "dev" {
            "__devtoken__"
        } else {
            user_id
        };

        let mut user = self.get_user(actual_user_id).await?;

        // 验证 TOTP code（防止用户未正确保存 secret）
        let secret_bytes = Secret::Encoded(secret.to_string())
            .to_bytes()
            .map_err(|e| ServiceError::Other(format!("TOTP secret 无效: {}", e)))?;

        let totp = TOTP::new(Algorithm::SHA1, 6, 1, 30, secret_bytes)
            .map_err(|e| ServiceError::Other(format!("TOTP 创建失败: {}", e)))?;

        if !totp
            .check_current(totp_code)
            .map_err(|e| ServiceError::Other(format!("TOTP 验证失败: {}", e)))?
        {
            warn!(user_id = %user_id, "2FA enable failed: invalid TOTP code");
            return Err(ServiceError::Unauthorized("验证代码错误".into()));
        }

        // 加密存储 secret
        let encrypted_secret = self.encrypt_totp_secret(secret)?;

        // 哈希恢复码
        let mut recovery_hashes = Vec::new();
        for code in recovery_codes {
            recovery_hashes.push(hash_password(code).await?);
        }

        // 启用 2FA
        user.totp_config = Some(TotpConfig {
            secret: encrypted_secret,
            enabled: true,
            recovery_codes: recovery_hashes,
            enabled_at: Some(Utc::now()),
        });
        user.updated_at = Some(Utc::now());

        self.persist_user(&user)?;

        info!(user_id = %user.id, "2FA enabled successfully");
        Ok(())
    }

    /// 禁用 2FA
    #[instrument(skip(self, verification))]
    pub async fn disable_2fa(
        &self,
        user_id: &str,
        verification: &TwoFactorVerification,
    ) -> Result<()> {
        // 如果是 DevToken 用户（sub="dev"），使用虚拟用户 __devtoken__
        let actual_user_id = if user_id == "dev" {
            "__devtoken__"
        } else {
            user_id
        };

        let mut user = self.get_user(actual_user_id).await?;

        // 验证 TOTP 或恢复码
        let verified = match verification {
            TwoFactorVerification::Totp { code } => self.verify_totp(&user, code).await?,
            TwoFactorVerification::Recovery { code } => self.verify_totp(&user, code).await?,
        };

        if !verified {
            warn!(user_id = %user_id, "2FA disable failed: invalid verification");
            return Err(ServiceError::Unauthorized("验证代码无效".into()));
        }

        // 禁用 2FA
        user.totp_config = None;
        user.updated_at = Some(Utc::now());

        self.persist_user(&user)?;

        info!(user_id = %user.id, "2FA disabled successfully");
        Ok(())
    }
}
