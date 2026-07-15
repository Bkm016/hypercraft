//! 长期 API Key：创建、校验、撤销

use super::models::*;
use super::UserManager;
use crate::error::{Result, ServiceError};
use chrono::Utc;
use rand::RngCore;
use sha2::{Digest, Sha256};
use tracing::instrument;
use uuid::Uuid;

impl UserManager {
    /// API Key 存储目录
    fn api_keys_dir(&self) -> std::path::PathBuf {
        self.data_dir.join("api_keys")
    }

    /// 单个 Key 文件路径
    fn api_key_path(&self, id: &str) -> Result<std::path::PathBuf> {
        let id = Uuid::parse_str(id)
            .map_err(|_| ServiceError::NotFound(format!("api_key:{}", id)))?;
        Ok(self.api_keys_dir().join(format!("{}.json", id)))
    }

    /// 确保 API Key 目录存在
    pub fn ensure_api_key_dirs(&self) -> Result<()> {
        std::fs::create_dir_all(self.api_keys_dir())?;
        Ok(())
    }

    /// 持久化 API Key
    fn persist_api_key(&self, key: &ApiKey) -> Result<()> {
        self.ensure_api_key_dirs()?;
        let data = serde_json::to_vec_pretty(key)?;
        std::fs::write(self.api_key_path(&key.id)?, data)?;
        Ok(())
    }

    /// 计算明文 Key 的 SHA-256 十六进制哈希
    fn hash_api_key_raw(raw: &str) -> String {
        let digest = Sha256::digest(raw.as_bytes());
        digest.iter().map(|b| format!("{:02x}", b)).collect()
    }

    /// 生成明文 Key：`hc_ak_{uuid}_{64hex}`
    fn generate_raw_api_key(id: &str) -> String {
        let mut secret_bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut secret_bytes);
        let secret: String = secret_bytes.iter().map(|b| format!("{:02x}", b)).collect();
        format!("{}{}_{}", API_KEY_RAW_PREFIX, id, secret)
    }

    /// 从明文解析 key id（格式 `hc_ak_{id}_{secret}`）
    fn parse_api_key_id(raw: &str) -> Option<&str> {
        let rest = raw.strip_prefix(API_KEY_RAW_PREFIX)?;
        let (id, _secret) = rest.split_once('_')?;
        if _secret.is_empty() || Uuid::parse_str(id).is_err() {
            return None;
        }
        Some(id)
    }

    /// 创建 API Key，返回摘要与仅一次可见的明文
    #[instrument(skip(self, req))]
    pub async fn create_api_key(
        &self,
        req: CreateApiKeyRequest,
        created_by: &str,
    ) -> Result<CreateApiKeyResponse> {
        self.ensure_api_key_dirs()?;

        let name = req.name.trim().to_string();
        if name.is_empty() {
            return Err(ServiceError::Other("name is required".into()));
        }
        if req.scopes.is_empty() {
            return Err(ServiceError::Other("scopes must not be empty".into()));
        }
        api_key_scopes::validate(&req.scopes)
            .map_err(|e| ServiceError::Other(e))?;

        let id = uuid::Uuid::new_v4().to_string();
        let secret = Self::generate_raw_api_key(&id);
        let key_hash = Self::hash_api_key_raw(&secret);
        let encrypted_secret = Some(self.encrypt_api_key_secret(&secret)?);
        // 展示用前缀：前缀 + id 前 8 位
        let key_prefix = format!(
            "{}{}",
            API_KEY_RAW_PREFIX,
            id.chars().take(8).collect::<String>()
        );

        let now = Utc::now();
        let key = ApiKey {
            id: id.clone(),
            name,
            key_prefix,
            key_hash,
            encrypted_secret,
            // API Key 不再做服务白名单，落盘恒为空
            service_ids: vec![],
            scopes: req.scopes,
            created_by: created_by.to_string(),
            created_at: now,
            last_used_at: None,
            revoked_at: None,
            expires_at: req.expires_at,
        };

        self.persist_api_key(&key)?;
        Ok(CreateApiKeyResponse {
            key: key.into(),
            secret,
        })
    }

    /// 解密并返回完整明文（管理员随时可查看）
    pub async fn reveal_api_key_secret(&self, id: &str) -> Result<ApiKeySecretResponse> {
        let key = self.get_api_key(id).await?;
        let encrypted = key.encrypted_secret.as_deref().ok_or_else(|| {
            ServiceError::Other(
                "此密钥创建于旧版本，无法查看明文，请重新生成".into(),
            )
        })?;
        let secret = self.decrypt_api_key_secret(encrypted)?;
        Ok(ApiKeySecretResponse {
            id: key.id,
            name: key.name,
            secret,
        })
    }

    /// 按 ID 读取 API Key
    pub async fn get_api_key(&self, id: &str) -> Result<ApiKey> {
        let path = self.api_key_path(id)?;
        if !path.exists() {
            return Err(ServiceError::NotFound(format!("api_key:{}", id)));
        }
        let data = std::fs::read(path)?;
        let key: ApiKey = serde_json::from_slice(&data)?;
        Ok(key)
    }

    /// 列出全部 API Key（含已撤销）
    pub async fn list_api_keys(&self) -> Result<Vec<ApiKey>> {
        self.ensure_api_key_dirs()?;
        let mut keys = Vec::new();
        let dir = self.api_keys_dir();
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => return Ok(keys),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            if let Ok(data) = std::fs::read(&path) {
                if let Ok(key) = serde_json::from_slice::<ApiKey>(&data) {
                    keys.push(key);
                }
            }
        }
        keys.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(keys)
    }

    /// 更新 API Key 元数据与权限（不可改明文；已撤销的不可改）
    #[instrument(skip(self, req))]
    pub async fn update_api_key(&self, id: &str, req: UpdateApiKeyRequest) -> Result<ApiKey> {
        let mut key = self.get_api_key(id).await?;
        if key.revoked_at.is_some() {
            return Err(ServiceError::Other("api key already revoked".into()));
        }

        if let Some(name) = req.name {
            let name = name.trim().to_string();
            if name.is_empty() {
                return Err(ServiceError::Other("name is required".into()));
            }
            key.name = name;
        }
        if let Some(scopes) = req.scopes {
            if scopes.is_empty() {
                return Err(ServiceError::Other("scopes must not be empty".into()));
            }
            api_key_scopes::validate(&scopes).map_err(ServiceError::Other)?;
            key.scopes = scopes;
        }
        if let Some(expires_at) = req.expires_at {
            key.expires_at = Some(expires_at);
        }

        self.persist_api_key(&key)?;
        Ok(key)
    }

    /// 重新生成明文密钥（旧明文立即失效；新明文加密落盘，可再次查看）
    #[instrument(skip(self))]
    pub async fn rotate_api_key_secret(&self, id: &str) -> Result<CreateApiKeyResponse> {
        let mut key = self.get_api_key(id).await?;
        if key.revoked_at.is_some() {
            return Err(ServiceError::Other("api key already revoked".into()));
        }

        let secret = Self::generate_raw_api_key(&key.id);
        key.key_hash = Self::hash_api_key_raw(&secret);
        key.encrypted_secret = Some(self.encrypt_api_key_secret(&secret)?);
        key.key_prefix = format!(
            "{}{}",
            API_KEY_RAW_PREFIX,
            key.id.chars().take(8).collect::<String>()
        );
        self.persist_api_key(&key)?;

        Ok(CreateApiKeyResponse {
            key: key.into(),
            secret,
        })
    }

    /// 撤销 API Key（幂等）
    #[instrument(skip(self))]
    pub async fn revoke_api_key(&self, id: &str) -> Result<ApiKey> {
        let mut key = self.get_api_key(id).await?;
        if key.revoked_at.is_none() {
            key.revoked_at = Some(Utc::now());
            self.persist_api_key(&key)?;
        }
        Ok(key)
    }

    /// 校验明文 API Key，成功返回可用于 Auth 的合成 TokenClaims 与 scopes
    pub async fn verify_api_key(&self, raw: &str) -> Result<(TokenClaims, Vec<String>)> {
        let id = Self::parse_api_key_id(raw)
            .ok_or_else(|| ServiceError::Unauthorized("invalid api key".into()))?;
        let mut key = self.get_api_key(id).await.map_err(|_| {
            ServiceError::Unauthorized("invalid api key".into())
        })?;

        if key.revoked_at.is_some() {
            return Err(ServiceError::Unauthorized("api key revoked".into()));
        }
        if let Some(exp) = key.expires_at {
            if exp < Utc::now() {
                return Err(ServiceError::Unauthorized("api key expired".into()));
            }
        }

        let expected = Self::hash_api_key_raw(raw);
        // 常量时间比较，避免计时旁路
        if !constant_time_eq(expected.as_bytes(), key.key_hash.as_bytes()) {
            return Err(ServiceError::Unauthorized("invalid api key".into()));
        }

        // 节流更新 last_used_at（5 分钟）
        let should_touch = key
            .last_used_at
            .map(|t| (Utc::now() - t).num_seconds() >= 300)
            .unwrap_or(true);
        if should_touch {
            key.last_used_at = Some(Utc::now());
            let _ = self.persist_api_key(&key);
        }

        let now = Utc::now().timestamp();
        let claims = TokenClaims {
            sub: format!("apikey:{}", key.id),
            username: key.name.clone(),
            iss: Some(self.jwt_issuer.clone()),
            aud: Some(self.jwt_audience.clone()),
            token_type: TokenType::ApiKey,
            // 鉴权不再读 service_ids；恒空，避免误当白名单
            service_ids: vec![],
            is_admin: false,
            token_version: 0,
            refresh_nonce: None,
            service_id: None,
            // API Key 本身无 JWT exp；claims.exp 填远期占位
            exp: key
                .expires_at
                .map(|t| t.timestamp())
                .unwrap_or(now + 10 * 365 * 24 * 3600),
            iat: now,
        };

        Ok((claims, key.scopes))
    }
}

/// 等长字节常量时间比较；长度不同直接 false
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
