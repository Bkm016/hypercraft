use axum::middleware::from_fn_with_state;
use axum::routing::{get, patch, post, put};
use axum::Router;
use axum::http::{header, HeaderName, HeaderValue, Method};
use tower_http::cors::{AllowOrigin, CorsLayer};

use super::handlers::{
    add_user_service, agent_attach, agent_create_group, agent_create_service, agent_delete_group,
    agent_delete_service, agent_get_service, agent_get_status, agent_help, agent_kill,
    agent_list_groups, agent_list_services, agent_logs, agent_me, agent_reorder_groups,
    agent_restart, agent_shutdown, agent_start, agent_stop, agent_update_group,
    agent_update_service, attach_service, change_password, create_api_key, create_group,
    create_service, create_user, create_web_session, delete_group, delete_service, delete_user,
    devtoken_login, disable_2fa, download_log_file, enable_2fa, get_api_key, get_logs, get_me,
    get_schedule, get_service, get_status, get_system_stats, get_user, handler_404, health,
    kill_service, list_api_keys, list_assignable_services, list_groups, list_services, list_users,
    login, logout, refresh, remove_user_service, reorder_groups, reorder_services, restart_service,
    reveal_api_key_secret, revoke_api_key, rotate_api_key, set_user_services, setup_2fa,
    shutdown_service, start_service, stop_service, update_api_key, update_group, update_schedule,
    update_service,
    update_service_group, update_service_tags, update_user, validate_cron,
};
use super::middleware::{auth_middleware, web_gateway_middleware};
use super::state::AppState;

/// 根据配置的来源列表构建 CorsLayer
///
/// Cookie 会话需要 credentials=true，因此不能使用 AllowOrigin::any()。
/// 未配置时默认放行本地前端端口，生产环境应显式设置 HC_CORS_ORIGINS。
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
            HeaderName::from_static("x-hypercraft-csrf"),
        ])
        .allow_credentials(true);

    let origins_src = if cors_origins.is_empty() {
        tracing::warn!(
            "HC_CORS_ORIGINS 没有配置，默认允许 http://localhost:3000 与 http://127.0.0.1:3000；生产环境请显式配置。"
        );
        vec![
            "http://localhost:3000".to_string(),
            "http://127.0.0.1:3000".to_string(),
        ]
    } else {
        cors_origins
    };

    let origins: Vec<HeaderValue> = origins_src
        .into_iter()
        .filter_map(|o| o.parse().ok())
        .collect();
    base.allow_origin(AllowOrigin::list(origins))
}

/// Build the router with routes and middleware wired.
pub fn app_router(state: AppState, cors_origins: Vec<String>) -> Router {
    // 公开端点（不需要认证）
    let public_routes = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(login))
        .route("/auth/devtoken", post(devtoken_login))
        .route("/auth/refresh", post(refresh))
        .route("/auth/logout", post(logout));

    // 用户管理端点（需要管理员权限，由 handler 中的 RequireAdmin extractor 检查）
    let admin_routes = Router::new()
        .route("/users", get(list_users).post(create_user))
        .route("/users/service-catalog", get(list_assignable_services))
        .route(
            "/users/:id",
            get(get_user).put(update_user).delete(delete_user),
        )
        .route("/users/:id/services", put(set_user_services))
        .route(
            "/users/:user_id/services/:service_id",
            post(add_user_service).delete(remove_user_service),
        )
        .route("/api-keys", get(list_api_keys).post(create_api_key))
        .route(
            "/api-keys/:id",
            get(get_api_key).put(update_api_key).delete(revoke_api_key),
        )
        .route("/api-keys/:id/secret", get(reveal_api_key_secret))
        .route("/api-keys/:id/rotate", post(rotate_api_key));

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
        .route("/services/:id/web/session", post(create_web_session))
        .route("/services/:id/tags", patch(update_service_tags))
        .route("/services/:id/group", patch(update_service_group))
        .route(
            "/services/:id/schedule",
            get(get_schedule).put(update_schedule),
        )
        .route("/schedule/validate", post(validate_cron));

    // Agent 薄封装（API Key / JWT 均可；默认文本日志）
    let agent_routes = Router::new()
        .route("/agent/me", get(agent_me))
        .route("/agent/help", get(agent_help))
        .route(
            "/agent/services",
            get(agent_list_services).post(agent_create_service),
        )
        .route(
            "/agent/services/:id",
            get(agent_get_service)
                .put(agent_update_service)
                .delete(agent_delete_service),
        )
        .route("/agent/services/:id/status", get(agent_get_status))
        .route("/agent/services/:id/start", post(agent_start))
        .route("/agent/services/:id/stop", post(agent_stop))
        .route("/agent/services/:id/restart", post(agent_restart))
        .route("/agent/services/:id/shutdown", post(agent_shutdown))
        .route("/agent/services/:id/kill", post(agent_kill))
        .route("/agent/services/:id/logs", get(agent_logs))
        .route("/agent/services/:id/attach", get(agent_attach))
        .route(
            "/agent/groups",
            get(agent_list_groups).post(agent_create_group),
        )
        .route("/agent/groups/reorder", post(agent_reorder_groups))
        .route(
            "/agent/groups/:id",
            patch(agent_update_group).delete(agent_delete_group),
        );

    // 分组端点
    let group_routes = Router::new()
        .route("/groups", get(list_groups).post(create_group))
        .route("/groups/reorder", post(reorder_groups))
        .route("/groups/:id", patch(update_group).delete(delete_group))
        .route("/services/reorder", post(reorder_services));

    // 资源统计端点（仅系统级）
    let stats_routes = Router::new()
        .route("/stats/system", get(get_system_stats));

    // 密码更新（认证 + 自己或管理员）
    let password_routes = Router::new().route("/users/:id/password", post(change_password));

    // 2FA 管理端点（需要认证）
    let two_factor_routes = Router::new()
        .route("/auth/2fa/setup", post(setup_2fa))
        .route("/auth/2fa/enable", post(enable_2fa))
        .route("/auth/2fa/disable", post(disable_2fa))
        .route("/auth/me", get(get_me));

    // 需要认证的路由（经过 auth_middleware）
    let protected_routes = Router::new()
        .merge(admin_routes)
        .merge(service_routes)
        .merge(agent_routes)
        .merge(group_routes)
        .merge(stats_routes)
        .merge(password_routes)
        .merge(two_factor_routes)
        .layer(from_fn_with_state(state.clone(), auth_middleware));

    // 组合所有路由（公开路由 + 受保护路由 + fallback）
    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .fallback(handler_404)
        .layer(build_cors_layer(cors_origins))
        .layer(from_fn_with_state(state.clone(), web_gateway_middleware))
        .with_state(state)
}
