mod agent;
mod api_keys;
mod attach;
mod auth;
mod groups;
mod health;
mod logs;
mod services;
mod stats;
mod two_factor;
mod users;
mod web;

pub use agent::{
    agent_attach, agent_create_service, agent_delete_service, agent_get_service, agent_get_status,
    agent_help, agent_kill, agent_list_services, agent_logs, agent_me, agent_restart,
    agent_shutdown, agent_start, agent_stop, agent_update_service,
};
pub use api_keys::{
    create_api_key, get_api_key, list_api_keys, reveal_api_key_secret, revoke_api_key,
    rotate_api_key, update_api_key,
};
pub use attach::attach_service;
pub use auth::{devtoken_login, get_me, login, logout, refresh};
pub use groups::{
    create_group, delete_group, list_groups, reorder_groups, reorder_services, update_group,
    update_service_group, update_service_tags,
};
pub use health::{handler_404, health};
pub use logs::{download_log_file, get_logs};
pub use services::{
    create_service, delete_service, get_schedule, get_service, get_status, kill_service,
    list_services, restart_service, shutdown_service, start_service, stop_service, update_schedule,
    update_service, validate_cron,
};
pub use stats::get_system_stats;
pub use two_factor::{disable_2fa, enable_2fa, setup_2fa, verify_user_2fa};
pub use users::{
    add_user_service, change_password, create_user, delete_user, get_user, list_users,
    remove_user_service, set_user_services, update_user,
};
pub use web::create_web_session;
