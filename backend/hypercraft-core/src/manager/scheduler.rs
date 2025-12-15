//! 定时调度器：基于 cron 表达式的服务定时启动/重启/停止。
//! 
//! 使用纯 tokio 实现，不依赖重量级的 tokio-cron-scheduler。

use crate::error::{Result, ServiceError};
use crate::manifest::{Schedule, ScheduleAction};
use crate::ServiceManager;
use chrono::Utc;
use cron::Schedule as CronSchedule;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

/// 调度器：管理所有服务的定时任务
#[derive(Clone)]
pub struct ServiceScheduler {
    /// 服务 ID -> 任务句柄
    jobs: Arc<RwLock<HashMap<String, JoinHandle<()>>>>,
    /// ServiceManager 引用
    manager: ServiceManager,
}

impl ServiceScheduler {
    /// 创建新的调度器
    pub fn new(manager: ServiceManager) -> Self {
        Self {
            jobs: Arc::new(RwLock::new(HashMap::new())),
            manager,
        }
    }

    /// 启动调度器（现在是空操作，任务按需创建）
    pub async fn start(&self) -> Result<()> {
        info!("scheduler ready");
        Ok(())
    }

    /// 停止调度器，取消所有任务
    pub async fn shutdown(&self) -> Result<()> {
        let mut jobs = self.jobs.write().await;
        for (id, handle) in jobs.drain() {
            handle.abort();
            info!("cancelled scheduled task for service: {}", id);
        }
        info!("scheduler stopped");
        Ok(())
    }

    /// 为指定服务添加或更新定时任务
    pub async fn upsert_schedule(&self, service_id: &str, schedule: &Schedule) -> Result<()> {
        // 先移除旧任务
        self.remove_schedule(service_id).await?;

        // 如果未启用或 cron 为空，直接返回
        if !schedule.enabled || schedule.cron.is_empty() {
            return Ok(());
        }

        // 验证并解析 cron 表达式
        let cron_schedule = Self::parse_cron(&schedule.cron)?;

        let manager = self.manager.clone();
        let sid = service_id.to_string();
        let action = schedule.action.clone();
        let cron_expr = schedule.cron.clone();

        // 启动定时任务
        let handle = tokio::spawn(async move {
            loop {
                // 计算下次执行时间
                let now = Utc::now();
                let next = match cron_schedule.upcoming(Utc).next() {
                    Some(t) => t,
                    None => {
                        warn!("no upcoming schedule for service {}", sid);
                        break;
                    }
                };

                // 等待到下次执行时间
                let duration = (next - now).to_std().unwrap_or_default();
                tokio::time::sleep(duration).await;

                // 执行任务
                info!("scheduled task triggered for service: {}", sid);
                let result = match action {
                    ScheduleAction::Start => {
                        match manager.status(&sid).await {
                            Ok(status) if status.state == crate::models::ServiceState::Stopped => {
                                manager.start(&sid).await.map(|_| ())
                            }
                            Ok(_) => {
                                info!("service {} already running, skipping scheduled start", sid);
                                Ok(())
                            }
                            Err(e) => Err(e),
                        }
                    }
                    ScheduleAction::Restart => manager.restart(&sid).await.map(|_| ()),
                    ScheduleAction::Stop => {
                        match manager.status(&sid).await {
                            Ok(status) if status.state == crate::models::ServiceState::Running => {
                                manager.stop(&sid).await.map(|_| ())
                            }
                            Ok(_) => {
                                info!("service {} not running, skipping scheduled stop", sid);
                                Ok(())
                            }
                            Err(e) => Err(e),
                        }
                    }
                };

                if let Err(e) = result {
                    error!(
                        "scheduled {:?} failed for service {}: {}",
                        action, sid, e
                    );
                }
            }
        });

        self.jobs.write().await.insert(service_id.to_string(), handle);
        info!(
            "scheduled task added for service {}: {} ({:?})",
            service_id, cron_expr, schedule.action
        );

        Ok(())
    }

    /// 移除指定服务的定时任务
    pub async fn remove_schedule(&self, service_id: &str) -> Result<()> {
        if let Some(handle) = self.jobs.write().await.remove(service_id) {
            handle.abort();
            info!("scheduled task removed for service: {}", service_id);
        }
        Ok(())
    }

    /// 重新加载所有服务的定时任务
    pub async fn reload_all(&self) -> Result<()> {
        let services = self.manager.list_services().await?;

        for summary in services {
            match self.manager.load_manifest(&summary.id).await {
                Ok(manifest) => {
                    if let Some(schedule) = &manifest.schedule {
                        if let Err(e) = self.upsert_schedule(&summary.id, schedule).await {
                            warn!(
                                "failed to load schedule for service {}: {}",
                                summary.id, e
                            );
                        }
                    }
                }
                Err(e) => {
                    warn!("failed to load manifest for service {}: {}", summary.id, e);
                }
            }
        }

        Ok(())
    }

    /// 验证 cron 表达式
    pub fn validate_cron(cron: &str) -> Result<()> {
        Self::parse_cron(cron)?;
        Ok(())
    }

    /// 解析 cron 表达式
    fn parse_cron(cron: &str) -> Result<CronSchedule> {
        CronSchedule::from_str(cron).map_err(|e| {
            ServiceError::InvalidSchedule(format!("invalid cron expression '{}': {}", cron, e))
        })
    }

    /// 获取下次执行时间
    pub fn next_run(cron: &str) -> Result<Option<chrono::DateTime<chrono::Utc>>> {
        let schedule = Self::parse_cron(cron)?;
        Ok(schedule.upcoming(Utc).next())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_cron() {
        // 有效的 cron 表达式
        assert!(ServiceScheduler::validate_cron("0 0 8 * * *").is_ok());
        assert!(ServiceScheduler::validate_cron("0 30 6 * * 1-5").is_ok());
        assert!(ServiceScheduler::validate_cron("0 0 */2 * * *").is_ok());

        // 无效的 cron 表达式
        assert!(ServiceScheduler::validate_cron("invalid").is_err());
        assert!(ServiceScheduler::validate_cron("").is_err());
    }

    #[test]
    fn test_next_run() {
        let next = ServiceScheduler::next_run("0 0 8 * * *").unwrap();
        assert!(next.is_some());
    }
}
