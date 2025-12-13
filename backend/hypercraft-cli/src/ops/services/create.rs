//! Service creation operations (file-based and interactive).

use super::create_service_from_manifest;
use crate::ops::output::OutputFormat;
use crossterm::style::Stylize;
use dialoguer::{theme::ColorfulTheme, Confirm, Editor, Input, Select};
use hypercraft_core::ServiceManifest;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

/// Create service from manifest file.
pub async fn create_service(
    client: &reqwest::Client,
    base: &str,
    file: PathBuf,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let data = fs::read_to_string(file)?;
    let manifest: ServiceManifest = serde_json::from_str(&data)?;
    create_service_from_manifest(client, base, manifest, output).await
}

/// Interactive manifest creation helper with beautiful UI.
pub async fn create_service_interactive(
    client: &reqwest::Client,
    base: &str,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let theme = ColorfulTheme::default();

    // ══════════════════════════════════════════════════════════════
    // Header
    // ══════════════════════════════════════════════════════════════
    println!();
    println!(
        "{}",
        "╔══════════════════════════════════════════════════════════════╗".dark_cyan()
    );
    println!(
        "{}",
        "║           🚀 CREATE NEW SERVICE - INTERACTIVE MODE           ║".dark_cyan()
    );
    println!(
        "{}",
        "╚══════════════════════════════════════════════════════════════╝".dark_cyan()
    );
    println!();

    // Step 1: Basic Info
    let (id, name) = prompt_basic_info(&theme)?;

    // Step 2: Command Configuration
    let (command, args) = prompt_command(&theme)?;

    // Step 3: Working Directory
    let cwd = prompt_working_directory(&theme)?;

    // Step 4: Environment Variables
    let env = prompt_environment(&theme)?;

    // Step 5: Advanced Options
    let (auto_restart, auto_start, run_as, log_path, clear_log_on_start) = prompt_advanced_options(&theme)?;

    // Preview & Confirm
    if !preview_and_confirm(&theme, &id, &name, &command, &args, &cwd, &env, auto_restart, auto_start, run_as.as_deref(), log_path.as_deref(), clear_log_on_start)? {
        println!("  {} Service creation cancelled.", "✗".red());
        return Ok(());
    }

    // Create Service
    let manifest = ServiceManifest {
        id: id.clone(),
        name,
        command,
        args,
        env,
        cwd,
        auto_start,
        auto_restart,
        shutdown_command: None,
        run_as,
        created_at: None,
        tags: vec![],
        group: None,
        order: 0,
        log_path,
        clear_log_on_start,
        schedule: None,
    };

    println!();
    print!("  {} Creating service...", "⏳".yellow());

    let result = create_service_from_manifest(client, base, manifest, output).await;

    match &result {
        Ok(_) => {
            println!(
                "\r  {} Service '{}' created successfully!       ",
                "✓".green(),
                id.as_str().green().bold()
            );
            println!();
            println!(
                "  {} Use '{}' to start the service",
                "💡".yellow(),
                format!("start {}", id).cyan()
            );
        }
        Err(e) => {
            println!("\r  {} Failed to create service: {}       ", "✗".red(), e);
        }
    }

    result
}

// ════════════════════════════════════════════════════════════════════════════
// Step Functions
// ════════════════════════════════════════════════════════════════════════════

fn prompt_basic_info(theme: &ColorfulTheme) -> anyhow::Result<(String, String)> {
    print_step(1, "Basic Information");

    let id: String = Input::with_theme(theme)
        .with_prompt("Service ID (unique identifier)")
        .validate_with(|v: &String| -> Result<(), &str> {
            if v.is_empty() {
                return Err("ID cannot be empty");
            }
            if !v
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
            {
                return Err("ID can only contain letters, numbers, '-', '_', '.'");
            }
            Ok(())
        })
        .interact_text()?;

    let name: String = Input::with_theme(theme)
        .with_prompt("Display name")
        .default(id.clone())
        .interact_text()?;

    Ok((id, name))
}

fn prompt_command(theme: &ColorfulTheme) -> anyhow::Result<(String, Vec<String>)> {
    print_step(2, "Command Configuration");

    let command_templates = vec![
        "Custom command...",
        "java -jar <file.jar>",
        "python <script.py>",
        "node <script.js>",
        "npm start",
        "cargo run",
        "./start.sh",
    ];

    let template_idx = Select::with_theme(theme)
        .with_prompt("Select command template or enter custom")
        .items(&command_templates)
        .default(0)
        .interact()?;

    let command_input: String = if template_idx == 0 {
        Input::with_theme(theme)
            .with_prompt("Enter full command")
            .validate_with(|v: &String| -> Result<(), &str> {
                if v.trim().is_empty() {
                    Err("Command cannot be empty")
                } else {
                    Ok(())
                }
            })
            .interact_text()?
    } else {
        let template = command_templates[template_idx];
        if template.contains('<') && template.contains('>') {
            // Has placeholder, ask user to fill in
            let placeholder_hint = template
                .split('<')
                .nth(1)
                .and_then(|s| s.split('>').next())
                .unwrap_or("value");
            let user_value: String = Input::with_theme(theme)
                .with_prompt(format!(
                    "Enter {} for template: {}",
                    placeholder_hint, template
                ))
                .interact_text()?;
            template.replace(&format!("<{}>", placeholder_hint), &user_value)
        } else {
            template.to_string()
        }
    };

    // Parse command and args
    let (command, mut args) = if let Ok(mut parts) = shell_words::split(&command_input) {
        if !parts.is_empty() {
            let cmd = parts.remove(0);
            (cmd, parts)
        } else {
            (command_input.clone(), vec![])
        }
    } else {
        (command_input.clone(), vec![])
    };

    // Additional arguments
    let add_more_args = Confirm::with_theme(theme)
        .with_prompt("Add more command arguments?")
        .default(false)
        .interact()?;

    if add_more_args {
        let extra_args: String = Input::with_theme(theme)
            .with_prompt("Additional arguments (space separated)")
            .allow_empty(true)
            .interact_text()?;
        if !extra_args.trim().is_empty() {
            if let Ok(parsed) = shell_words::split(&extra_args) {
                args.extend(parsed);
            }
        }
    }

    Ok((command, args))
}

fn prompt_working_directory(theme: &ColorfulTheme) -> anyhow::Result<Option<String>> {
    print_step(3, "Working Directory");

    let cwd_options = vec![
        "Use server default (recommended)",
        "Specify custom directory",
    ];

    let cwd_choice = Select::with_theme(theme)
        .with_prompt("Working directory")
        .items(&cwd_options)
        .default(0)
        .interact()?;

    if cwd_choice == 1 {
        let dir: String = Input::with_theme(theme)
            .with_prompt("Enter working directory path")
            .interact_text()?;
        if dir.trim().is_empty() {
            Ok(None)
        } else {
            Ok(Some(dir))
        }
    } else {
        Ok(None)
    }
}

fn prompt_environment(theme: &ColorfulTheme) -> anyhow::Result<BTreeMap<String, String>> {
    print_step(4, "Environment Variables");

    let mut env: BTreeMap<String, String> = BTreeMap::new();

    let env_options = vec![
        "No environment variables",
        "Add variables one by one",
        "Paste multiple (KEY=VALUE format, one per line)",
    ];

    let env_choice = Select::with_theme(theme)
        .with_prompt("Environment variables configuration")
        .items(&env_options)
        .default(0)
        .interact()?;

    match env_choice {
        1 => {
            // Add one by one
            loop {
                let key: String = Input::with_theme(theme)
                    .with_prompt("Variable name (empty to finish)")
                    .allow_empty(true)
                    .interact_text()?;

                if key.trim().is_empty() {
                    break;
                }

                let value: String = Input::with_theme(theme)
                    .with_prompt(format!("Value for {}", key))
                    .allow_empty(true)
                    .interact_text()?;

                env.insert(key, value);
                println!(
                    "  {} Added {} environment variable(s)",
                    "✓".green(),
                    env.len()
                );
            }
        }
        2 => {
            // Multi-line editor or paste
            println!(
                "  {} Enter variables in KEY=VALUE format, one per line.",
                "ℹ".blue()
            );
            println!("  {} Press Enter twice when done.", "ℹ".blue());

            if let Some(text) = Editor::new().edit(
                "# Enter environment variables (KEY=VALUE)\n# Lines starting with # are ignored\n",
            )? {
                for line in text.lines() {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with('#') {
                        continue;
                    }
                    if let Some((k, v)) = line.split_once('=') {
                        env.insert(k.trim().to_string(), v.trim().to_string());
                    }
                }
            }
            if !env.is_empty() {
                println!(
                    "  {} Parsed {} environment variable(s)",
                    "✓".green(),
                    env.len()
                );
            }
        }
        _ => {}
    }

    Ok(env)
}

fn prompt_advanced_options(theme: &ColorfulTheme) -> anyhow::Result<(bool, bool, Option<String>, Option<String>, bool)> {
    print_step(5, "Advanced Options");

    let auto_restart = Confirm::with_theme(theme)
        .with_prompt("Auto restart on crash?")
        .default(false)
        .interact()?;

    let auto_start = Confirm::with_theme(theme)
        .with_prompt("Auto start when core starts?")
        .default(false)
        .interact()?;

    let clear_log_on_start = Confirm::with_theme(theme)
        .with_prompt("Clear log file on service start?")
        .default(true)
        .interact()?;

    // Linux 下可以指定运行用户
    #[cfg(target_os = "linux")]
    let run_as = {
        let use_run_as = Confirm::with_theme(theme)
            .with_prompt("Run as a different user? (uses sudo -u)")
            .default(false)
            .interact()?;

        if use_run_as {
            let user: String = Input::with_theme(theme)
                .with_prompt("Enter username")
                .validate_with(|v: &String| -> Result<(), &str> {
                    if v.trim().is_empty() {
                        Err("Username cannot be empty")
                    } else {
                        Ok(())
                    }
                })
                .interact_text()?;
            Some(user)
        } else {
            None
        }
    };
    #[cfg(not(target_os = "linux"))]
    let run_as: Option<String> = None;

    // 日志路径配置
    let configure_log_path = Confirm::with_theme(theme)
        .with_prompt("Specify a log file path for this service?")
        .default(false)
        .interact()?;

    let log_path = if configure_log_path {
        let path: String = Input::with_theme(theme)
            .with_prompt("Enter log file path")
            .validate_with(|v: &String| -> Result<(), &str> {
                if v.trim().is_empty() {
                    Err("Log path cannot be empty")
                } else {
                    Ok(())
                }
            })
            .interact_text()?;
        Some(path)
    } else {
        None
    };

    Ok((auto_restart, auto_start, run_as, log_path, clear_log_on_start))
}

fn preview_and_confirm(
    theme: &ColorfulTheme,
    id: &str,
    name: &str,
    command: &str,
    args: &[String],
    cwd: &Option<String>,
    env: &BTreeMap<String, String>,
    auto_restart: bool,
    auto_start: bool,
    run_as: Option<&str>,
    log_path: Option<&str>,
    clear_log_on_start: bool,
) -> anyhow::Result<bool> {
    println!();
    println!(
        "{}",
        "┌──────────────────────────────────────────────────────────────┐".dark_cyan()
    );
    println!(
        "{}",
        "│                    📋 CONFIGURATION PREVIEW                  │".dark_cyan()
    );
    println!(
        "{}",
        "└──────────────────────────────────────────────────────────────┘".dark_cyan()
    );
    println!();

    println!("  {} {}", "ID:".dark_grey(), id.white().bold());
    println!("  {} {}", "Name:".dark_grey(), name.white());
    println!("  {} {}", "Command:".dark_grey(), command.yellow());
    if !args.is_empty() {
        println!("  {} {}", "Arguments:".dark_grey(), args.join(" ").yellow());
    }
    if let Some(ref dir) = cwd {
        println!("  {} {}", "Working Dir:".dark_grey(), dir.as_str().cyan());
    }
    if let Some(user) = run_as {
        println!("  {} {}", "Run As:".dark_grey(), user.magenta());
    }
    if let Some(path) = log_path {
        println!("  {} {}", "Log Path:".dark_grey(), path.cyan());
    }
    if !env.is_empty() {
        println!("  {} ", "Environment:".dark_grey());
        for (k, v) in env {
            let display_v = if v.chars().count() > 30 {
                format!("{}...", v.chars().take(27).collect::<String>())
            } else {
                v.clone()
            };
            println!(
                "    {} {} = {}",
                "•".dark_grey(),
                k.as_str().green(),
                display_v
            );
        }
    }
    println!(
        "  {} {}",
        "Auto Restart:".dark_grey(),
        if auto_restart {
            "Yes".green()
        } else {
            "No".dark_grey()
        }
    );
    println!(
        "  {} {}",
        "Auto Start:".dark_grey(),
        if auto_start {
            "Yes".green()
        } else {
            "No".dark_grey()
        }
    );
    println!(
        "  {} {}",
        "Clear Log on Start:".dark_grey(),
        if clear_log_on_start {
            "Yes".green()
        } else {
            "No".dark_grey()
        }
    );
    println!();

    let confirm = Confirm::with_theme(theme)
        .with_prompt("Create this service?")
        .default(true)
        .interact()?;

    Ok(confirm)
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════

fn print_step(num: u8, title: &str) {
    println!();
    println!(
        "  {} {} {}",
        format!("STEP {}", num).dark_cyan().bold(),
        "│".dark_grey(),
        title.white().bold()
    );
    println!("  {}", "─".repeat(50).dark_grey());
}
