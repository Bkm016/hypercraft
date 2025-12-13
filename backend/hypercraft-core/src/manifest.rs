use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 定时调度动作
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ScheduleAction {
    /// 定时启动：如果服务未运行则启动
    #[default]
    Start,
    /// 定时重启：无论当前状态，执行重启
    Restart,
    /// 定时停止：如果服务正在运行则停止
    Stop,
}

/// 定时调度配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
    /// 是否启用定时调度
    #[serde(default)]
    pub enabled: bool,
    /// Cron 表达式 (秒 分 时 日 月 周)
    /// 示例: "0 0 8 * * *" 每天 08:00 启动
    /// 示例: "0 30 6 * * 1-5" 工作日 06:30 启动
    pub cron: String,
    /// 调度触发的动作
    #[serde(default)]
    pub action: ScheduleAction,
    /// 时区（可选，默认使用系统时区）
    #[serde(default)]
    pub timezone: Option<String>,
}

impl Default for Schedule {
    fn default() -> Self {
        Self {
            enabled: false,
            cron: String::new(),
            action: ScheduleAction::Start,
            timezone: None,
        }
    }
}

/// 服务清单结构体
/// 包含服务的完整配置信息，可序列化为 JSON 或反序列化自 JSON
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceManifest {
    /// 服务的唯一标识符
    pub id: String,
    /// 服务的显示名称
    pub name: String,
    /// 服务启动命令
    pub command: String,
    /// 启动命令的参数列表
    #[serde(default)]
    pub args: Vec<String>,
    /// 环境变量映射表
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// 服务的工作目录
    #[serde(default)]
    pub cwd: Option<String>,
    /// 是否在系统启动时自动启动服务
    #[serde(default)]
    pub auto_start: bool,
    /// 服务退出时是否自动重启
    #[serde(default)]
    pub auto_restart: bool,
    /// 启动时是否清空日志文件（默认 true）
    #[serde(default = "default_clear_log_on_start")]
    pub clear_log_on_start: bool,
    /// 优雅关闭时执行的命令
    #[serde(default)]
    pub shutdown_command: Option<String>,
    /// 服务运行的用户账户（如适用）
    #[serde(default)]
    pub run_as: Option<String>,
    /// 服务创建的时间戳
    #[serde(default)]
    pub created_at: Option<DateTime<Utc>>,
    /// 服务关联的标签列表
    #[serde(default)]
    pub tags: Vec<String>,
    /// 服务所属的组
    #[serde(default)]
    pub group: Option<String>,
    /// 服务在组内的排序顺序
    #[serde(default)]
    pub order: i32,
    /// 服务日志的输出路径
    #[serde(default)]
    pub log_path: Option<String>,
    /// 定时调度配置
    #[serde(default)]
    pub schedule: Option<Schedule>,
}

fn default_clear_log_on_start() -> bool {
    true
}