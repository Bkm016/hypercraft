use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

/// Minimal listing info for a service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceSummary {
    pub id: String,
    pub name: String,
    pub state: ServiceState,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub order: i32,
}

/// Runtime state enumeration.
#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceState {
    Running,
    Stopped,
    Unknown,
}

/// Detailed status for a service.
#[skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub state: ServiceState,
    pub pid: Option<u32>,
    pub uptime_ms: Option<u64>,
}

/// Service group for organizing services.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub order: i32,
    #[serde(default)]
    pub color: Option<String>,
}
