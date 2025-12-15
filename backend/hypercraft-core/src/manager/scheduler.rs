//! 定时调度器：基于 cron 表达式的服务定时启动/重启/停止。

use crate::error::{Result, ServiceError};
use crate::manifest::{Schedule, ScheduleAction};
use crate::ServiceManager;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_cron_scheduler::{Job, JobScheduler, JobSchedulerError};
use tracing::{error, info, warn};
use uuid::Uuid;

/// 调度器：管理所有服务的定时任务
#[derive(Clone)]
pub struct ServiceScheduler {
    /// 内部调度器实例
    scheduler: Arc<RwLock<Option<JobScheduler>>>,
    /// 服务 ID -> Job UUID 的映射
    jobs: Arc<RwLock<HashMap<String, Uuid>>>,
    /// ServiceManager 引用
    manager: ServiceManager,
}

impl ServiceScheduler {
    /// 创建新的调度器
    pub fn new(manager: ServiceManager) -> Self {
        Self {
            scheduler: Arc::new(RwLock::new(None)),
            jobs: Arc::new(RwLock::new(HashMap::new())),
            manager,
        }
    }

    /// 启动调度器（懒加载，仅在需要时启动）
    async fn ensure_started(&self) -> Result<()> {
        let guard = self.scheduler.read().await;
        if guard.is_some() {
            return Ok(());
        }
        drop(guard);

        let mut write_guard = self.scheduler.write().await;
        // 双重检查
        if write_guard.is_some() {
            return Ok(());
        }

        let scheduler = JobScheduler::new()
            .await
            .map_err(|e| ServiceError::Other(format!("failed to create scheduler: {e}")))?;

        scheduler
            .start()
            .await
            .map_err(|e| ServiceError::Other(format!("failed to start scheduler: {e}")))?;

        *write_guard = Some(scheduler);
        info!("service scheduler started (lazy)");
        Ok(())
    }

    /// 启动调度器（兼容旧 API，现在是空操作）
    pub async fn start(&self) -> Result<()> {
        // 调度器现在是懒加载的，这里不再预启动
        info!("scheduler configured (will start when first schedule is added)");
        Ok(())
    }

    /// 停止调度器
    pub async fn shutdown(&self) -> Result<()> {
        let mut guard = self.scheduler.write().await;
        if let Some(mut scheduler) = guard.take() {
            scheduler
                .shutdown()
                .await
                .map_err(|e| ServiceError::Other(format!("failed to shutdown scheduler: {e}")))?;
            info!("service scheduler stopped");
        }
        self.jobs.write().await.clear();
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

        // 验证 cron 表达式
        Self::validate_cron(&schedule.cron)?;

        // 懒加载：仅在需要时启动调度器
        self.ensure_started().await?;

        let scheduler_guard = self.scheduler.read().await;
        let scheduler = scheduler_guard
            .as_ref()
            .ok_or_else(|| ServiceError::Other("scheduler not started".into()))?;

        let manager = self.manager.clone();
        let sid = service_id.to_string();
        let action = schedule.action.clone();
        let cron_expr = schedule.cron.clone();

        let job = Job::new_async(cron_expr.as_str(), move |_uuid, _lock| {
            let manager = manager.clone();
            let sid = sid.clone();
            let action = action.clone();
            Box::pin(async move {
                info!("scheduled task triggered for service: {}", sid);
                let result = match action {
                    ScheduleAction::Start => {
                        // 仅在服务未运行时启动
                        match manager.status(&sid).await {
                            Ok(status) if status.state == crate::models::ServiceState::Stopped => {
                                manager.start(&sid).await.map(|_| ())
                            }
                            Ok(_) => {
                                info!("service {} is already running, skipping scheduled start", sid);
                                Ok(())
                            }
                            Err(e) => Err(e),
                        }
                    }
                    ScheduleAction::Restart => manager.restart(&sid).await.map(|_| ()),
                    ScheduleAction::Stop => {
                        // 仅在服务运行时停止
                        match manager.status(&sid).await {
                            Ok(status) if status.state == crate::models::ServiceState::Running => {
                                manager.stop(&sid).await.map(|_| ())
                            }
                            Ok(_) => {
                                info!("service {} is not running, skipping scheduled stop", sid);
                                Ok(())
                            }
                            Err(e) => Err(e),
                        }
                    }
                };

                if let Err(e) = result {
                    error!("scheduled {} failed for service {}: {}", 
                        match action {
                            ScheduleAction::Start => "start",
                            ScheduleAction::Restart => "restart",
                            ScheduleAction::Stop => "stop",
                        },
                        sid, e
                    );
                }
            })
        })
        .map_err(|e: JobSchedulerError| {
            ServiceError::Other(format!("failed to create job: {e}"))
        })?;

        let job_id = job.guid();
        scheduler.add(job).await.map_err(|e| {
            ServiceError::Other(format!("failed to add job to scheduler: {e}"))
        })?;

        self.jobs.write().await.insert(service_id.to_string(), job_id);
        info!(
            "scheduled task added for service {}: {} ({})",
            service_id,
            schedule.cron,
            match schedule.action {
                ScheduleAction::Start => "start",
                ScheduleAction::Restart => "restart",
                ScheduleAction::Stop => "stop",
            }
        );

        Ok(())
    }

    /// 移除指定服务的定时任务
    pub async fn remove_schedule(&self, service_id: &str) -> Result<()> {
        let job_id = self.jobs.write().await.remove(service_id);

        if let Some(job_id) = job_id {
            let scheduler_guard = self.scheduler.read().await;
            if let Some(scheduler) = scheduler_guard.as_ref() {
                scheduler.remove(&job_id).await.map_err(|e| {
                    ServiceError::Other(format!("failed to remove job: {e}"))
                })?;
                info!("scheduled task removed for service: {}", service_id);
            }
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

    /// 获取所有已注册的定时任务
    pub async fn list_schedules(&self) -> Vec<String> {
        self.jobs.read().await.keys().cloned().collect()
    }

    /// 验证 cron 表达式
    pub fn validate_cron(cron: &str) -> Result<()> {
        use cron::Schedule;
        cron.parse::<Schedule>().map_err(|e| {
            ServiceError::InvalidSchedule(format!("invalid cron expression '{}': {}", cron, e))
        })?;
        Ok(())
    }

    /// 获取下次执行时间
    pub fn next_run(cron: &str) -> Result<Option<chrono::DateTime<chrono::Utc>>> {
        use cron::Schedule;
        let schedule = cron.parse::<Schedule>().map_err(|e| {
            ServiceError::InvalidSchedule(format!("invalid cron expression: {}", e))
        })?;
        Ok(schedule.upcoming(chrono::Utc).next())
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
