//! 密码加密工具函数

use crate::error::{Result, ServiceError};
use bcrypt::{hash, verify, DEFAULT_COST};

/// 异步哈希密码（在阻塞线程中执行 bcrypt）
pub async fn hash_password(password: &str) -> Result<String> {
    let password = password.to_string();
    tokio::task::spawn_blocking(move || hash(&password, DEFAULT_COST))
        .await
        .map_err(|e| ServiceError::Other(format!("spawn_blocking failed: {}", e)))?
        .map_err(|e| ServiceError::Other(format!("bcrypt hash failed: {}", e)))
}

/// 异步验证密码（在阻塞线程中执行 bcrypt）
pub async fn verify_password(password: &str, hash: &str) -> Result<bool> {
    let password = password.to_string();
    let hash = hash.to_string();
    tokio::task::spawn_blocking(move || verify(&password, &hash))
        .await
        .map_err(|e| ServiceError::Other(format!("spawn_blocking failed: {}", e)))?
        .map_err(|e| ServiceError::Other(format!("bcrypt verify failed: {}", e)))
}
