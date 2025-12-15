mod app;

use app::{app_router, AppState, RateLimiter};
use dotenvy::dotenv;
use hypercraft_core::{init_tracing, ServiceManager, ServiceScheduler, UserManager};
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

impl ApiConfig {
    fn from_env() -> Self {
        let bind = env::var("HC_BIND")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| "0.0.0.0:8080".parse().expect("valid default bind"));

        let data_dir = env::var("HC_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data"));

        // DevToken 用于管理员访问（建议长度 >=16）
        let dev_token = env::var("HC_DEV_TOKEN")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(|token| {
                if token.len() < 32 {
                    panic!("Dev token length is too short (<32); please use a strong random value in HC_DEV_TOKEN");
                }
                token
            });

        // JWT 密钥，用于签发用户 token（必须独立于 DevToken）
        let jwt_secret = env::var("HC_JWT_SECRET").unwrap_or_else(|_| {
            info!("HC_JWT_SECRET not set; generating a random secret for this run");
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
    info!("starting API on {}", config.bind);

    let manager = Arc::new(ServiceManager::with_policy(
        config.data_dir.clone(),
        config.allowed_commands.clone(),
        config.allowed_cwd_roots.clone(),
    ));
    manager.ensure_base_dirs()?;

    // 启动后台进程统计刷新任务（sysinfo 需要两次采样才能获取准确的 CPU 使用率）
    // 间隔 5 秒，减少 CPU 开销
    manager.start_stats_refresh_task(5);

    // 自动启动配置了 auto_start 的服务
    auto_start_services(&manager).await;

    // 初始化定时调度器
    let scheduler = Arc::new(ServiceScheduler::new((*manager).clone()));
    if let Err(e) = scheduler.start().await {
        tracing::error!(error = %e, "failed to start scheduler");
    } else {
        // 加载所有服务的定时任务
        if let Err(e) = scheduler.reload_all().await {
            tracing::warn!(error = %e, "failed to reload scheduled tasks");
        }
    }

    // 创建用户管理器
    let user_manager = Arc::new(
        UserManager::new(config.data_dir.clone(), config.jwt_secret.clone())
            .with_claims_context(config.jwt_issuer.clone(), config.jwt_audience.clone()),
    );
    user_manager.ensure_dirs()?;

    let login_limiter = Arc::new(RateLimiter::new(10, Duration::from_secs(60)));
    let refresh_limiter = Arc::new(RateLimiter::new(5, Duration::from_secs(300)));
    let auth_limiter = Arc::new(RateLimiter::new(10, Duration::from_secs(60)));

    let state = AppState {
        manager,
        user_manager,
        scheduler: scheduler.clone(),
        dev_token: config.dev_token.clone(),
        login_limiter,
        refresh_limiter,
        auth_limiter,
    };

    let app = app_router(state, config.cors_origins.clone());
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    
    // Graceful shutdown 处理
    let server = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal());
    
    info!("server ready, press Ctrl+C to stop");
    
    if let Err(e) = server.await {
        tracing::error!(error = %e, "server error");
    }
    
    // 关闭调度器
    info!("shutting down scheduler...");
    if let Err(e) = scheduler.shutdown().await {
        tracing::warn!(error = %e, "failed to shutdown scheduler");
    }
    
    info!("server stopped");
    Ok(())
}

/// 等待关闭信号 (Ctrl+C / SIGTERM)
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => info!("received Ctrl+C, shutting down..."),
        _ = terminate => info!("received SIGTERM, shutting down..."),
    }
}

/// 自动启动配置了 auto_start: true 的服务
async fn auto_start_services(manager: &Arc<ServiceManager>) {
    info!("checking for services with auto_start enabled...");

    // 获取所有服务列表
    let services = match manager.list_services().await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "failed to list services for auto_start");
            return;
        }
    };

    for summary in services {
        // 加载 manifest 检查 auto_start
        let manifest = match manager.load_manifest(&summary.id).await {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!(service_id = %summary.id, error = %e, "failed to load manifest");
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
                tracing::warn!(service_id = %summary.id, error = %e, "failed to get status");
                continue;
            }
        };

        if status.state == hypercraft_core::ServiceState::Running {
            info!(service_id = %summary.id, "service already running, skipping auto_start");
            continue;
        }

        // 启动服务
        info!(service_id = %summary.id, "auto-starting service...");
        match manager.start(&summary.id).await {
            Ok(_) => info!(service_id = %summary.id, "service auto-started successfully"),
            Err(e) => tracing::error!(service_id = %summary.id, error = %e, "failed to auto-start service"),
        }
    }
}
