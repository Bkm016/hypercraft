//! TOTP secret 加密解密工具
//!
//! 使用 AES-256-GCM 对称加密，密钥从 JWT secret 派生
//!
//! @author sky

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose, Engine};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;

use crate::error::{Result, ServiceError};
use super::UserManager;

impl UserManager {
    /// 从 JWT secret 派生加密密钥（使用 HKDF-SHA256）
    fn derive_encryption_key(&self) -> [u8; 32] {
        let hk = Hkdf::<Sha256>::new(None, self.jwt_secret.as_bytes());
        let mut okm = [0u8; 32];
        hk.expand(b"totp-secret-encryption", &mut okm)
            .expect("HKDF expand failed");
        okm
    }

    /// 加密 TOTP secret
    ///
    /// 返回格式: base64(nonce || ciphertext)
    pub fn encrypt_totp_secret(&self, secret: &str) -> Result<String> {
        let key_bytes = self.derive_encryption_key();
        let cipher = Aes256Gcm::new(&key_bytes.into());

        // 生成随机 nonce (12 字节)
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // 加密
        let ciphertext = cipher
            .encrypt(nonce, secret.as_bytes())
            .map_err(|e| ServiceError::Other(format!("encryption failed: {}", e)))?;

        // 拼接 nonce + ciphertext 并 base64 编码
        let mut result = nonce_bytes.to_vec();
        result.extend_from_slice(&ciphertext);
        Ok(general_purpose::STANDARD.encode(result))
    }

    /// 解密 TOTP secret
    pub fn decrypt_totp_secret(&self, encrypted: &str) -> Result<String> {
        let data = general_purpose::STANDARD.decode(encrypted)
            .map_err(|e| ServiceError::Other(format!("invalid base64: {}", e)))?;

        if data.len() < 12 {
            return Err(ServiceError::Other("invalid encrypted data".into()));
        }

        let (nonce, ciphertext) = data.split_at(12);

        let key_bytes = self.derive_encryption_key();
        let cipher = Aes256Gcm::new(&key_bytes.into());

        let plaintext = cipher
            .decrypt(Nonce::from_slice(nonce), ciphertext)
            .map_err(|e| ServiceError::Other(format!("decryption failed: {}", e)))?;

        String::from_utf8(plaintext)
            .map_err(|e| ServiceError::Other(format!("invalid utf8: {}", e)))
    }
}
