use crate::error::{Result, ServiceError};
use crate::manifest::ServiceManifest;
use crate::models::{ServiceState, ServiceStatus, ServiceSummary};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::{broadcast, mpsc, Mutex};
use sysinfo::System;

mod attach;
mod groups;
mod lifecycle;
mod logs;
mod policy;
mod process;
pub mod scheduler;
mod signal;
mod stats;
mod storage;

pub use stats::SystemStats;

/// attach 会话句柄：暴露写入 stdin 的通道与订阅 stdout/stderr 的广播。
#[derive(Debug)]
pub struct AttachHandle {
    pub pid: u32,
    pub input: mpsc::Sender<Vec<u8>>,
    pub output: broadcast::Receiver<Vec<u8>>,
}

/// 运行时缓存：保存已经由当前 manager 启动的子进程句柄，便于 attach。
struct RuntimeHandles {
    pid: u32,
    input: mpsc::Sender<Vec<u8>>,
    output: broadcast::Sender<Vec<u8>>,
    /// Hold PTY master to keep the pseudoterminal alive for Windows ConPTY.
    #[allow(dead_code)]
    pty: Box<dyn portable_pty::MasterPty + Send>,
    /// 是否是主动停止（stop 调用），用于区分自动重启
    stop_requested: Arc<std::sync::atomic::AtomicBool>,
}

impl std::fmt::Debug for RuntimeHandles {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RuntimeHandles")
            .field("pid", &self.pid)
            .finish_non_exhaustive()
    }
}

/// 基于本地文件系统的进程管理器：落盘 manifest、控制生命周期、采集状态与日志，并暴露 attach 能力。
#[derive(Debug, Clone)]
pub struct ServiceManager {
    data_dir: PathBuf,
    allowed_commands: Option<HashSet<String>>,
    allowed_cwd_roots: Vec<PathBuf>,
    runtime: Arc<Mutex<HashMap<String, RuntimeHandles>>>,
    system: Arc<StdMutex<System>>,
}

impl ServiceManager {
    pub fn new<P: AsRef<Path>>(data_dir: P) -> Self {
        Self::with_policy(data_dir, None, Vec::new())
    }

    /// 配置白名单策略：允许的命令名集合 + 允许的 cwd 根目录前缀。
    pub fn with_policy<P: AsRef<Path>>(
        data_dir: P,
        allowed_commands: Option<HashSet<String>>,
        allowed_cwd_roots: Vec<PathBuf>,
    ) -> Self {
        Self {
            data_dir: data_dir.as_ref().to_path_buf(),
            allowed_commands,
            allowed_cwd_roots,
            runtime: Arc::new(Mutex::new(HashMap::new())),
            system: Arc::new(StdMutex::new(System::new())),
        }
    }

    /// 确保基础目录存在。
    pub fn ensure_base_dirs(&self) -> Result<()> {
        std::fs::create_dir_all(self.services_dir())?;
        Ok(())
    }

    /// services 根目录：<data_dir>/services
    fn services_dir(&self) -> PathBuf {
        self.data_dir.join("services")
    }

    /// 单个服务目录：<data_dir>/services/<id>
    fn service_dir(&self, id: &str) -> PathBuf {
        self.services_dir().join(id)
    }

    /// manifest 路径：service.json
    fn manifest_path(&self, id: &str) -> PathBuf {
        self.service_dir(id).join("service.json")
    }

    /// runtime 状态目录：pid/锁等
    fn runtime_dir(&self, id: &str) -> PathBuf {
        self.service_dir(id).join("runtime")
    }

    /// pid 文件路径
    fn pid_path(&self, id: &str) -> PathBuf {
        self.runtime_dir(id).join("pid")
    }

    /// logs 根目录
    fn logs_dir(&self, id: &str) -> PathBuf {
        self.service_dir(id).join("logs")
    }

    /// 默认日志文件 latest.log
    fn log_path(&self, id: &str) -> PathBuf {
        self.logs_dir(id).join("latest.log")
    }

    /// 校验 id，仅允许字母数字/`-`/`_`/`.`
    fn validate_id(&self, id: &str) -> Result<()> {
        let valid = !id.is_empty()
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
        if valid {
            Ok(())
        } else {
            Err(ServiceError::InvalidId)
        }
    }
}

// 扩展实现拆分在子模块中
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn manifest(id: &str) -> ServiceManifest {
        ServiceManifest {
            id: id.to_string(),
            name: id.to_string(),
            command: "cmd".into(), // dummy; not spawned in tests
            args: vec![],
            env: std::collections::BTreeMap::new(),
            cwd: None,
            auto_start: false,
            auto_restart: false,
            clear_log_on_start: true,
            shutdown_command: None,
            run_as: None,
            created_at: None,
            tags: vec![],
            group: None,
            order: 0,
            log_path: None,
            schedule: None,
        }
    }

    #[tokio::test]
    async fn create_and_list() {
        let dir = TempDir::new().unwrap();
        let manager = ServiceManager::new(dir.path());

        manager.create_service(manifest("svc1")).await.unwrap();
        manager.create_service(manifest("svc2")).await.unwrap();

        let list = manager.list_services().await.unwrap();
        assert_eq!(list.len(), 2);
        assert!(list.iter().any(|s| s.id == "svc1"));
        assert!(list.iter().any(|s| s.id == "svc2"));
    }

    #[tokio::test]
    async fn delete_requires_existing() {
        let dir = TempDir::new().unwrap();
        let manager = ServiceManager::new(dir.path());
        let err = manager.delete_service("missing").await.unwrap_err();
        matches!(err, ServiceError::NotFound(_));
    }

    #[tokio::test]
    async fn tail_logs_empty_ok() {
        let dir = TempDir::new().unwrap();
        let manager = ServiceManager::new(dir.path());
        let lines = manager.tail_logs("none", 10).unwrap();
        assert!(lines.is_empty());
    }

    #[tokio::test]
    async fn update_keeps_created_at() {
        let dir = TempDir::new().unwrap();
        let manager = ServiceManager::new(dir.path());
        let mut base = manifest("svc1");
        base.created_at = Some(chrono::Utc::now());
        manager.create_service(base.clone()).await.unwrap();

        let mut updated = base.clone();
        updated.name = "svc1-updated".into();
        updated.created_at = None;
        manager
            .update_service("svc1", updated.clone())
            .await
            .unwrap();

        let loaded = manager.load_manifest("svc1").await.unwrap();
        assert_eq!(loaded.name, "svc1-updated");
        assert_eq!(loaded.created_at, base.created_at);
    }

    #[tokio::test]
    async fn policy_rejects_command() {
        let dir = TempDir::new().unwrap();
        let mut allowed = HashSet::new();
        allowed.insert("allowed.exe".to_string());
        let manager = ServiceManager::with_policy(dir.path(), Some(allowed), vec![]);
        let mut m = manifest("svc1");
        m.command = "blocked.exe".into();
        let err = manager.create_service(m).await.unwrap_err();
        matches!(err, ServiceError::PolicyViolation(_));
    }

    #[tokio::test]
    async fn attach_fails_when_not_running() {
        let dir = TempDir::new().unwrap();
        let manager = ServiceManager::new(dir.path());
        manager.create_service(manifest("svc1")).await.unwrap();
        let err = manager.attach("svc1").await.unwrap_err();
        matches!(err, ServiceError::NotRunning(_));
    }

    #[tokio::test]
    async fn stop_is_idempotent_when_pid_missing() {
        let dir = TempDir::new().unwrap();
        let manager = ServiceManager::new(dir.path());
        let svc = manifest("svc1");
        manager.create_service(svc).await.unwrap();
        std::fs::create_dir_all(manager.runtime_dir("svc1")).unwrap();
        std::fs::write(manager.pid_path("svc1"), "999999").unwrap();

        let status = manager.stop("svc1").await.unwrap();
        assert_eq!(status.state, ServiceState::Stopped);
    }
}
