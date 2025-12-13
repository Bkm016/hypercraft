//! 用户数据模型

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

/// 用户账户（存储模型，包含密码哈希）
#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    /// 用户唯一 ID (UUID)
    pub id: String,
    /// 用户名（唯一，用于登录）
    pub username: String,
    /// bcrypt 哈希后的密码
    pub password_hash: String,
    /// 用户可访问的服务 ID 列表
    #[serde(default)]
    pub service_ids: Vec<String>,
    /// Token 版本号（用于撤销旧 token）
    #[serde(default)]
    pub token_version: u64,
    /// Refresh token 随机因子（用于单次刷新）
    #[serde(default)]
    pub refresh_nonce: String,
    /// 创建时间
    pub created_at: Option<DateTime<Utc>>,
    /// 更新时间
    pub updated_at: Option<DateTime<Utc>>,
}

/// 创建用户请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub service_ids: Vec<String>,
}

/// 更新用户请求
#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserRequest {
    /// 新密码（可选）
    pub password: Option<String>,
    /// 新的服务 ID 列表（可选）
    pub service_ids: Option<Vec<String>>,
}

/// Token 类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TokenType {
    /// 开发者/管理员 token
    Dev,
    /// 普通用户 token
    User,
    /// 刷新 token
    Refresh,
}

/// JWT Claims 结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenClaims {
    /// Subject: 用户 ID 或 "dev"
    pub sub: String,
    /// 用户名
    pub username: String,
    /// JWT issuer
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iss: Option<String>,
    /// JWT audience
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aud: Option<String>,
    /// Token 类型
    pub token_type: TokenType,
    /// 用户可访问的服务 ID 列表（仅 User token）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub service_ids: Vec<String>,
    /// Token 版本号，用于撤销旧 token（用户字段缺省时默认为 0）
    #[serde(default)]
    pub token_version: u64,
    /// Refresh token 专用随机值（单次使用）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_nonce: Option<String>,
    /// 过期时间戳 (Unix timestamp)
    pub exp: i64,
    /// 签发时间戳 (Unix timestamp)
    pub iat: i64,
}

/// 认证响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthToken {
    /// Access token (JWT)
    pub access_token: String,
    /// Refresh token (JWT)
    pub refresh_token: String,
    /// Access token 过期时间（秒）
    pub expires_in: i64,
    /// Token 类型
    pub token_type: String,
}

/// 登录请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

/// 刷新请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

/// 用户列表项（不含敏感信息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSummary {
    pub id: String,
    pub username: String,
    pub service_ids: Vec<String>,
    pub created_at: Option<DateTime<Utc>>,
}

impl From<User> for UserSummary {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            username: user.username,
            service_ids: user.service_ids,
            created_at: user.created_at,
        }
    }
}
