//! Core library for process management: manifest storage, process lifecycle, status, and logs.

mod error;
mod manager;
mod manifest;
mod models;
pub mod user;

pub use error::{Result, ServiceError};
pub use manager::scheduler::ServiceScheduler;
pub use manager::{AttachHandle, ServiceManager, SystemStats};
pub use manifest::{Schedule, ScheduleAction, ServiceManifest};
pub use models::{ServiceGroup, ServiceState, ServiceStatus, ServiceSummary};
pub use user::{
    AuthToken, CreateUserRequest, LoginRequest, RefreshRequest, TokenClaims, TokenType,
    UpdateUserRequest, User, UserManager, UserSummary,
};

/// 初始化 tracing 日志系统
/// 
/// 使用环境变量 `RUST_LOG` 设置日志级别，默认为 `info`。
pub fn init_tracing() {
    use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

    let fmt_layer = tracing_subscriber::fmt::layer().with_target(false);
    let filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());
    tracing_subscriber::registry()
        .with(filter)
        .with(fmt_layer)
        .init();
}
