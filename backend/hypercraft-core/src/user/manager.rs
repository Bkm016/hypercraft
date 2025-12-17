//! 用户管理器：核心结构和用户 CRUD 操作

use super::crypto::hash_password;
use super::models::*;
use crate::error::{Result, ServiceError};
use chrono::Utc;
use serde_json;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{info, instrument};

const DEFAULT_JWT_ISSUER: &str = "hypercraft-api";
const DEFAULT_JWT_AUDIENCE: &str = "hypercraft-clients";

/// 用户管理器
#[derive(Debug, Clone)]
pub struct UserManager {
    /// 用户数据存储目录
    pub(super) data_dir: PathBuf,
    /// JWT 签名密钥
    pub(super) jwt_secret: String,
    /// JWT issuer
    pub(super) jwt_issuer: String,
    /// JWT audience
    pub(super) jwt_audience: String,
    /// Access token 有效期（秒）
    pub(super) access_token_ttl: i64,
    /// Refresh token 有效期（秒）
    pub(super) refresh_token_ttl: i64,
}

// ============================================================================
// 构造器和配置
// ============================================================================

impl UserManager {
    /// 创建新的用户管理器
    pub fn new<P: AsRef<Path>>(data_dir: P, jwt_secret: String) -> Self {
        Self {
            data_dir: data_dir.as_ref().to_path_buf(),
            jwt_secret,
            jwt_issuer: DEFAULT_JWT_ISSUER.to_string(),
            jwt_audience: DEFAULT_JWT_AUDIENCE.to_string(),
            access_token_ttl: 15 * 60,        // 15 分钟
            refresh_token_ttl: 7 * 24 * 3600, // 7 天
        }
    }

    /// 配置 JWT iss/aud
    pub fn with_claims_context(
        mut self,
        issuer: impl Into<String>,
        audience: impl Into<String>,
    ) -> Self {
        self.jwt_issuer = issuer.into();
        self.jwt_audience = audience.into();
        self
    }

    /// 配置 token 有效期
    pub fn with_ttl(mut self, access_ttl: i64, refresh_ttl: i64) -> Self {
        self.access_token_ttl = access_ttl;
        self.refresh_token_ttl = refresh_ttl;
        self
    }
}

// ============================================================================
// 内部辅助方法
// ============================================================================

impl UserManager {
    /// 确保 refresh_nonce 存在
    pub(super) fn ensure_refresh_nonce(user: &mut User) {
        if user.refresh_nonce.is_empty() {
            user.refresh_nonce = uuid::Uuid::new_v4().to_string();
        }
    }

    /// 轮换 refresh_nonce（用于撤销旧 token）
    pub(super) fn rotate_refresh_nonce(user: &mut User) {
        user.refresh_nonce = uuid::Uuid::new_v4().to_string();
    }

    /// 持久化用户数据
    pub(super) fn persist_user(&self, user: &User) -> Result<()> {
        let data = serde_json::to_vec_pretty(user)?;
        std::fs::write(self.user_path(&user.id), data)?;
        Ok(())
    }

    /// 用户名索引文件路径
    fn index_path(&self) -> PathBuf {
        self.users_dir().join("index.json")
    }

    /// 加载用户名 -> ID 索引
    fn load_username_index(&self) -> HashMap<String, String> {
        let path = self.index_path();
        if let Ok(data) = fs::read(&path) {
            if let Ok(map) = serde_json::from_slice::<HashMap<String, String>>(&data) {
                return map;
            }
        }
        HashMap::new()
    }

    /// 保存用户名索引
    fn save_username_index(&self, index: &HashMap<String, String>) -> Result<()> {
        let data = serde_json::to_vec_pretty(index)?;
        fs::write(self.index_path(), data)?;
        Ok(())
    }

    /// 确保用户目录存在
    pub fn ensure_dirs(&self) -> Result<()> {
        std::fs::create_dir_all(self.users_dir())?;
        Ok(())
    }

    /// 用户存储目录
    fn users_dir(&self) -> PathBuf {
        self.data_dir.join("users")
    }

    /// 用户文件路径
    fn user_path(&self, id: &str) -> PathBuf {
        self.users_dir().join(format!("{}.json", id))
    }
}

// ============================================================================
// 用户 CRUD 操作
// ============================================================================

impl UserManager {
    /// 创建用户
    #[instrument(skip(self, req))]
    pub async fn create_user(&self, req: CreateUserRequest) -> Result<User> {
        self.ensure_dirs()?;

        // 检查用户名是否已存在
        if self.find_by_username(&req.username).await?.is_some() {
            return Err(ServiceError::AlreadyExists(format!(
                "username: {}",
                req.username
            )));
        }

        Self::validate_password_strength(&req.password)?;
        let password_hash = hash_password(&req.password).await?;

        let now = Utc::now();
        let mut user = User {
            id: uuid::Uuid::new_v4().to_string(),
            username: req.username,
            password_hash,
            service_ids: req.service_ids,
            token_version: 0,
            refresh_nonce: String::new(),
            totp_config: None,
            created_at: Some(now),
            updated_at: Some(now),
        };
        Self::ensure_refresh_nonce(&mut user);

        // 保存
        self.persist_user(&user)?;
        let mut index = self.load_username_index();
        index.insert(user.username.clone(), user.id.clone());
        self.save_username_index(&index)?;

        info!(user_id = %user.id, username = %user.username, "created user");
        Ok(user)
    }

    /// 创建 DevToken 虚拟用户（用于存储 DevToken 的 2FA 配置）
    #[instrument(skip(self))]
    pub async fn create_devtoken_user(&self) -> Result<User> {
        self.ensure_dirs()?;

        // 使用固定密码哈希（DevToken 用户不需要密码登录）
        let password_hash = "$2b$12$AAAAAAAAAAAAAAAAAAAAAA".to_string();

        let now = Utc::now();
        let mut user = User {
            id: "__devtoken__".to_string(),
            username: "__devtoken__".to_string(),
            password_hash,
            service_ids: vec![],
            token_version: 0,
            refresh_nonce: String::new(),
            totp_config: None,
            created_at: Some(now),
            updated_at: Some(now),
        };
        Self::ensure_refresh_nonce(&mut user);

        // 保存
        self.persist_user(&user)?;
        let mut index = self.load_username_index();
        index.insert(user.username.clone(), user.id.clone());
        self.save_username_index(&index)?;

        info!("created __devtoken__ virtual user");
        Ok(user)
    }

    /// 获取用户
    #[instrument(skip(self))]
    pub async fn get_user(&self, id: &str) -> Result<User> {
        let path = self.user_path(id);
        if !path.exists() {
            return Err(ServiceError::NotFound(format!("user: {}", id)));
        }
        let data = std::fs::read(&path)?;
        let mut user: User = serde_json::from_slice(&data)?;
        let mut updated = false;
        if user.refresh_nonce.is_empty() {
            Self::ensure_refresh_nonce(&mut user);
            updated = true;
        }
        if updated {
            self.persist_user(&user)?;
        }
        Ok(user)
    }

    /// 通过用户名查找（优化：优先使用索引，避免全量扫描）
    #[instrument(skip(self))]
    pub async fn find_by_username(&self, username: &str) -> Result<Option<User>> {
        self.ensure_dirs()?;
        let index = self.load_username_index();

        // 优先从索引查找
        if let Some(id) = index.get(username) {
            match self.get_user(id).await {
                Ok(user) => return Ok(Some(user)),
                Err(ServiceError::NotFound(_)) => {
                    // 索引指向的用户不存在，需要清理索引
                    let mut index = index;
                    index.remove(username);
                    let _ = self.save_username_index(&index);
                }
                Err(e) => return Err(e),
            }
        }

        // 索引中没有，遍历用户目录（但不加载所有用户，只扫描文件名）
        let dir = self.users_dir();
        if !dir.exists() {
            return Ok(None);
        }

        // 逐个读取用户文件，找到匹配的用户名即停止
        let entries = std::fs::read_dir(&dir)?;
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false)
                && path.file_stem().map(|s| s != "index").unwrap_or(true)
            {
                if let Ok(data) = std::fs::read(&path) {
                    if let Ok(user) = serde_json::from_slice::<User>(&data) {
                        if user.username == username {
                            // 更新索引
                            let mut index = self.load_username_index();
                            index.insert(username.to_string(), user.id.clone());
                            let _ = self.save_username_index(&index);
                            return Ok(Some(user));
                        }
                    }
                }
            }
        }

        Ok(None)
    }

    /// 列出所有用户
    #[instrument(skip(self))]
    pub async fn list_users(&self) -> Result<Vec<User>> {
        self.ensure_dirs()?;
        let mut users = Vec::new();

        let dir = self.users_dir();
        if dir.exists() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let path = entry.path();
                // 跳过 index.json
                if path.file_stem().map(|s| s == "index").unwrap_or(false) {
                    continue;
                }
                if path.extension().map(|e| e == "json").unwrap_or(false) {
                    if let Ok(data) = std::fs::read(&path) {
                        if let Ok(mut user) = serde_json::from_slice::<User>(&data) {
                            // 过滤掉内部虚拟用户
                            if user.id == "__devtoken__" {
                                continue;
                            }
                            if user.refresh_nonce.is_empty() {
                                Self::ensure_refresh_nonce(&mut user);
                                let _ = self.persist_user(&user);
                            }
                            users.push(user);
                        }
                    }
                }
            }
        }

        Ok(users)
    }

    /// 更新用户
    #[instrument(skip(self, req))]
    pub async fn update_user(&self, id: &str, req: UpdateUserRequest) -> Result<User> {
        // 禁止修改内部虚拟用户
        if id == "__devtoken__" {
            return Err(ServiceError::PolicyViolation(
                "cannot update internal virtual user".into(),
            ));
        }

        let mut user = self.get_user(id).await?;

        let mut bumped = false;
        // 更新密码
        if let Some(password) = req.password {
            Self::validate_password_strength(&password)?;
            user.password_hash = hash_password(&password).await?;
            bumped = true;
        }

        // 更新服务权限
        if let Some(service_ids) = req.service_ids {
            user.service_ids = service_ids;
            bumped = true;
        }

        if bumped {
            user.token_version = user.token_version.saturating_add(1);
            Self::rotate_refresh_nonce(&mut user);
        }
        user.updated_at = Some(Utc::now());
        Self::ensure_refresh_nonce(&mut user);

        // 保存
        self.persist_user(&user)?;

        info!(user_id = %id, "updated user");
        Ok(user)
    }

    /// 删除用户
    #[instrument(skip(self))]
    pub async fn delete_user(&self, id: &str) -> Result<()> {
        // 禁止删除内部虚拟用户
        if id == "__devtoken__" {
            return Err(ServiceError::PolicyViolation(
                "cannot delete internal virtual user".into(),
            ));
        }

        let path = self.user_path(id);
        if !path.exists() {
            return Err(ServiceError::NotFound(format!("user: {}", id)));
        }
        std::fs::remove_file(&path)?;
        let mut index = self.load_username_index();
        index.retain(|_, uid| uid != id);
        self.save_username_index(&index)?;
        info!(user_id = %id, "deleted user");
        Ok(())
    }
}
