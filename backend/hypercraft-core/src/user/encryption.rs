//! 对称加密工具（TOTP secret / API Key 明文）
//!
//! 使用 AES-256-GCM，密钥从 JWT secret 经 HKDF 派生
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
    fn derive_encryption_key(&self, info: &[u8]) -> [u8; 32] {
        let hk = Hkdf::<Sha256>::new(None, self.jwt_secret.as_bytes());
        let mut okm = [0u8; 32];
        hk.expand(info, &mut okm)
            .expect("HKDF expand failed");
        okm
    }

    /// AES-256-GCM 加密，返回 base64(nonce || ciphertext)
    fn encrypt_blob(&self, info: &[u8], plaintext: &str) -> Result<String> {
        let key_bytes = self.derive_encryption_key(info);
        let cipher = Aes256Gcm::new(&key_bytes.into());

        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| ServiceError::Other(format!("encryption failed: {}", e)))?;

        let mut result = nonce_bytes.to_vec();
        result.extend_from_slice(&ciphertext);
        Ok(general_purpose::STANDARD.encode(result))
    }

    /// 解密 base64(nonce || ciphertext)
    fn decrypt_blob(&self, info: &[u8], encrypted: &str) -> Result<String> {
        let data = general_purpose::STANDARD
            .decode(encrypted)
            .map_err(|e| ServiceError::Other(format!("invalid base64: {}", e)))?;

        if data.len() < 12 {
            return Err(ServiceError::Other("invalid encrypted data".into()));
        }

        let (nonce, ciphertext) = data.split_at(12);
        let key_bytes = self.derive_encryption_key(info);
        let cipher = Aes256Gcm::new(&key_bytes.into());

        let plaintext = cipher
            .decrypt(Nonce::from_slice(nonce), ciphertext)
            .map_err(|e| ServiceError::Other(format!("decryption failed: {}", e)))?;

        String::from_utf8(plaintext)
            .map_err(|e| ServiceError::Other(format!("invalid utf8: {}", e)))
    }

    /// 加密 TOTP secret
    pub fn encrypt_totp_secret(&self, secret: &str) -> Result<String> {
        self.encrypt_blob(b"totp-secret-encryption", secret)
    }

    /// 解密 TOTP secret
    pub fn decrypt_totp_secret(&self, encrypted: &str) -> Result<String> {
        self.decrypt_blob(b"totp-secret-encryption", encrypted)
    }

    /// 加密 API Key 明文（落盘用）
    pub fn encrypt_api_key_secret(&self, secret: &str) -> Result<String> {
        self.encrypt_blob(b"api-key-secret-encryption", secret)
    }

    /// 解密 API Key 明文
    pub fn decrypt_api_key_secret(&self, encrypted: &str) -> Result<String> {
        self.decrypt_blob(b"api-key-secret-encryption", encrypted)
    }
}
