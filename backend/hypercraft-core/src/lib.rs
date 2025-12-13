//! Core library for process management: manifest storage, process lifecycle, status, and logs.

mod error;
mod manager;
mod manifest;
mod models;
pub mod user;

pub use error::{Result, ServiceError};
pub use manager::scheduler::ServiceScheduler;
pub use manager::{AttachHandle, ProcessStats, ServiceManager, SystemStats};
pub use manifest::{Schedule, ScheduleAction, ServiceManifest};
pub use models::{ServiceGroup, ServiceState, ServiceStatus, ServiceSummary};
pub use user::{
    AuthToken, CreateUserRequest, LoginRequest, RefreshRequest, TokenClaims, TokenType,
    UpdateUserRequest, User, UserManager, UserSummary,
};
