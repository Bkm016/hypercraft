use thiserror::Error;

/// Common result type for core operations.
pub type Result<T> = std::result::Result<T, ServiceError>;

#[derive(Debug, Error)]
pub enum ServiceError {
    #[error("service not found: {0}")]
    NotFound(String),
    #[error("service already exists: {0}")]
    AlreadyExists(String),
    #[error("service already running: {0}")]
    AlreadyRunning(String),
    #[error("service not running: {0}")]
    NotRunning(String),
    #[error("invalid service id")]
    InvalidId,
    #[error("policy violation: {0}")]
    PolicyViolation(String),
    #[error("invalid schedule: {0}")]
    InvalidSchedule(String),
    #[error("failed to spawn process: {0}")]
    SpawnFailed(String),
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    #[error("two-factor authentication required: {0}")]
    TwoFactorRequired(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("other error: {0}")]
    Other(String),
}
