//! Schedule management operations for services.

use super::super::output::OutputFormat;
use super::super::ui::{
    finish_progress_error, finish_progress_success, print_empty, print_error, print_header,
    print_hint, print_kv, print_kv_colored, print_progress, print_section, print_success,
    print_warning, KvColor,
};
use crate::client::handle_error;
use crossterm::style::Stylize;
use serde::{Deserialize, Serialize};

/// Schedule action type
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScheduleAction {
    Start,
    Restart,
    Stop,
}

impl std::fmt::Display for ScheduleAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScheduleAction::Start => write!(f, "start"),
            ScheduleAction::Restart => write!(f, "restart"),
            ScheduleAction::Stop => write!(f, "stop"),
        }
    }
}

impl std::str::FromStr for ScheduleAction {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "start" => Ok(ScheduleAction::Start),
            "restart" => Ok(ScheduleAction::Restart),
            "stop" => Ok(ScheduleAction::Stop),
            _ => Err(format!("invalid action: {}, expected: start|restart|stop", s)),
        }
    }
}

/// Schedule configuration
#[derive(Debug, Serialize, Deserialize)]
pub struct Schedule {
    pub enabled: bool,
    pub cron: String,
    pub action: ScheduleAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
}

/// Response from get schedule API
#[derive(Debug, Serialize, Deserialize)]
struct ScheduleResponse {
    schedule: Option<Schedule>,
    next_run: Option<String>,
}

/// Request to update schedule
#[derive(Debug, Serialize)]
struct UpdateScheduleRequest {
    schedule: Option<Schedule>,
}

/// Get schedule for a service.
pub async fn get_schedule(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let url = format!("{}/services/{}/schedule", base, id);
    let resp = client.get(url).send().await?;
    let resp = handle_error(resp).await?;
    let data: ScheduleResponse = resp.json().await?;

    match output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&data)?),
        OutputFormat::Table => {
            print_header(&format!("SCHEDULE: {}", id.to_uppercase()));

            match data.schedule {
                Some(schedule) => {
                    print_section("Configuration");
                    print_kv_colored(
                        "Status",
                        if schedule.enabled { "Enabled" } else { "Disabled" },
                        if schedule.enabled {
                            KvColor::Green
                        } else {
                            KvColor::Grey
                        },
                    );
                    print_kv_colored("Cron", &schedule.cron, KvColor::Yellow);
                    print_kv("Action", &schedule.action.to_string());
                    if let Some(tz) = &schedule.timezone {
                        print_kv("Timezone", tz);
                    }

                    if let Some(next) = &data.next_run {
                        print_section("Next Execution");
                        print_kv_colored("Next Run", next, KvColor::Cyan);
                    }

                    println!();
                    print_cron_help(&schedule.cron);
                }
                None => {
                    print_empty("No schedule configured for this service.");
                    println!();
                    print_hint("Use 'schedule set <id> --cron \"...\"' to configure a schedule");
                }
            }
            println!();
        }
    }
    Ok(())
}

/// Set schedule for a service.
pub async fn set_schedule(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    cron: &str,
    action: ScheduleAction,
    enabled: bool,
    output: OutputFormat,
) -> anyhow::Result<()> {
    print_header(&format!("SET SCHEDULE: {}", id.to_uppercase()));

    // Validate cron expression first
    print_progress("Validating cron expression");
    let validate_url = format!("{}/schedule/validate", base);
    let validate_resp = client
        .post(&validate_url)
        .json(&serde_json::json!({ "cron": cron }))
        .send()
        .await?;
    let validate_resp = handle_error(validate_resp).await?;
    let validate_result: serde_json::Value = validate_resp.json().await?;

    if !validate_result
        .get("valid")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        finish_progress_error("Invalid cron expression");
        if let Some(err) = validate_result.get("error").and_then(|v| v.as_str()) {
            print_error(err);
        }
        return Err(anyhow::anyhow!("invalid cron expression"));
    }
    finish_progress_success("Cron expression valid");

    // Update schedule
    print_progress("Updating schedule");
    let url = format!("{}/services/{}/schedule", base, id);
    let req = UpdateScheduleRequest {
        schedule: Some(Schedule {
            enabled,
            cron: cron.to_string(),
            action,
            timezone: None,
        }),
    };
    let resp = client.put(url).json(&req).send().await?;

    match handle_error(resp).await {
        Ok(resp) => {
            finish_progress_success("Schedule updated");
            let data: ScheduleResponse = resp.json().await?;

            match output {
                OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&data)?),
                OutputFormat::Table => {
                    println!();
                    print_success(&format!("Schedule for '{}' has been configured!", id));

                    if let Some(schedule) = &data.schedule {
                        print_section("Configuration");
                        print_kv_colored(
                            "Status",
                            if schedule.enabled { "Enabled" } else { "Disabled" },
                            if schedule.enabled {
                                KvColor::Green
                            } else {
                                KvColor::Grey
                            },
                        );
                        print_kv_colored("Cron", &schedule.cron, KvColor::Yellow);
                        print_kv("Action", &schedule.action.to_string());
                    }

                    if let Some(next) = &data.next_run {
                        print_section("Next Execution");
                        print_kv_colored("Next Run", next, KvColor::Cyan);
                    }

                    println!();
                }
            }
        }
        Err(e) => {
            finish_progress_error("Update failed");
            print_error(&format!("{}", e));
            return Err(e);
        }
    }

    Ok(())
}

/// Remove schedule from a service.
pub async fn remove_schedule(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    output: OutputFormat,
) -> anyhow::Result<()> {
    print_header(&format!("REMOVE SCHEDULE: {}", id.to_uppercase()));

    print_warning(&format!(
        "This will remove the scheduled task for service '{}'",
        id
    ));
    println!();

    print_progress("Removing schedule");
    let url = format!("{}/services/{}/schedule", base, id);
    let req = UpdateScheduleRequest { schedule: None };
    let resp = client.put(url).json(&req).send().await?;

    match handle_error(resp).await {
        Ok(_) => {
            finish_progress_success("Schedule removed");
            println!();
            print_success(&format!("Schedule for '{}' has been removed.", id));
            println!();
        }
        Err(e) => {
            finish_progress_error("Remove failed");
            print_error(&format!("{}", e));
            return Err(e);
        }
    }

    match output {
        OutputFormat::Json => println!(r#"{{"removed": true}}"#),
        OutputFormat::Table => {}
    }

    Ok(())
}

/// Enable or disable a schedule.
pub async fn toggle_schedule(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    enable: bool,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let action_str = if enable { "ENABLE" } else { "DISABLE" };
    print_header(&format!("{} SCHEDULE: {}", action_str, id.to_uppercase()));

    // Get current schedule
    let url = format!("{}/services/{}/schedule", base, id);
    let resp = client.get(&url).send().await?;
    let resp = handle_error(resp).await?;
    let data: ScheduleResponse = resp.json().await?;

    let schedule = match data.schedule {
        Some(mut s) => {
            s.enabled = enable;
            s
        }
        None => {
            print_error("No schedule configured for this service. Use 'schedule set' first.");
            return Err(anyhow::anyhow!("no schedule configured"));
        }
    };

    print_progress(&format!(
        "{} schedule",
        if enable { "Enabling" } else { "Disabling" }
    ));
    let req = UpdateScheduleRequest {
        schedule: Some(schedule),
    };
    let resp = client.put(&url).json(&req).send().await?;

    match handle_error(resp).await {
        Ok(resp) => {
            finish_progress_success(&format!(
                "Schedule {}",
                if enable { "enabled" } else { "disabled" }
            ));

            let data: ScheduleResponse = resp.json().await?;

            match output {
                OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&data)?),
                OutputFormat::Table => {
                    println!();
                    print_success(&format!(
                        "Schedule for '{}' is now {}.",
                        id,
                        if enable { "enabled" } else { "disabled" }
                    ));

                    if enable {
                        if let Some(next) = &data.next_run {
                            print_section("Next Execution");
                            print_kv_colored("Next Run", next, KvColor::Cyan);
                        }
                    }
                    println!();
                }
            }
        }
        Err(e) => {
            finish_progress_error("Operation failed");
            print_error(&format!("{}", e));
            return Err(e);
        }
    }

    Ok(())
}

/// Print cron expression help
fn print_cron_help(cron: &str) {
    print_section("Cron Format Reference");
    println!(
        "  {} {} {} {} {} {}",
        "sec".dark_grey(),
        "min".dark_grey(),
        "hour".dark_grey(),
        "day".dark_grey(),
        "month".dark_grey(),
        "weekday".dark_grey()
    );
    println!(
        "  {}  {}  {}   {}  {}    {}",
        "│".dark_grey(),
        "│".dark_grey(),
        "│".dark_grey(),
        "│".dark_grey(),
        "│".dark_grey(),
        "│".dark_grey()
    );

    // Parse and explain the cron expression
    let parts: Vec<&str> = cron.split_whitespace().collect();
    if parts.len() >= 6 {
        println!(
            "  {}  {}  {}   {}  {}    {}",
            parts[0].cyan(),
            parts[1].cyan(),
            parts[2].cyan(),
            parts[3].cyan(),
            parts[4].cyan(),
            parts[5].cyan()
        );
    }

    println!();
    println!("  {}", "Common Examples:".dark_grey());
    println!(
        "    {} - Every day at 8:00 AM",
        "0 0 8 * * *".yellow()
    );
    println!(
        "    {} - Weekdays at 6:30 AM",
        "0 30 6 * * 1-5".yellow()
    );
    println!(
        "    {} - Every 2 hours",
        "0 0 */2 * * *".yellow()
    );
}
