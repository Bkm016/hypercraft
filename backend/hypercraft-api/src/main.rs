mod app;

use app::{app_router, AppState, RateLimiter};
use dotenvy::dotenv;
use hypercraft_core::{init_tracing, ServiceManager, ServiceScheduler, UserManager};
use rand::Rng;
use std::collections::HashSet;
use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tracing::info;

#[derive(Debug, Clone)]
struct ApiConfig {
    bind: SocketAddr,
    data_dir: PathBuf,
    /// DevToken（管理员 token）
    dev_token: Option<String>,
    /// JWT 签名密钥
    jwt_secret: String,
    /// JWT iss
    jwt_issuer: String,
    /// JWT aud
    jwt_audience: String,
    allowed_commands: Option<HashSet<String>>,
    allowed_cwd_roots: Vec<PathBuf>,
    /// CORS 允许的来源列表（空则允许所有）
    cors_origins: Vec<String>,
}

/// 生成包含数字、字母和符号的复杂随机密码
fn generate_secure_password(length: usize) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ\
                              abcdefghijklmnopqrstuvwxyz\
                              0123456789\
                              !@#$%^&*()-_=+[]{}|;:,.<>?";
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

impl ApiConfig {
    fn from_env() -> Self {
        let bind = env::var("HC_BIND")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| "0.0.0.0:8080".parse().expect("valid default bind"));

        let data_dir = env::var("HC_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data"));

        // DevToken 用于管理员访问
        // 如果未在环境变量中设置，则每次启动生成新的随机密码
        let dev_token = match env::var("HC_DEV_TOKEN")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            Some(token) => {
                if token.len() < 32 {
                    panic!("DevToken 长度过短（<32）；请在 HC_DEV_TOKEN 中使用强随机值");
                }
                info!("使用配置的 DevToken");
                Some(token)
            }
            None => {
                let generated = generate_secure_password(40);
                info!("HC_DEV_TOKEN 未设置，生成随机 DevToken: {}", generated);
                Some(generated)
            }
        };

        // JWT 密钥，用于签发用户 token（必须独立于 DevToken）
        let jwt_secret = env::var("HC_JWT_SECRET").unwrap_or_else(|_| {
            info!("HC_JWT_SECRET 未设置；为本次运行生成随机密钥");
            uuid::Uuid::new_v4().to_string()
        });
        let jwt_issuer = env::var("HC_JWT_ISSUER").unwrap_or_else(|_| "hypercraft-api".into());
        let jwt_audience =
            env::var("HC_JWT_AUDIENCE").unwrap_or_else(|_| "hypercraft-clients".into());

        let allowed_commands = env::var("HC_ALLOWED_COMMANDS").ok().map(|s| {
            let trimmed = s.trim();
            if trimmed == "*" {
                HashSet::new()
            } else {
                trimmed
                    .split(',')
                    .filter(|t| !t.is_empty())
                    .map(|t| t.trim().to_string())
                    .collect()
            }
        });
        // "*" 代表不做命令白名单限制
        let allowed_commands = match allowed_commands {
            Some(set) if set.is_empty() => None,
            other => other,
        };

        let allowed_cwd_roots = env::var("HC_ALLOWED_CWD_PREFIXES")
            .ok()
            .map(|s| {
                let trimmed = s.trim();
                if trimmed == "*" {
                    vec![PathBuf::from("*")]
                } else {
                    trimmed
                        .split(';')
                        .filter(|t| !t.is_empty())
                        .map(PathBuf::from)
                        .collect::<Vec<_>>()
                }
            })
            .unwrap_or_default();

        // CORS 允许的来源，逗号分隔；空或 "*" 表示允许所有
        let cors_origins = env::var("HC_CORS_ORIGINS")
            .ok()
            .map(|s| {
                let trimmed = s.trim();
                if trimmed.is_empty() || trimmed == "*" {
                    vec![]
                } else {
                    trimmed
                        .split(',')
                        .filter(|t| !t.trim().is_empty())
                        .map(|t| t.trim().to_string())
                        .collect()
                }
            })
            .unwrap_or_default();

        Self {
            bind,
            data_dir,
            dev_token,
            jwt_secret,
            jwt_issuer,
            jwt_audience,
            allowed_commands,
            allowed_cwd_roots,
            cors_origins,
        }
    }
}

/// 限制 worker 线程数，避免在高核心数服务器上创建过多线程
/// 可通过环境变量 TOKIO_WORKER_THREADS 覆盖
#[tokio::main(worker_threads = 4)]
async fn main() -> anyhow::Result<()> {
    // 优先读取 .env（若存在）
    let _ = dotenv();
    init_tracing();

    let config = ApiConfig::from_env();
    info!("在 {} 启动 API", config.bind);

    let manager = Arc::new(ServiceManager::with_policy(
        config.data_dir.clone(),
        config.allowed_commands.clone(),
        config.allowed_cwd_roots.clone(),
    ));
    manager.ensure_base_dirs()?;

    // 自动启动配置了 auto_start 的服务
    auto_start_services(&manager).await;

    // 初始化定时调度器
    let scheduler = Arc::new(ServiceScheduler::new((*manager).clone()));
    if let Err(e) = scheduler.start().await {
        tracing::error!(error = %e, "无法启动计划任务");
    } else {
        // 加载所有服务的定时任务
        if let Err(e) = scheduler.reload_all().await {
            tracing::warn!(error = %e, "无法重新加载计划任务");
        }
    }

    // 创建用户管理器
    let user_manager = Arc::new(
        UserManager::new(config.data_dir.clone(), config.jwt_secret.clone())
            .with_claims_context(config.jwt_issuer.clone(), config.jwt_audience.clone()),
    );
    user_manager.ensure_dirs()?;

    let login_limiter = Arc::new(RateLimiter::new(10, Duration::from_secs(60)));
    let refresh_limiter = Arc::new(RateLimiter::new(10, Duration::from_secs(60)));
    let auth_limiter = Arc::new(RateLimiter::new(10, Duration::from_secs(60)));
    let password_limiter = Arc::new(RateLimiter::new(10, Duration::from_secs(60)));

    let state = AppState {
        manager: manager.clone(),
        user_manager,
        scheduler: scheduler.clone(),
        dev_token: config.dev_token.clone(),
        login_limiter,
        refresh_limiter,
        auth_limiter,
        password_limiter,
    };

    let app = app_router(state, config.cors_origins.clone());
    let listener = tokio::net::TcpListener::bind(config.bind).await?;

    // Graceful shutdown 处理
    let server = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal());

    info!("服务器准备就绪，按 Ctrl+C 停止");

    if let Err(e) = server.await {
        tracing::error!(error = %e, "服务器错误");
    }

    // 停止所有运行中的服务
    info!("正在停止所有运行中的服务...");
    if let Err(e) = manager.stop_all_services().await {
        tracing::warn!(error = %e, "无法停止服务");
    }

    // 关闭调度器
    info!("正在关闭调度器...");
    if let Err(e) = scheduler.shutdown().await {
        tracing::warn!(error = %e, "无法关闭调度器");
    }

    info!("服务器已停止");
    Ok(())
}

/// 等待关闭信号 (Ctrl+C / SIGTERM)
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("无法插入 Ctrl+C 控制器");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("无法插入 Ctrl+C 控制器")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => info!("收到 Ctrl+C，正在关闭..."),
        _ = terminate => info!("收到 SIGTERM，正在关闭..."),
    }
}

/// 自动启动配置了 auto_start: true 的服务
async fn auto_start_services(manager: &Arc<ServiceManager>) {
    info!("检查启用自动启动的服务...");

    // 获取所有服务列表
    let services = match manager.list_services().await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "获取自动启动的服务列表失败");
            return;
        }
    };

    for summary in services {
        // 加载 manifest 检查 auto_start
        let manifest = match manager.load_manifest(&summary.id).await {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!(service_id = %summary.id, error = %e, "加载 manifest 失败");
                continue;
            }
        };

        if !manifest.auto_start {
            continue;
        }

        // 检查服务是否已经在运行
        let status = match manager.status(&summary.id).await {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(service_id = %summary.id, error = %e, "获取服务状态失败");
                continue;
            }
        };

        if status.state == hypercraft_core::ServiceState::Running {
            info!(service_id = %summary.id, "服务已在运行，跳过自动启动");
            continue;
        }

        // 启动服务
        info!(service_id = %summary.id, "正在自动启动服务...");
        match manager.start(&summary.id).await {
            Ok(_) => info!(service_id = %summary.id, "服务自动启动成功"),
            Err(e) => tracing::error!(service_id = %summary.id, error = %e, "服务自动启动失败"),
        }
    }
}
