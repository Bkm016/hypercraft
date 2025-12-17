use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use hypercraft_core::ServiceError;
use serde_json::json;

#[derive(Debug)]
pub struct ApiError {
    code: &'static str,
    message: String,
    status: StatusCode,
}

impl ApiError {
    pub fn new(code: &'static str, status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            code,
            status,
            message: message.into(),
        }
    }

    pub fn unauthorized() -> Self {
        Self::new("Unauthorized", StatusCode::UNAUTHORIZED, "unauthorized")
    }

    pub fn unauthorized_with_message(message: impl Into<String>) -> Self {
        Self::new("Unauthorized", StatusCode::UNAUTHORIZED, message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new("Forbidden", StatusCode::FORBIDDEN, message)
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new("BadRequest", StatusCode::BAD_REQUEST, message)
    }

    pub fn too_many_requests(message: impl Into<String>) -> Self {
        Self::new(
            "TooManyRequests",
            StatusCode::TOO_MANY_REQUESTS,
            message,
        )
    }
}

impl From<ServiceError> for ApiError {
    fn from(err: ServiceError) -> Self {
        match err {
            ServiceError::NotFound(id) => {
                ApiError::new("NotFound", StatusCode::NOT_FOUND, format!("{id} not found"))
            }
            ServiceError::AlreadyExists(id) => ApiError::new(
                "AlreadyExists",
                StatusCode::CONFLICT,
                format!("{id} already exists"),
            ),
            ServiceError::AlreadyRunning(id) => ApiError::new(
                "AlreadyRunning",
                StatusCode::CONFLICT,
                format!("service {id} already running"),
            ),
            ServiceError::NotRunning(id) => ApiError::new(
                "NotRunning",
                StatusCode::CONFLICT,
                format!("service {id} not running"),
            ),
            ServiceError::InvalidId => {
                ApiError::new("InvalidId", StatusCode::BAD_REQUEST, "invalid id")
            }
            ServiceError::PolicyViolation(msg) => {
                ApiError::new("PolicyViolation", StatusCode::BAD_REQUEST, msg)
            }
            ServiceError::InvalidSchedule(msg) => {
                ApiError::new("InvalidSchedule", StatusCode::BAD_REQUEST, msg)
            }
            ServiceError::SpawnFailed(msg) => {
                ApiError::new("SpawnFailed", StatusCode::INTERNAL_SERVER_ERROR, msg)
            }
            ServiceError::Io(e) => {
                ApiError::new("IoError", StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
            }
            ServiceError::Serde(e) => {
                ApiError::new("SerdeError", StatusCode::BAD_REQUEST, e.to_string())
            }
            ServiceError::Unauthorized(msg) => {
                ApiError::new("Unauthorized", StatusCode::UNAUTHORIZED, msg)
            }
            ServiceError::TwoFactorRequired(msg) => {
                ApiError::new("2FA_REQUIRED", StatusCode::UNAUTHORIZED, msg)
            }
            ServiceError::Other(msg) => {
                ApiError::new("Error", StatusCode::INTERNAL_SERVER_ERROR, msg)
            }
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(json!({
            "code": self.code,
            "message": self.message,
        }));
        (self.status, body).into_response()
    }
}
