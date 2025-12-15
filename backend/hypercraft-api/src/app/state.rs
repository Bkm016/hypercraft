use hypercraft_core::{ServiceManager, ServiceScheduler, UserManager};
use std::sync::Arc;

/// Shared application state for handlers.
#[derive(Clone)]
pub struct AppState {
    pub manager: Arc<ServiceManager>,
    pub user_manager: Arc<UserManager>,
    /// 定时调度器
    pub scheduler: Arc<ServiceScheduler>,
    /// DevToken（管理员 token，可以管理所有资源）
    pub dev_token: Option<String>,
    /// 登录接口限流（按 IP）
    pub login_limiter: Arc<crate::app::RateLimiter>,
    /// 刷新接口限流（按 IP）
    pub refresh_limiter: Arc<crate::app::RateLimiter>,
    /// Token 认证限流（按 IP，防止 DevToken 暴力破解）
    pub auth_limiter: Arc<crate::app::RateLimiter>,
    /// 密码修改限流（按用户 ID，防止暴力破解当前密码）
    pub password_limiter: Arc<crate::app::RateLimiter>,
}
