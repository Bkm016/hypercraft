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
    /// 默认服务列表可见的服务 ID（系统管理员控制权另由 is_admin 覆盖）
    #[serde(default)]
    pub service_ids: Vec<String>,
    /// 是否为系统管理员（可控制全部服务；默认列表仍按 service_ids）
    #[serde(default)]
    pub is_admin: bool,
    /// Token 版本号（用于撤销旧 token）
    #[serde(default)]
    pub token_version: u64,
    /// Refresh token 随机因子（用于单次刷新）
    #[serde(default)]
    pub refresh_nonce: String,
    /// 2FA 配置（可选）
    pub totp_config: Option<TotpConfig>,
    /// 创建时间
    pub created_at: Option<DateTime<Utc>>,
    /// 更新时间
    pub updated_at: Option<DateTime<Utc>>,
}

/// TOTP 2FA 配置
#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TotpConfig {
    /// TOTP secret（AES-256-GCM 加密后的 base64）
    pub secret: String,
    /// 是否已启用
    pub enabled: bool,
    /// 备用恢复码（bcrypt 哈希后）
    #[serde(default)]
    pub recovery_codes: Vec<String>,
    /// 启用时间
    pub enabled_at: Option<DateTime<Utc>>,
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
    /// 是否设为系统管理员（可选）
    pub is_admin: Option<bool>,
}

/// Token 类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TokenType {
    /// 开发者/管理员 token
    Dev,
    /// 普通用户 token
    User,
    /// Web 代理会话 token
    Web,
    /// 刷新 token
    Refresh,
    /// 长期 API Key（Agent / 自动化）
    ApiKey,
}

/// API Key 允许的 scope 名称
pub mod api_key_scopes {
    /// 列表 / 详情 / 状态
    pub const READ: &str = "read";
    /// 启停 / 重启 / 强杀
    pub const CONTROL: &str = "control";
    /// 创建 / 修改 / 删除服务定义
    pub const MANAGE: &str = "manage";
    /// 日志读取与跟随
    pub const LOGS: &str = "logs";
    /// WebSocket 终端 attach
    pub const ATTACH: &str = "attach";

    /// 全部合法 scope
    pub const ALL: &[&str] = &[READ, CONTROL, MANAGE, LOGS, ATTACH];

    /// 校验 scope 列表是否全部合法
    pub fn validate(scopes: &[String]) -> Result<(), String> {
        for s in scopes {
            if !ALL.contains(&s.as_str()) {
                return Err(format!("invalid scope: {}", s));
            }
        }
        Ok(())
    }
}

/// API Key 明文前缀
pub const API_KEY_RAW_PREFIX: &str = "hc_ak_";

/// 持久化的 API Key（哈希用于校验；加密明文可随时解密查看）
#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    /// Key 唯一 ID
    pub id: String,
    /// 展示名称
    pub name: String,
    /// 明文前缀（列表展示用，如 hc_ak_a1b2c3d4）
    pub key_prefix: String,
    /// 完整明文的 SHA-256 十六进制哈希
    pub key_hash: String,
    /// 加密后的完整明文（AES-GCM，可随时解密给管理员）
    #[serde(default)]
    pub encrypted_secret: Option<String>,
    /// 历史字段：旧版服务白名单；鉴权已忽略，仅兼容落盘 JSON
    #[serde(default)]
    pub service_ids: Vec<String>,
    /// 能力范围：read / control / manage / logs / attach
    #[serde(default)]
    pub scopes: Vec<String>,
    /// 创建者用户 ID
    pub created_by: String,
    /// 创建时间
    pub created_at: DateTime<Utc>,
    /// 最近使用时间
    pub last_used_at: Option<DateTime<Utc>>,
    /// 撤销时间（有值即失效）
    pub revoked_at: Option<DateTime<Utc>>,
    /// 过期时间（可选）
    pub expires_at: Option<DateTime<Utc>>,
}

/// 查看 API Key 明文响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeySecretResponse {
    pub id: String,
    pub name: String,
    pub secret: String,
}

/// 创建 API Key 请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub expires_at: Option<DateTime<Utc>>,
}

/// 更新 API Key 请求（不能改明文；改权限立即对后续请求生效）
#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateApiKeyRequest {
    pub name: Option<String>,
    pub scopes: Option<Vec<String>>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// API Key 对外摘要（无哈希）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeySummary {
    pub id: String,
    pub name: String,
    pub key_prefix: String,
    pub scopes: Vec<String>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
}

impl From<ApiKey> for ApiKeySummary {
    fn from(key: ApiKey) -> Self {
        Self {
            id: key.id,
            name: key.name,
            key_prefix: key.key_prefix,
            scopes: key.scopes,
            created_by: key.created_by,
            created_at: key.created_at,
            last_used_at: key.last_used_at,
            revoked_at: key.revoked_at,
            expires_at: key.expires_at,
        }
    }
}

/// 创建 API Key 响应（明文仅返回一次）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateApiKeyResponse {
    pub key: ApiKeySummary,
    /// 完整明文，仅创建时返回
    pub secret: String,
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
    /// 是否为系统管理员（管理用户，不旁路服务访问）
    #[serde(default)]
    pub is_admin: bool,
    /// Token 版本号，用于撤销旧 token（用户字段缺省时默认为 0）
    #[serde(default)]
    pub token_version: u64,
    /// Refresh token 专用随机值（单次使用）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_nonce: Option<String>,
    /// Web 代理会话绑定的单个服务 ID
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_id: Option<String>,
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
    /// TOTP 验证码（用户启用 2FA 后必填）
    pub totp_code: Option<String>,
}

/// DevToken 登录请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevTokenLoginRequest {
    pub dev_token: String,
    /// TOTP 验证码（DevToken 启用 2FA 后必填）
    pub totp_code: Option<String>,
}

/// 刷新请求
///
/// `refresh_token` 可省略：浏览器可依赖 HttpOnly cookie 续期；CLI 仍应在 JSON 中显式传值。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshRequest {
    #[serde(default)]
    pub refresh_token: Option<String>,
}

/// 用户列表项（不含敏感信息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSummary {
    pub id: String,
    pub username: String,
    pub service_ids: Vec<String>,
    /// 是否为系统管理员
    pub is_admin: bool,
    /// 是否启用了双因素认证
    pub totp_enabled: bool,
    pub created_at: Option<DateTime<Utc>>,
}

impl From<User> for UserSummary {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            username: user.username,
            service_ids: user.service_ids,
            is_admin: user.is_admin,
            totp_enabled: user
                .totp_config
                .as_ref()
                .map(|cfg| cfg.enabled)
                .unwrap_or(false),
            created_at: user.created_at,
        }
    }
}

/// 2FA 设置响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setup2FAResponse {
    /// TOTP secret（明文，仅此次返回）
    pub secret: String,
    /// QR code URI（otpauth:// 格式）
    pub qr_uri: String,
    /// 备用恢复码（明文，仅此次返回）
    pub recovery_codes: Vec<String>,
}

/// 2FA 启用请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Enable2FARequest {
    /// TOTP 验证码确认
    pub totp_code: String,
    /// TOTP secret（从 setup 响应中获取）
    pub secret: String,
    /// 备用恢复码（从 setup 响应中获取）
    pub recovery_codes: Vec<String>,
}

/// 2FA 禁用请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Disable2FARequest {
    /// 验证方式
    pub verification: TwoFactorVerification,
}

/// 双因素验证方式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum TwoFactorVerification {
    Totp { code: String },
    Recovery { code: String },
}

/// 2FA 设置请求（无需参数，从 JWT 获取用户信息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setup2FARequest {}
