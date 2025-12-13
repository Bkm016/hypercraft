//! Service management operations.

mod create;
mod lifecycle;
pub mod schedule;

use super::output::OutputFormat;
use super::ui::{
    finish_progress_error, finish_progress_success, format_state, print_empty, print_error,
    print_header, print_hint, print_kv, print_kv_colored, print_progress, print_section,
    print_success, print_table_header, print_warning, KvColor,
};
use crate::client::handle_error;
use crossterm::style::Stylize;
use hypercraft_core::{ServiceManifest, ServiceSummary};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

// Re-exports
pub use create::{create_service, create_service_interactive};
pub use lifecycle::{restart_service, start_service, status_service, stop_service};

/// List services.
pub async fn list_services(
    client: &reqwest::Client,
    base: &str,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let url = format!("{}/services", base);
    let resp = client.get(url).send().await?;
    let resp = handle_error(resp).await?;
    let services: Vec<ServiceSummary> = resp.json().await?;

    match output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&services)?),
        OutputFormat::Table => {
            print_header("📋 SERVICE LIST");

            if services.is_empty() {
                print_empty("No services found. Use 'create-i' to create one.");
                return Ok(());
            }

            // Count stats
            let running = services
                .iter()
                .filter(|s| format!("{:?}", s.state).to_lowercase() == "running")
                .count();
            let stopped = services.len() - running;

            println!(
                "  Total: {}  |  {} Running  |  {} Stopped",
                services.len().to_string().white().bold(),
                running.to_string().green(),
                stopped.to_string().dark_grey()
            );
            println!();

            print_table_header(&[("ID", 24), ("NAME", 20), ("STATUS", 14)]);

            for svc in &services {
                let state_str = format!("{:?}", svc.state);
                let status_display = format_state(&state_str);
                // 使用字符级别截断，避免中文字符边界问题
                let name_display: String = if svc.name.chars().count() > 18 {
                    format!("{}...", svc.name.chars().take(15).collect::<String>())
                } else {
                    svc.name.clone()
                };
                println!(
                    "  {:<24} {:<20} {}",
                    svc.id.as_str().cyan(),
                    name_display,
                    status_display
                );
            }
            println!();
            print_hint("Use 'info <id>' to see service details");
        }
    }
    Ok(())
}

/// Fetch manifest + status.
pub async fn get_service(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let url = format!("{}/services/{}", base, id);
    let resp = client.get(url).send().await?;
    let resp = handle_error(resp).await?;
    let json: Value = resp.json().await?;

    match output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&json)?),
        OutputFormat::Table => {
            print_header(&format!("📦 SERVICE: {}", id.to_uppercase()));

            // Extract manifest and status
            if let Some(manifest) = json.get("manifest") {
                print_section("Configuration");

                if let Some(name) = manifest.get("name").and_then(|v| v.as_str()) {
                    print_kv_colored("Name", name, KvColor::White);
                }
                if let Some(cmd) = manifest.get("command").and_then(|v| v.as_str()) {
                    print_kv_colored("Command", cmd, KvColor::Yellow);
                }
                if let Some(args) = manifest.get("args").and_then(|v| v.as_array()) {
                    if !args.is_empty() {
                        let args_str: Vec<&str> = args.iter().filter_map(|a| a.as_str()).collect();
                        print_kv("Arguments", &args_str.join(" "));
                    }
                }
                if let Some(cwd) = manifest.get("cwd").and_then(|v| v.as_str()) {
                    print_kv_colored("Working Dir", cwd, KvColor::Cyan);
                }
                if let Some(env) = manifest.get("env").and_then(|v| v.as_object()) {
                    if !env.is_empty() {
                        print_kv("Environment", &format!("{} variable(s)", env.len()));
                        for (k, v) in env {
                            let v_str = v.as_str().unwrap_or("");
                            let display_v = if v_str.chars().count() > 25 {
                                format!("{}...", v_str.chars().take(22).collect::<String>())
                            } else {
                                v_str.to_string()
                            };
                            println!(
                                "    {} {} = {}",
                                "•".dark_grey(),
                                k.as_str().green(),
                                display_v
                            );
                        }
                    }
                }
                if let Some(auto_start) = manifest.get("auto_start").and_then(|v| v.as_bool()) {
                    print_kv("Auto Start", if auto_start { "Yes" } else { "No" });
                }
                if let Some(auto_restart) = manifest.get("auto_restart").and_then(|v| v.as_bool()) {
                    print_kv("Auto Restart", if auto_restart { "Yes" } else { "No" });
                }
                if let Some(created) = manifest.get("created_at").and_then(|v| v.as_str()) {
                    print_kv("Created", created);
                }
                if let Some(log_path) = manifest.get("log_path").and_then(|v| v.as_str()) {
                    print_kv_colored("Log Path", log_path, KvColor::Cyan);
                }
            }

            if let Some(status) = json.get("status") {
                print_section("Runtime Status");

                if let Some(state) = status.get("state").and_then(|v| v.as_str()) {
                    println!("  {:<14} {}", "Status:".dark_grey(), format_state(state));
                }
                if let Some(pid) = status.get("pid").and_then(|v| v.as_u64()) {
                    print_kv_colored("PID", &pid.to_string(), KvColor::Cyan);
                }
                if let Some(uptime) = status.get("uptime_ms").and_then(|v| v.as_u64()) {
                    print_kv_colored("Uptime", &super::ui::format_uptime(uptime), KvColor::Green);
                }
            }
            println!();
        }
    }
    Ok(())
}

/// Update manifest by id.
pub async fn update_service(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    file: PathBuf,
    output: OutputFormat,
) -> anyhow::Result<()> {
    print_header(&format!("🔄 UPDATE SERVICE: {}", id.to_uppercase()));

    print_progress("Reading manifest file");
    let data = match fs::read_to_string(&file) {
        Ok(d) => {
            finish_progress_success("Manifest file loaded");
            d
        }
        Err(e) => {
            finish_progress_error(&format!("Failed to read file: {}", e));
            return Err(e.into());
        }
    };

    let manifest: ServiceManifest = match serde_json::from_str(&data) {
        Ok(m) => m,
        Err(e) => {
            print_error(&format!("Invalid JSON: {}", e));
            return Err(e.into());
        }
    };

    print_progress("Updating service configuration");
    let url = format!("{}/services/{}", base, id);
    let resp = client.put(url).json(&manifest).send().await?;

    match handle_error(resp).await {
        Ok(_) => {
            finish_progress_success("Service updated");
            println!();
            print_success(&format!("Service '{}' updated successfully!", id));
            println!();

            // Show updated info
            print_section("Updated Configuration");
            get_service(client, base, id, output).await?;
        }
        Err(e) => {
            finish_progress_error("Update failed");
            print_error(&format!("{}", e));
            return Err(e);
        }
    }

    Ok(())
}

/// Delete a service.
pub async fn delete_service(client: &reqwest::Client, base: &str, id: &str) -> anyhow::Result<()> {
    print_header(&format!("🗑️  DELETE SERVICE: {}", id.to_uppercase()));

    print_warning(&format!("This will permanently delete service '{}'", id));
    println!();

    print_progress("Deleting service");
    let url = format!("{}/services/{}", base, id);
    let resp = client.delete(url).send().await?;

    match handle_error(resp).await {
        Ok(_) => {
            finish_progress_success("Service deleted");
            println!();
            print_success(&format!("Service '{}' has been deleted.", id));
            println!();
        }
        Err(e) => {
            finish_progress_error("Delete failed");
            print_error(&format!("{}", e));
            return Err(e);
        }
    }
    Ok(())
}

/// Internal helper to create service from manifest.
pub(crate) async fn create_service_from_manifest(
    client: &reqwest::Client,
    base: &str,
    manifest: ServiceManifest,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let url = format!("{}/services", base);
    let resp = client.post(url).json(&manifest).send().await?;
    let resp = handle_error(resp).await?;
    let created: ServiceManifest = resp.json().await?;

    match output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&created)?),
        OutputFormat::Table => {
            // Don't print anything here - the caller handles output
        }
    }
    Ok(())
}
