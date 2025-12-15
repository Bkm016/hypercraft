//! 服务生命周期管理：启动、停止、重启等核心操作。

use super::*;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::task;
use tokio::time::Duration;
use tracing::instrument;

/// 日志文件最大大小（2MB），超过此值触发截断
const LOG_MAX_SIZE: u64 = 2 * 1024 * 1024;
/// 截断后保留的大小（1MB）
const LOG_RETAIN_SIZE: u64 = 1 * 1024 * 1024;
/// 每写入多少行检查一次文件大小
const LOG_CHECK_INTERVAL: u32 = 100;

impl ServiceManager {
    /// 刷新状态：优先查看 runtime 句柄，其次 pid 文件。
    #[instrument(skip(self))]
    pub async fn status(&self, id: &str) -> Result<ServiceStatus> {
        // 优先检查 runtime 句柄，并确认进程仍存活；若已退出则清理缓存。
        if let Some(runtime_pid) = self.runtime.lock().await.get(id).map(|h| h.pid) {
            if let Some((alive, uptime)) = self.process_alive(runtime_pid) {
                if alive {
                    return Ok(ServiceStatus {
                        state: ServiceState::Running,
                        pid: Some(runtime_pid),
                        uptime_ms: uptime,
                    });
                }
            }
            let mut guard = self.runtime.lock().await;
            guard.remove(id);
        }
        let pid_opt = self.read_pid(id)?;
        if let Some(pid) = pid_opt {
            if let Some((alive, uptime)) = self.process_alive(pid) {
                if alive {
                    return Ok(ServiceStatus {
                        state: ServiceState::Running,
                        pid: Some(pid),
                        uptime_ms: uptime,
                    });
                }
            }
            // stale pid file
            let _ = fs::remove_file(self.pid_path(id));
        }
        Ok(ServiceStatus {
            state: ServiceState::Stopped,
            pid: None,
            uptime_ms: None,
        })
    }

    /// 启动服务：使用 PTY 收发，并持续写日志以便 tail。
    #[instrument(skip(self))]
    pub async fn start(&self, id: &str) -> Result<ServiceStatus> {
        let manifest = self.load_manifest(id).await?;
        let current = self.status(id).await?;
        if matches!(current.state, ServiceState::Running) {
            return Err(ServiceError::AlreadyRunning(id.to_string()));
        }

        fs::create_dir_all(self.logs_dir(id))?;
        fs::create_dir_all(self.runtime_dir(id))?;

        let log_path = self.log_path(id);
        // 启动时清空日志文件（根据配置）
        if manifest.clear_log_on_start {
            let _ = fs::write(&log_path, "");
        }

        self.enforce_policy(&manifest)?;
        if let Some(cwd) = manifest.cwd.as_ref() {
            if !Path::new(cwd).exists() {
                return Err(ServiceError::SpawnFailed(format!(
                    "working directory not found: {cwd}"
                )));
            }
        }

        let (mut child, master_pty, reader, writer, pid) =
            self.spawn_pty_process(&manifest).await?;

        let (out_tx, _) = broadcast::channel(200);
        let (in_tx, in_rx) = mpsc::channel::<Vec<u8>>(64);

        // 输出：写入日志并广播给 attach。
        self.spawn_output_handler(reader, log_path.clone(), out_tx.clone());

        // 输入：接收 attach 写入 PTY。
        self.spawn_input_handler(writer, in_rx);

        let stop_requested = Arc::new(AtomicBool::new(false));
        {
            let mut guard = self.runtime.lock().await;
            guard.insert(
                id.to_string(),
                RuntimeHandles {
                    pid,
                    input: in_tx.clone(),
                    output: out_tx.clone(),
                    pty: master_pty,
                    stop_requested: stop_requested.clone(),
                },
            );
        }

        self.write_pid(id, pid)?;

        // 若子进程在极短时间内退出，视为启动失败并清理。
        tokio::time::sleep(Duration::from_millis(300)).await;
        if let Ok(Some(status)) = child.try_wait() {
            let _ = fs::remove_file(self.pid_path(id));
            let mut guard = self.runtime.lock().await;
            guard.remove(id);
            let _ = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .and_then(|mut f| {
                    writeln!(f, "process exited immediately: {status:?}")?;
                    Ok(())
                });
            return Err(ServiceError::SpawnFailed(format!(
                "process exited immediately: {status:?}"
            )));
        }

        // 避免僵尸进程：后台等待并清理 runtime，支持自动重启。
        self.spawn_wait_handler(
            child,
            id.to_string(),
            log_path,
            manifest.auto_restart,
            stop_requested,
        );

        Ok(ServiceStatus {
            state: ServiceState::Running,
            pid: Some(pid),
            uptime_ms: Some(0),
        })
    }

    /// 优雅关闭服务：发送配置的关闭命令（如 "stop"），等待进程自行退出
    #[instrument(skip(self))]
    pub async fn shutdown(&self, id: &str) -> Result<ServiceStatus> {
        let manifest = self.load_manifest(id).await?;
        let status = self.status(id).await?;
        if !matches!(status.state, ServiceState::Running) {
            return Err(ServiceError::NotRunning(id.to_string()));
        }

        // 标记为主动停止，阻止自动重启
        {
            let guard = self.runtime.lock().await;
            if let Some(h) = guard.get(id) {
                h.stop_requested.store(true, Ordering::Relaxed);
            }
        }

        // 发送关闭命令
        let cmd = manifest.shutdown_command.as_deref().unwrap_or("stop");
        let input = {
            let guard = self.runtime.lock().await;
            guard.get(id).map(|h| h.input.clone())
        };
        if let Some(tx) = input {
            let cmd_with_newline = format!("{}\n", cmd);
            let _ = tx.send(cmd_with_newline.into_bytes()).await;
        }

        Ok(ServiceStatus {
            state: ServiceState::Running, // 还在运行，等待自行退出
            pid: status.pid,
            uptime_ms: status.uptime_ms,
        })
    }

    /// 强制终止服务：直接杀进程
    #[instrument(skip(self))]
    pub async fn kill(&self, id: &str) -> Result<ServiceStatus> {
        // pid 文件可能已被清理，但 runtime 仍缓存（或反之），因此两者都要尝试。
        let (runtime_pid, stop_flag) = {
            let guard = self.runtime.lock().await;
            guard
                .get(id)
                .map(|h| (h.pid, h.stop_requested.clone()))
                .unzip()
        };
        let pid = match (runtime_pid, self.read_pid(id)?) {
            (Some(pid), _) => pid,
            (None, Some(pid)) => pid,
            _ => return Err(ServiceError::NotRunning(id.to_string())),
        };

        // 标记为主动停止，阻止自动重启
        if let Some(flag) = stop_flag {
            flag.store(true, Ordering::Relaxed);
        }

        {
            let mut guard = self.runtime.lock().await;
            guard.remove(id);
        }

        // 若进程已退出或 pid 已经失效，则视为幂等成功。
        let _ = self.kill_process(pid);

        // 等待进程退出，最多等待 1 秒
        let mut attempts = 0;
        while self
            .process_alive(pid)
            .map(|(alive, _)| alive)
            .unwrap_or(false)
        {
            attempts += 1;
            if attempts >= 10 {
                return Err(ServiceError::Other("failed to kill process".into()));
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

        let _ = fs::remove_file(self.pid_path(id));

        Ok(ServiceStatus {
            state: ServiceState::Stopped,
            pid: None,
            uptime_ms: None,
        })
    }

    /// 停止服务：优先优雅关闭，如果没配置关闭命令则强制终止
    #[instrument(skip(self))]
    pub async fn stop(&self, id: &str) -> Result<ServiceStatus> {
        let manifest = self.load_manifest(id).await?;
        if manifest.shutdown_command.is_some() {
            self.shutdown(id).await
        } else {
            self.kill(id).await
        }
    }

    /// Restart：先停后启（停失败则报错）。
    #[instrument(skip(self))]
    pub async fn restart(&self, id: &str) -> Result<ServiceStatus> {
        let status = self.status(id).await?;
        if matches!(status.state, ServiceState::Running) {
            self.stop(id).await?;
        }
        self.start(id).await
    }

    /// 停止所有正在运行的服务（用于 shutdown）
    #[instrument(skip(self))]
    pub async fn stop_all_services(&self) -> Result<()> {
        let services = self.list_services().await?;
        let running: Vec<_> = services
            .into_iter()
            .filter(|s| s.state == ServiceState::Running)
            .collect();

        if running.is_empty() {
            return Ok(());
        }

        tracing::info!("stopping {} running services...", running.len());

        for summary in running {
            tracing::info!("stopping service: {}", summary.id);
            if let Err(e) = self.stop(&summary.id).await {
                tracing::warn!("failed to stop service {}: {}", summary.id, e);
            }
        }

        // 等待所有服务停止，最多等待 5 秒
        let start = tokio::time::Instant::now();
        let timeout = Duration::from_secs(5);

        loop {
            let services = self.list_services().await?;
            let still_running = services
                .iter()
                .filter(|s| s.state == ServiceState::Running)
                .count();

            if still_running == 0 {
                tracing::info!("all services stopped");
                break;
            }

            if start.elapsed() > timeout {
                tracing::warn!("{} services still running after timeout", still_running);
                break;
            }

            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        Ok(())
    }
}

// ============================================================================
// 私有辅助方法
// ============================================================================

impl ServiceManager {
    /// 使用 PTY 创建子进程
    async fn spawn_pty_process(
        &self,
        manifest: &crate::manifest::ServiceManifest,
    ) -> Result<(
        Box<dyn portable_pty::Child + Send + Sync>,
        Box<dyn portable_pty::MasterPty + Send>,
        Box<dyn Read + Send>,
        Box<dyn Write + Send>,
        u32,
    )> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 300,
                cols: 155,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| ServiceError::SpawnFailed(e.to_string()))?;

        // 如果指定了 run_as 用户（仅 Linux），使用 sudo -u 包装命令
        #[cfg(target_os = "linux")]
        let (actual_command, actual_args) = if let Some(ref user) = manifest.run_as {
            let mut sudo_args = vec!["-u".to_string(), user.clone(), manifest.command.clone()];
            sudo_args.extend(manifest.args.clone());
            ("sudo".to_string(), sudo_args)
        } else {
            (manifest.command.clone(), manifest.args.clone())
        };
        #[cfg(not(target_os = "linux"))]
        let (actual_command, actual_args) = (manifest.command.clone(), manifest.args.clone());

        let mut cmd = CommandBuilder::new(&actual_command);
        cmd.args(actual_args);
        if let Some(cwd) = manifest.cwd.as_ref() {
            cmd.cwd(cwd);
        }
        for (k, v) in manifest.env.iter() {
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| ServiceError::SpawnFailed(e.to_string()))?;
        let pid = child
            .process_id()
            .ok_or_else(|| ServiceError::SpawnFailed("missing pid".into()))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| ServiceError::SpawnFailed(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| ServiceError::SpawnFailed(e.to_string()))?;

        Ok((child, pair.master, reader, writer, pid))
    }

    /// 启动输出处理任务：写入日志并广播给 attach
    fn spawn_output_handler(
        &self,
        mut reader: Box<dyn Read + Send>,
        log_path: std::path::PathBuf,
        out_tx: broadcast::Sender<Vec<u8>>,
    ) {
        task::spawn_blocking(move || {
            let mut buf = [0u8; 4096];
            let mut log_file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .ok();
            // 写入字节计数，用于定期检查文件大小
            let mut byte_count: u64 = 0;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        // 广播原始数据给实时 attach
                        let _ = out_tx.send(buf[..n].to_vec());
                        // 直接写入原始数据到日志（不过滤，保留所有控制序列）
                        if let Some(file) = log_file.as_mut() {
                            let _ = file.write_all(&buf[..n]);
                            let _ = file.flush();
                            byte_count += n as u64;
                        }

                        // 定期检查文件大小，超限则截断
                        if byte_count >= LOG_CHECK_INTERVAL as u64 * 100 {
                            byte_count = 0;
                            let need_truncate = log_file
                                .as_ref()
                                .and_then(|f| f.metadata().ok())
                                .map(|m| m.len() > LOG_MAX_SIZE)
                                .unwrap_or(false);
                            if need_truncate {
                                drop(log_file.take());
                                truncate_log_file(&log_path, LOG_RETAIN_SIZE);
                                log_file = OpenOptions::new()
                                    .create(true)
                                    .append(true)
                                    .open(&log_path)
                                    .ok();
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    /// 启动输入处理任务：接收 attach 写入 PTY
    fn spawn_input_handler(
        &self,
        mut writer: Box<dyn Write + Send>,
        mut in_rx: mpsc::Receiver<Vec<u8>>,
    ) {
        task::spawn_blocking(move || {
            while let Some(buf) = in_rx.blocking_recv() {
                if writer.write_all(&buf).is_err() {
                    break;
                }
                let _ = writer.flush();
            }
        });
    }

    /// 启动等待处理任务：等待进程退出并清理，支持自动重启
    fn spawn_wait_handler(
        &self,
        mut child: Box<dyn portable_pty::Child + Send + Sync>,
        id: String,
        log_path: std::path::PathBuf,
        auto_restart: bool,
        stop_flag: Arc<AtomicBool>,
    ) {
        let runtime = self.runtime.clone();
        let pid_path = self.pid_path(&id);
        let manager = self.clone();

        task::spawn(async move {
            let log_path_wait = log_path.clone();
            let _wait_result = task::spawn_blocking(move || {
                let result = child.wait();
                // 记录退出状态，便于排查启动后瞬停。
                if let Ok(status) = &result {
                    let _ = OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&log_path_wait)
                        .and_then(|mut f| {
                            writeln!(f, "process exited: {status:?}")?;
                            Ok(())
                        });
                }
                result
            })
            .await;

            let _ = tokio::fs::remove_file(&pid_path).await;
            {
                let mut map = runtime.lock().await;
                map.remove(&id);
            }

            // 自动重启：只有非主动停止且开启了 auto_restart 才重启
            let was_stopped = stop_flag.load(Ordering::Relaxed);
            if auto_restart && !was_stopped {
                tracing::info!("auto_restart enabled, restarting service: {}", id);
                tokio::time::sleep(Duration::from_secs(1)).await;
                manager.spawn_restart(id);
            }
        });
    }

    /// 内部自动重启方法
    fn spawn_restart(&self, id: String) {
        let manager = self.clone();
        tokio::spawn(async move {
            if let Err(e) = manager.start(&id).await {
                tracing::error!("auto_restart failed for {}: {}", id, e);
            }
        });
    }
}

/// 截断日志文件，保留末尾指定大小的内容
fn truncate_log_file(path: &std::path::Path, retain_size: u64) {
    let Ok(mut file) = File::open(path) else {
        return;
    };
    let Ok(metadata) = file.metadata() else {
        return;
    };
    let file_size = metadata.len();
    if file_size <= retain_size {
        return;
    }

    // 定位到需要保留的起始位置
    let start_pos = file_size - retain_size;
    if file.seek(SeekFrom::Start(start_pos)).is_err() {
        return;
    }

    // 读取末尾内容
    let mut retained = Vec::with_capacity(retain_size as usize);
    if file.read_to_end(&mut retained).is_err() {
        return;
    }
    drop(file);

    // 调整到行边界：跳过第一个不完整的行
    let line_start = retained
        .iter()
        .position(|&b| b == b'\n')
        .map(|i| i + 1)
        .unwrap_or(0);
    let retained = &retained[line_start..];

    // 覆写文件
    if let Ok(mut file) = File::create(path) {
        let _ = file.write_all(b"[... log truncated ...]\n");
        let _ = file.write_all(retained);
    }
}
