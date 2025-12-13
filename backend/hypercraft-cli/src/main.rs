mod client;
mod ops;

use clap::{Parser, Subcommand};
use ops::{
    add_user_service, attach_service, create_service, create_service_interactive, create_user,
    delete_service, delete_user, get_schedule, get_service, get_user, list_services, list_users,
    login, logs_service, refresh_token, remove_schedule, remove_user_service, restart_service,
    set_schedule, set_user_services, shell_loop, start_service, status_service, stop_service,
    toggle_schedule, update_service, update_user_password, OutputFormat, ScheduleAction,
};
use std::path::PathBuf;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// CLI wrapper around the Hypercraft HTTP API.
#[derive(Parser)]
#[command(
    name = "hypercraft-cli",
    author,
    version,
    about = "CLI for Hypercraft API"
)]
struct Cli {
    /// API base url
    #[arg(long, env = "HC_API_BASE", default_value = "http://127.0.0.1:8080")]
    api_base: String,

    /// Bearer token for authentication
    #[arg(long, env = "HC_DEV_TOKEN")]
    token: Option<String>,

    /// Output format
    #[arg(long, value_enum, default_value = "table")]
    output: OutputFormat,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    // ==================== 服务管理 ====================
    /// List services
    List,
    /// Show service manifest + status
    Get { id: String },
    /// Create service（文件或交互式引导）
    Create {
        /// manifest 文件路径
        file: Option<PathBuf>,
        /// 交互式创建
        #[arg(long, short)]
        interactive: bool,
    },
    /// 进入交互 shell（hc>）
    Shell,
    /// Delete a service
    Delete { id: String },
    /// Restart a service
    Restart { id: String },
    /// Update service manifest from file
    Update { id: String, file: PathBuf },
    /// Start a service
    Start { id: String },
    /// Stop a service
    Stop { id: String },
    /// Show status
    Status { id: String },
    /// Show logs (tail)
    Logs {
        id: String,
        #[arg(long, default_value_t = 200)]
        tail: usize,
        /// 持续跟随
        #[arg(long, default_value_t = false)]
        follow: bool,
    },
    /// attach 到服务终端（WebSocket）
    Attach { id: String },

    // ==================== 定时调度 ====================
    /// 定时调度管理命令
    #[command(subcommand)]
    Schedule(ScheduleCommands),

    // ==================== 认证 ====================
    /// 用户登录，获取 access token
    Login {
        /// 用户名
        #[arg(long, short)]
        username: String,
        /// 密码
        #[arg(long, short)]
        password: String,
    },
    /// 刷新 access token
    Refresh {
        /// Refresh token
        #[arg(long, short)]
        refresh_token: String,
    },

    // ==================== 用户管理（仅管理员）====================
    /// 用户管理命令
    #[command(subcommand)]
    User(UserCommands),
}

#[derive(Subcommand)]
enum ScheduleCommands {
    /// 查看服务的定时配置
    Get {
        /// 服务 ID
        id: String,
    },
    /// 设置服务的定时配置
    Set {
        /// 服务 ID
        id: String,
        /// Cron 表达式 (秒 分 时 日 月 周)
        /// 示例: "0 0 8 * * *" 每天 08:00
        #[arg(long, short)]
        cron: String,
        /// 触发动作: start, restart, stop
        #[arg(long, short, default_value = "start")]
        action: String,
        /// 是否启用（默认启用）
        #[arg(long, default_value_t = true)]
        enabled: bool,
    },
    /// 移除服务的定时配置
    Remove {
        /// 服务 ID
        id: String,
    },
    /// 启用服务的定时任务
    Enable {
        /// 服务 ID
        id: String,
    },
    /// 禁用服务的定时任务
    Disable {
        /// 服务 ID
        id: String,
    },
}

#[derive(Subcommand)]
enum UserCommands {
    /// 列出所有用户
    List,
    /// 获取用户详情
    Get {
        /// 用户 ID
        id: String,
    },
    /// 创建用户
    Create {
        /// 用户名
        #[arg(long, short)]
        username: String,
        /// 密码
        #[arg(long, short)]
        password: String,
        /// 可访问的服务 ID 列表
        #[arg(long, short, value_delimiter = ',')]
        services: Option<Vec<String>>,
    },
    /// 删除用户
    Delete {
        /// 用户 ID
        id: String,
    },
    /// 更新用户密码
    Password {
        /// 用户 ID
        id: String,
        /// 新密码
        #[arg(long, short)]
        password: String,
        /// 当前密码（非管理员必填）
        #[arg(long)]
        current: Option<String>,
    },
    /// 设置用户的服务权限
    SetServices {
        /// 用户 ID
        id: String,
        /// 服务 ID 列表
        #[arg(long, short, value_delimiter = ',')]
        services: Vec<String>,
    },
    /// 添加用户服务权限
    Grant {
        /// 用户 ID
        user_id: String,
        /// 服务 ID
        service_id: String,
    },
    /// 移除用户服务权限
    Revoke {
        /// 用户 ID
        user_id: String,
        /// 服务 ID
        service_id: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 加载 .env 文件（如果存在），忽略错误
    let _ = dotenvy::dotenv();
    init_tracing();
    let cli = Cli::parse();
    let client = client::build_client(&cli.token)?;

    match cli.command {
        // 服务管理命令
        Commands::List => list_services(&client, &cli.api_base, cli.output).await?,
        Commands::Get { id } => get_service(&client, &cli.api_base, &id, cli.output).await?,
        Commands::Create { file, interactive } => {
            if interactive {
                create_service_interactive(&client, &cli.api_base, cli.output).await?
            } else if let Some(path) = file {
                create_service(&client, &cli.api_base, path, cli.output).await?
            } else {
                anyhow::bail!("请提供 --file 或使用 --interactive");
            }
        }
        Commands::Shell => {
            shell_loop(&client, &cli.api_base, cli.output, cli.token.as_deref()).await?
        }
        Commands::Delete { id } => delete_service(&client, &cli.api_base, &id).await?,
        Commands::Start { id } => start_service(&client, &cli.api_base, &id, cli.output).await?,
        Commands::Stop { id } => stop_service(&client, &cli.api_base, &id, cli.output).await?,
        Commands::Status { id } => status_service(&client, &cli.api_base, &id, cli.output).await?,
        Commands::Restart { id } => {
            restart_service(&client, &cli.api_base, &id, cli.output).await?
        }
        Commands::Update { id, file } => {
            update_service(&client, &cli.api_base, &id, file, cli.output).await?
        }
        Commands::Logs { id, tail, follow } => {
            logs_service(&client, &cli.api_base, &id, tail, follow, cli.output).await?
        }
        Commands::Attach { id } => attach_service(&cli.api_base, &id, cli.token.as_deref()).await?,

        // 定时调度命令
        Commands::Schedule(sched_cmd) => match sched_cmd {
            ScheduleCommands::Get { id } => {
                get_schedule(&client, &cli.api_base, &id, cli.output).await?
            }
            ScheduleCommands::Set {
                id,
                cron,
                action,
                enabled,
            } => {
                let action: ScheduleAction = action.parse().map_err(|e: String| anyhow::anyhow!(e))?;
                set_schedule(&client, &cli.api_base, &id, &cron, action, enabled, cli.output)
                    .await?
            }
            ScheduleCommands::Remove { id } => {
                remove_schedule(&client, &cli.api_base, &id, cli.output).await?
            }
            ScheduleCommands::Enable { id } => {
                toggle_schedule(&client, &cli.api_base, &id, true, cli.output).await?
            }
            ScheduleCommands::Disable { id } => {
                toggle_schedule(&client, &cli.api_base, &id, false, cli.output).await?
            }
        },

        // 认证命令
        Commands::Login { username, password } => {
            login(&client, &cli.api_base, &username, &password, cli.output).await?;
        }
        Commands::Refresh { refresh_token: rt } => {
            refresh_token(&client, &cli.api_base, &rt, cli.output).await?;
        }

        // 用户管理命令
        Commands::User(user_cmd) => match user_cmd {
            UserCommands::List => list_users(&client, &cli.api_base, cli.output).await?,
            UserCommands::Get { id } => get_user(&client, &cli.api_base, &id, cli.output).await?,
            UserCommands::Create {
                username,
                password,
                services,
            } => {
                create_user(
                    &client,
                    &cli.api_base,
                    &username,
                    &password,
                    services.unwrap_or_default(),
                    cli.output,
                )
                .await?
            }
            UserCommands::Delete { id } => delete_user(&client, &cli.api_base, &id).await?,
            UserCommands::Password {
                id,
                password,
                current,
            } => {
                update_user_password(
                    &client,
                    &cli.api_base,
                    &id,
                    &password,
                    current.as_deref(),
                    cli.output,
                )
                .await?
            }
            UserCommands::SetServices { id, services } => {
                set_user_services(&client, &cli.api_base, &id, services, cli.output).await?
            }
            UserCommands::Grant {
                user_id,
                service_id,
            } => {
                add_user_service(&client, &cli.api_base, &user_id, &service_id, cli.output).await?
            }
            UserCommands::Revoke {
                user_id,
                service_id,
            } => {
                remove_user_service(&client, &cli.api_base, &user_id, &service_id, cli.output)
                    .await?
            }
        },
    }

    Ok(())
}

fn init_tracing() {
    let fmt_layer = tracing_subscriber::fmt::layer().with_target(false);
    let filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());
    tracing_subscriber::registry()
        .with(filter)
        .with(fmt_layer)
        .init();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clap_parses() {
        let args = ["hc", "list"];
        let _ = Cli::parse_from(&args);
    }
}
