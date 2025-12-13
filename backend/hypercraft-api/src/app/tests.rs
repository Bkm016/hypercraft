use super::{app_router, AppState};
use axum::body::Body;
use axum::http::{Request, StatusCode};
use hypercraft_core::{ServiceManager, ServiceScheduler, UserManager};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tower::ServiceExt;

#[tokio::test]
async fn health_ok_without_auth() {
    let dir = TempDir::new().unwrap();
    let manager = Arc::new(ServiceManager::new(dir.path()));
    manager.ensure_base_dirs().unwrap();
    let user_manager = Arc::new(UserManager::new(dir.path(), "test-secret".into()));
    user_manager.ensure_dirs().unwrap();
    let scheduler = Arc::new(ServiceScheduler::new((*manager).clone()));
    let state = AppState {
        manager,
        user_manager,
        scheduler,
        dev_token: None,
        login_limiter: Arc::new(crate::app::RateLimiter::new(100, Duration::from_secs(60))),
        refresh_limiter: Arc::new(crate::app::RateLimiter::new(100, Duration::from_secs(60))),
    };
    let app = app_router(state, Vec::new());
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}
