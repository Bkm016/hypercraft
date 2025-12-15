use axum::middleware::from_fn_with_state;
use axum::routing::{get, patch, post, put};
use axum::Router;
use axum::http::{header, HeaderValue, Method};
use tower_http::cors::{AllowOrigin, CorsLayer};

use super::handlers::{
    add_user_service, attach_service, change_password, create_group, create_service, create_user,
    delete_group, delete_service, delete_user, download_log_file, get_logs, get_process_stats,
    get_schedule, get_service, get_status, get_system_stats, get_user, health, kill_service,
    list_groups, list_services, list_users, login, refresh, remove_user_service, reorder_groups,
    reorder_services, restart_service, set_user_services, shutdown_service, start_service,
    stop_service, update_group, update_schedule, update_service, update_service_group,
    update_service_tags, update_user, validate_cron,
};
use super::middleware::auth_middleware;
use super::state::AppState;

/// 根据配置的来源列表构建 CorsLayer
fn build_cors_layer(cors_origins: Vec<String>) -> CorsLayer {
    let base = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::ACCEPT,
        ])
        .allow_credentials(true);

    if cors_origins.is_empty() {
        // 未配置时允许所有来源（开发环境友好，但生产环境应配置 HC_CORS_ORIGINS）
        tracing::warn!(
            "HC_CORS_ORIGINS not configured, allowing all origins. \
             Set HC_CORS_ORIGINS in production for security."
        );
        base.allow_origin(AllowOrigin::any())
            .allow_credentials(false) // any() 不能与 credentials(true) 共用
    } else {
        // 指定来源列表
        let origins: Vec<HeaderValue> = cors_origins
            .into_iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        base.allow_origin(origins)
    }
}

/// Build the router with routes and middleware wired.
pub fn app_router(state: AppState, cors_origins: Vec<String>) -> Router {
    // 公开端点（不需要认证）
    let public_routes = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(login))
        .route("/auth/refresh", post(refresh));

    // 用户管理端点（需要管理员权限，由 handler 中的 RequireAdmin extractor 检查）
    let admin_routes = Router::new()
        .route("/users", get(list_users).post(create_user))
        .route(
            "/users/:id",
            get(get_user).put(update_user).delete(delete_user),
        )
        .route("/users/:id/services", put(set_user_services))
        .route(
            "/users/:user_id/services/:service_id",
            post(add_user_service).delete(remove_user_service),
        );

    // 服务端点（需要认证，权限由 handler 检查）
    let service_routes = Router::new()
        .route("/services", get(list_services).post(create_service))
        .route(
            "/services/:id",
            get(get_service).delete(delete_service).put(update_service),
        )
        .route("/services/:id/start", post(start_service))
        .route("/services/:id/stop", post(stop_service))
        .route("/services/:id/shutdown", post(shutdown_service))
        .route("/services/:id/kill", post(kill_service))
        .route("/services/:id/restart", post(restart_service))
        .route("/services/:id/status", get(get_status))
        .route("/services/:id/logs", get(get_logs))
        .route("/services/:id/log-file", get(download_log_file))
        .route("/services/:id/attach", get(attach_service))
        .route("/services/:id/tags", patch(update_service_tags))
        .route("/services/:id/group", patch(update_service_group))
        .route(
            "/services/:id/schedule",
            get(get_schedule).put(update_schedule),
        )
        .route("/schedule/validate", post(validate_cron));

    // 分组端点
    let group_routes = Router::new()
        .route("/groups", get(list_groups).post(create_group))
        .route("/groups/reorder", post(reorder_groups))
        .route("/groups/:id", patch(update_group).delete(delete_group))
        .route("/services/reorder", post(reorder_services));

    // 资源统计端点
    let stats_routes = Router::new()
        .route("/stats/system", get(get_system_stats))
        .route("/stats/processes", get(get_process_stats));

    // 密码更新（认证 + 自己或管理员）
    let password_routes = Router::new().route("/users/:id/password", post(change_password));

    // 组合所有路由
    Router::new()
        .merge(public_routes)
        .merge(admin_routes)
        .merge(service_routes)
        .merge(group_routes)
        .merge(stats_routes)
        .merge(password_routes)
        .layer(from_fn_with_state(state.clone(), auth_middleware))
        .layer(build_cors_layer(cors_origins))
        .with_state(state)
}
