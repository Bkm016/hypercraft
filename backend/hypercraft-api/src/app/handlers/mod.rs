mod attach;
mod auth;
mod groups;
mod health;
mod logs;
mod services;
mod stats;
mod users;

pub use attach::attach_service;
pub use auth::{login, refresh};
pub use groups::{
    create_group, delete_group, list_groups, reorder_groups, reorder_services, update_group,
    update_service_group, update_service_tags,
};
pub use health::health;
pub use logs::{download_log_file, get_logs};
pub use services::{
    create_service, delete_service, get_schedule, get_service, get_status, kill_service,
    list_services, restart_service, shutdown_service, start_service, stop_service, update_schedule,
    update_service, validate_cron,
};
pub use stats::get_system_stats;
pub use users::{
    add_user_service, change_password, create_user, delete_user, get_user, list_users,
    remove_user_service, set_user_services, update_user,
};
