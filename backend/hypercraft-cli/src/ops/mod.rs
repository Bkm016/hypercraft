mod attach;
mod logs;
mod output;
mod services;
mod shell;
pub mod ui;
mod users;

pub use attach::attach_service;
pub use logs::logs_service;
pub use output::OutputFormat;
pub use services::schedule::{
    get_schedule, remove_schedule, set_schedule, toggle_schedule, ScheduleAction,
};
pub use services::{
    create_service, create_service_interactive, delete_service, get_service, list_services,
    restart_service, start_service, status_service, stop_service, update_service,
};
pub use shell::shell_loop;
pub use users::{
    add_user_service, create_user, delete_user, get_user, list_users, login, refresh_token,
    remove_user_service, set_user_services, update_user_password,
};
