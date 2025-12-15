//! JWT 认证：登录、刷新、验证、签发 token

use super::crypto::verify_password;
use super::models::*;
use super::UserManager;
use crate::error::{Result, ServiceError};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use tracing::{info, instrument, warn};

impl UserManager {
    /// 用户登录
    #[instrument(skip(self, password))]
    pub async fn login(&self, username: &str, password: &str) -> Result<AuthToken> {
        let user = self
            .find_by_username(username)
            .await?
            .ok_or_else(|| ServiceError::Unauthorized("invalid credentials".into()))?;

        // 验证密码
        let valid = verify_password(password, &user.password_hash).await?;

        if !valid {
            warn!(username = %username, "login failed: invalid password");
            return Err(ServiceError::Unauthorized("invalid credentials".into()));
        }

        info!(user_id = %user.id, username = %username, "user logged in");
        self.issue_tokens(user, true)
    }

    /// 刷新 token
    #[instrument(skip(self, refresh_token))]
    pub async fn refresh(&self, refresh_token: &str) -> Result<AuthToken> {
        // 验证 refresh token
        let claims = self.verify_token(refresh_token).await?;

        if claims.token_type != TokenType::Refresh {
            return Err(ServiceError::Unauthorized("invalid token type".into()));
        }

        // 获取最新用户信息（若密码/权限已变更会触发 token_version 不匹配）
        let user = self.get_user(&claims.sub).await?;

        info!(user_id = %user.id, "token refreshed");
        self.issue_tokens(user, true)
    }

    /// 生成 access token 和 refresh token
    pub(super) fn issue_tokens(&self, mut user: User, rotate_refresh: bool) -> Result<AuthToken> {
        let now = Utc::now();
        let access_exp = now + Duration::seconds(self.access_token_ttl);
        let refresh_exp = now + Duration::seconds(self.refresh_token_ttl);
        if rotate_refresh || user.refresh_nonce.is_empty() {
            Self::rotate_refresh_nonce(&mut user);
            user.updated_at = Some(now);
            self.persist_user(&user)?;
        }

        // Access token claims
        let access_claims = TokenClaims {
            sub: user.id.clone(),
            username: user.username.clone(),
            iss: Some(self.jwt_issuer.clone()),
            aud: Some(self.jwt_audience.clone()),
            token_type: TokenType::User,
            service_ids: user.service_ids.clone(),
            token_version: user.token_version,
            refresh_nonce: None,
            exp: access_exp.timestamp(),
            iat: now.timestamp(),
        };

        // Refresh token claims
        let refresh_claims = TokenClaims {
            sub: user.id.clone(),
            username: user.username.clone(),
            iss: Some(self.jwt_issuer.clone()),
            aud: Some(self.jwt_audience.clone()),
            token_type: TokenType::Refresh,
            service_ids: vec![],
            token_version: user.token_version,
            refresh_nonce: Some(user.refresh_nonce.clone()),
            exp: refresh_exp.timestamp(),
            iat: now.timestamp(),
        };

        let access_token = encode(
            &Header::default(),
            &access_claims,
            &EncodingKey::from_secret(self.jwt_secret.as_bytes()),
        )
        .map_err(|e| ServiceError::Other(e.to_string()))?;

        let refresh_token = encode(
            &Header::default(),
            &refresh_claims,
            &EncodingKey::from_secret(self.jwt_secret.as_bytes()),
        )
        .map_err(|e| ServiceError::Other(e.to_string()))?;

        Ok(AuthToken {
            access_token,
            refresh_token,
            expires_in: self.access_token_ttl,
            token_type: "Bearer".to_string(),
        })
    }

    /// 验证 JWT token
    pub async fn verify_token(&self, token: &str) -> Result<TokenClaims> {
        let mut validation = Validation::default();
        validation.set_audience(&[self.jwt_audience.clone()]);
        validation.set_issuer(&[self.jwt_issuer.clone()]);
        let token_data = decode::<TokenClaims>(
            token,
            &DecodingKey::from_secret(self.jwt_secret.as_bytes()),
            &validation,
        )
        .map_err(|e| ServiceError::Unauthorized(format!("invalid token: {}", e)))?;

        let claims = token_data.claims;
        let refresh_nonce = claims.refresh_nonce.clone();
        // 拒绝通过 JWT 伪造的 Dev token
        if claims.token_type == TokenType::Dev {
            return Err(ServiceError::Unauthorized(
                "dev token via jwt is not allowed".into(),
            ));
        }

        // 校验 token version 以支持撤销
        let user = self.get_user(&claims.sub).await?;
        if claims.token_version != user.token_version {
            return Err(ServiceError::Unauthorized("token revoked".into()));
        }

        if claims.token_type == TokenType::Refresh {
            let nonce = refresh_nonce
                .as_deref()
                .ok_or_else(|| ServiceError::Unauthorized("refresh token missing nonce".into()))?;
            if nonce != user.refresh_nonce {
                return Err(ServiceError::Unauthorized("refresh token revoked".into()));
            }
        }

        Ok(claims)
    }

    /// 生成 DevToken claims（用于验证）
    pub fn dev_token_claims() -> TokenClaims {
        TokenClaims {
            sub: "dev".to_string(),
            username: "admin".to_string(),
            iss: None,
            aud: None,
            token_type: TokenType::Dev,
            service_ids: vec![],
            token_version: 0,
            refresh_nonce: None,
            exp: i64::MAX,
            iat: 0,
        }
    }
}
