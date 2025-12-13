//! Service lifecycle operations: start, stop, restart, status.

use crate::client::handle_error;
use crate::ops::output::OutputFormat;
use crate::ops::ui::{
    finish_progress_error, finish_progress_success, format_state, format_uptime, print_error,
    print_header, print_hint, print_kv_colored, print_progress, print_section, print_success,
    KvColor,
};
use crossterm::style::Stylize;
use hypercraft_core::ServiceStatus;

/// Start service.
pub async fn start_service(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    output: OutputFormat,
) -> anyhow::Result<()> {
    match output {
        OutputFormat::Json => {
            let url = format!("{}/services/{}/start", base, id);
            let resp = client.post(url).send().await?;
            let resp = handle_error(resp).await?;
            let status: ServiceStatus = resp.json().await?;
            println!("{}", serde_json::to_string_pretty(&status)?);
        }
        OutputFormat::Table => {
            print_header(&format!("▶️  START SERVICE: {}", id.to_uppercase()));

            print_progress("Starting service");
            let url = format!("{}/services/{}/start", base, id);
            let resp = client.post(url).send().await?;

            match handle_error(resp).await {
                Ok(resp) => {
                    let status: ServiceStatus = resp.json().await?;
                    finish_progress_success("Service started");
                    println!();

                    print_service_status(&status);
                    println!();
                    print_hint(&format!("Use 'attach {}' to connect to the console", id));
                }
                Err(e) => {
                    finish_progress_error("Failed to start");
                    println!();
                    print_error(&format!("{}", e));
                    return Err(e);
                }
            }
        }
    }
    Ok(())
}

/// Stop service.
pub async fn stop_service(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    output: OutputFormat,
) -> anyhow::Result<()> {
    match output {
        OutputFormat::Json => {
            let url = format!("{}/services/{}/stop", base, id);
            let resp = client.post(url).send().await?;
            let resp = handle_error(resp).await?;
            let status: ServiceStatus = resp.json().await?;
            println!("{}", serde_json::to_string_pretty(&status)?);
        }
        OutputFormat::Table => {
            print_header(&format!("⏹️  STOP SERVICE: {}", id.to_uppercase()));

            print_progress("Stopping service");
            let url = format!("{}/services/{}/stop", base, id);
            let resp = client.post(url).send().await?;

            match handle_error(resp).await {
                Ok(resp) => {
                    let status: ServiceStatus = resp.json().await?;
                    finish_progress_success("Service stopped");
                    println!();

                    print_service_status(&status);
                    println!();
                    print_success(&format!("Service '{}' has been stopped.", id));
                    println!();
                }
                Err(e) => {
                    finish_progress_error("Failed to stop");
                    println!();
                    print_error(&format!("{}", e));
                    return Err(e);
                }
            }
        }
    }
    Ok(())
}

/// Restart service.
pub async fn restart_service(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    output: OutputFormat,
) -> anyhow::Result<()> {
    match output {
        OutputFormat::Json => {
            let url = format!("{}/services/{}/restart", base, id);
            let resp = client.post(url).send().await?;
            let resp = handle_error(resp).await?;
            let status: ServiceStatus = resp.json().await?;
            println!("{}", serde_json::to_string_pretty(&status)?);
        }
        OutputFormat::Table => {
            print_header(&format!("🔄 RESTART SERVICE: {}", id.to_uppercase()));

            print_progress("Restarting service");
            let url = format!("{}/services/{}/restart", base, id);
            let resp = client.post(url).send().await?;

            match handle_error(resp).await {
                Ok(resp) => {
                    let status: ServiceStatus = resp.json().await?;
                    finish_progress_success("Service restarted");
                    println!();

                    print_service_status(&status);
                    println!();
                    print_success(&format!("Service '{}' has been restarted.", id));
                    println!();
                }
                Err(e) => {
                    finish_progress_error("Failed to restart");
                    println!();
                    print_error(&format!("{}", e));
                    return Err(e);
                }
            }
        }
    }
    Ok(())
}

/// Query status.
pub async fn status_service(
    client: &reqwest::Client,
    base: &str,
    id: &str,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let url = format!("{}/services/{}/status", base, id);
    let resp = client.get(url).send().await?;
    let resp = handle_error(resp).await?;
    let status: ServiceStatus = resp.json().await?;

    match output {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&status)?),
        OutputFormat::Table => {
            print_header(&format!("📊 STATUS: {}", id.to_uppercase()));
            print_service_status(&status);
            println!();

            // Show helpful hints based on state
            let state_str = format!("{:?}", status.state).to_lowercase();
            if state_str == "running" {
                print_hint(&format!("Use 'attach {}' to connect to the console", id));
                print_hint(&format!("Use 'logs {}' to view recent logs", id));
            } else {
                print_hint(&format!("Use 'start {}' to start the service", id));
            }
            println!();
        }
    }
    Ok(())
}

fn print_service_status(status: &ServiceStatus) {
    print_section("Service Status");

    let state_str = format!("{:?}", status.state);
    println!(
        "  {:<14} {}",
        "Status:".dark_grey(),
        format_state(&state_str)
    );

    if let Some(pid) = status.pid {
        print_kv_colored("PID", &pid.to_string(), KvColor::Cyan);
    }

    if let Some(uptime_ms) = status.uptime_ms {
        print_kv_colored("Uptime", &format_uptime(uptime_ms), KvColor::Green);
    }
}
