use super::ui::{print_error, print_header};
use super::{
    add_user_service, attach_service, create_service, create_service_interactive, create_user,
    delete_service, delete_user, get_service, get_user, list_services, list_users, login,
    logs_service, remove_user_service, restart_service, set_user_services, start_service,
    status_service, stop_service, update_service, update_user_password, OutputFormat,
};
use anyhow::anyhow;
use crossterm::style::Stylize;
use rustyline::completion::{Completer, Pair};
use rustyline::error::ReadlineError;
use rustyline::highlight::Highlighter;
use rustyline::hint::Hinter;
use rustyline::history::DefaultHistory;
use rustyline::validate::Validator;
use rustyline::{CompletionType, Config, Context, EditMode, Editor};
use std::borrow::Cow;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// All available commands for completion
const COMMANDS: &[&str] = &[
    "list", "ls", "info", "get", "create", "create-i", "new", "update", "delete", "rm", "start",
    "stop", "restart", "status", "logs", "attach", "help", "exit", "quit",
    "login", "user",
];

/// Commands that need service ID as argument
const SERVICE_ID_COMMANDS: &[&str] = &[
    "info", "get", "delete", "rm", "start", "stop", "restart", "status", "logs", "attach", "update",
];

/// Shared state for completer
struct CompleterState {
    service_ids: Vec<String>,
}

/// Custom completer for hypercraft shell
#[derive(Clone)]
struct HcCompleter {
    state: Arc<Mutex<CompleterState>>,
}

impl HcCompleter {
    fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(CompleterState {
                service_ids: Vec::new(),
            })),
        }
    }

    fn update_services_blocking(&self, ids: Vec<String>) {
        // Use try_lock for non-async context
        if let Ok(mut state) = self.state.try_lock() {
            state.service_ids = ids;
        }
    }

    fn get_services_blocking(&self) -> Vec<String> {
        self.state
            .try_lock()
            .map(|s| s.service_ids.clone())
            .unwrap_or_default()
    }
}

impl Completer for HcCompleter {
    type Candidate = Pair;

    fn complete(
        &self,
        line: &str,
        pos: usize,
        _ctx: &Context<'_>,
    ) -> rustyline::Result<(usize, Vec<Pair>)> {
        let line_to_cursor = &line[..pos];
        let tokens: Vec<&str> = line_to_cursor.split_whitespace().collect();

        // If empty or typing first word -> complete commands
        if tokens.is_empty() || (tokens.len() == 1 && !line_to_cursor.ends_with(' ')) {
            let prefix = tokens.first().copied().unwrap_or("");
            let matches: Vec<Pair> = COMMANDS
                .iter()
                .filter(|cmd| cmd.starts_with(prefix))
                .map(|cmd| Pair {
                    display: cmd.to_string(),
                    replacement: cmd.to_string(),
                })
                .collect();
            let start = line_to_cursor.rfind(' ').map(|i| i + 1).unwrap_or(0);
            return Ok((start, matches));
        }

        // If typing second word for service commands -> complete service IDs
        let cmd = tokens[0];
        if SERVICE_ID_COMMANDS.contains(&cmd) {
            let prefix = if line_to_cursor.ends_with(' ') {
                ""
            } else {
                tokens.get(1).copied().unwrap_or("")
            };

            let service_ids = self.get_services_blocking();
            let matches: Vec<Pair> = service_ids
                .iter()
                .filter(|id| id.starts_with(prefix))
                .map(|id| Pair {
                    display: id.clone(),
                    replacement: id.clone(),
                })
                .collect();
            let start = line_to_cursor.rfind(' ').map(|i| i + 1).unwrap_or(0);
            return Ok((start, matches));
        }

        Ok((pos, vec![]))
    }
}

impl Hinter for HcCompleter {
    type Hint = String;

    fn hint(&self, line: &str, pos: usize, _ctx: &Context<'_>) -> Option<String> {
        if pos < line.len() {
            return None;
        }

        let tokens: Vec<&str> = line.split_whitespace().collect();

        // Hint for commands
        if tokens.len() <= 1 && !line.ends_with(' ') {
            let prefix = tokens.first().copied().unwrap_or("");
            if !prefix.is_empty() {
                for cmd in COMMANDS {
                    if cmd.starts_with(prefix) && *cmd != prefix {
                        return Some(cmd[prefix.len()..].to_string());
                    }
                }
            }
        }

        // Hint for service IDs
        let cmd = tokens.first().copied().unwrap_or("");
        if SERVICE_ID_COMMANDS.contains(&cmd)
            && (tokens.len() == 1 || (tokens.len() == 2 && !line.ends_with(' ')))
        {
            let prefix = if line.ends_with(' ') {
                ""
            } else {
                tokens.get(1).copied().unwrap_or("")
            };

            if !prefix.is_empty() {
                let service_ids = self.get_services_blocking();
                for id in &service_ids {
                    if id.starts_with(prefix) && id != prefix {
                        return Some(id[prefix.len()..].to_string());
                    }
                }
            }
        }

        None
    }
}

impl Highlighter for HcCompleter {
    fn highlight_prompt<'b, 's: 'b, 'p: 'b>(
        &'s self,
        prompt: &'p str,
        _default: bool,
    ) -> Cow<'b, str> {
        // 给提示符添加颜色
        Cow::Owned(format!("\x1b[1;36m{}\x1b[0m", prompt))
    }

    fn highlight_hint<'h>(&self, hint: &'h str) -> Cow<'h, str> {
        Cow::Owned(format!("\x1b[90m{}\x1b[0m", hint))
    }
}

impl Validator for HcCompleter {}

impl rustyline::Helper for HcCompleter {}

/// Simple interactive shell (hc>) with common commands and auto-completion.
pub async fn shell_loop(
    client: &reqwest::Client,
    base: &str,
    output: OutputFormat,
    token: Option<&str>,
) -> anyhow::Result<()> {
    print_shell_banner();

    let config = Config::builder()
        .history_ignore_space(true)
        .completion_type(CompletionType::List)
        .edit_mode(EditMode::Emacs)
        .build();

    let completer = HcCompleter::new();
    let mut rl: Editor<HcCompleter, DefaultHistory> = Editor::with_config(config)?;
    rl.set_helper(Some(completer.clone()));

    // Try to load history
    let history_path = dirs_next::cache_dir().map(|p| p.join("hypercraft").join("history.txt"));
    if let Some(ref path) = history_path {
        let _ = std::fs::create_dir_all(path.parent().unwrap());
        let _ = rl.load_history(path);
    }

    // Initial fetch of service IDs for completion
    if let Ok(ids) = fetch_service_ids(client, base).await {
        completer.update_services_blocking(ids);
    }

    loop {
        // 提示符本身不带颜色，颜色由 Highlighter::highlight_prompt 添加
        let prompt = "hc> ";
        match rl.readline(prompt) {
            Ok(line) => {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }

                let _ = rl.add_history_entry(line);

                if matches!(line, "exit" | "quit") {
                    println!();
                    println!("  {} Goodbye!", "👋".yellow());
                    println!();
                    break;
                }
                if line == "help" {
                    print_help();
                    continue;
                }

                let tokens = match shell_words::split(line) {
                    Ok(t) if !t.is_empty() => t,
                    _ => continue,
                };

                let cmd = tokens[0].as_str();
                let args = &tokens[1..];

                let result = execute_command(client, base, output, token, cmd, args).await;

                // Refresh service IDs after mutations
                if matches!(cmd, "create" | "create-i" | "new" | "delete" | "rm") {
                    if let Ok(ids) = fetch_service_ids(client, base).await {
                        completer.update_services_blocking(ids);
                    }
                }

                if let Err(e) = result {
                    print_error(&format!("{}", e));
                }
            }
            Err(ReadlineError::Interrupted) => {
                println!("^C");
                continue;
            }
            Err(ReadlineError::Eof) => {
                println!();
                break;
            }
            Err(err) => {
                print_error(&format!("Error: {:?}", err));
                break;
            }
        }
    }

    // Save history
    if let Some(ref path) = history_path {
        let _ = rl.save_history(path);
    }

    Ok(())
}

async fn execute_command(
    client: &reqwest::Client,
    base: &str,
    output: OutputFormat,
    token: Option<&str>,
    cmd: &str,
    args: &[String],
) -> anyhow::Result<()> {
    match cmd {
        "list" | "ls" => list_services(client, base, output).await,
        "get" | "info" => match args {
            [id] => get_service(client, base, id, output).await,
            _ => Err(anyhow!("usage: info <id>")),
        },
        "create" => match args {
            [file] => {
                let path = PathBuf::from(file);
                create_service(client, base, path, output).await
            }
            _ => Err(anyhow!("usage: create <file>")),
        },
        "create-i" | "new" => create_service_interactive(client, base, output).await,
        "update" => match args {
            [id, file] => {
                let path = PathBuf::from(file);
                update_service(client, base, id, path, output).await
            }
            _ => Err(anyhow!("usage: update <id> <file>")),
        },
        "delete" | "rm" => match args {
            [id] => delete_service(client, base, id).await,
            _ => Err(anyhow!("usage: delete <id>")),
        },
        "start" => match args {
            [id] => start_service(client, base, id, output).await,
            _ => Err(anyhow!("usage: start <id>")),
        },
        "stop" => match args {
            [id] => stop_service(client, base, id, output).await,
            _ => Err(anyhow!("usage: stop <id>")),
        },
        "restart" => match args {
            [id] => restart_service(client, base, id, output).await,
            _ => Err(anyhow!("usage: restart <id>")),
        },
        "status" => match args {
            [id] => status_service(client, base, id, output).await,
            _ => Err(anyhow!("usage: status <id>")),
        },
        "logs" => {
            let id = args
                .first()
                .ok_or_else(|| anyhow!("usage: logs <id> [tail] [-f|--follow]"))?;
            let mut tail = 200usize;
            let mut follow = false;
            for arg in &args[1..] {
                if arg == "--follow" || arg == "-f" {
                    follow = true;
                } else if let Ok(n) = arg.parse::<usize>() {
                    tail = n;
                }
            }
            logs_service(client, base, id, tail, follow, output).await
        }
        "attach" => match args {
            [id] => attach_service(base, id, token).await,
            _ => Err(anyhow!("usage: attach <id>")),
        },
        // 认证命令
        "login" => match args {
            [username, password] => {
                login(client, base, username, password, output).await?;
                Ok(())
            }
            _ => Err(anyhow!("usage: login <username> <password>")),
        },
        // 用户管理命令
        "user" => {
            if args.is_empty() {
                return Err(anyhow!(
                    "usage: user <subcommand>\n  subcommands: list, get, create, delete, password, grant, revoke"
                ));
            }
            let subcmd = args[0].as_str();
            let subargs = &args[1..];
            match subcmd {
                "list" | "ls" => list_users(client, base, output).await,
                "get" | "info" => match subargs {
                    [id] => get_user(client, base, id, output).await,
                    _ => Err(anyhow!("usage: user get <user_id>")),
                },
                "create" | "new" => match subargs {
                    [username, password] => {
                        create_user(client, base, username, password, vec![], output).await
                    }
                    [username, password, services @ ..] => {
                        let svc_ids: Vec<String> = services.to_vec();
                        create_user(client, base, username, password, svc_ids, output).await
                    }
                    _ => Err(anyhow!(
                        "usage: user create <username> <password> [service_ids...]"
                    )),
                },
                "delete" | "rm" => match subargs {
                    [id] => delete_user(client, base, id).await,
                    _ => Err(anyhow!("usage: user delete <user_id>")),
                },
                "password" | "passwd" => match subargs {
                    [id, password] => {
                        update_user_password(client, base, id, password, None, output).await
                    }
                    [id, password, current] => {
                        update_user_password(
                            client,
                            base,
                            id,
                            password,
                            Some(current.as_str()),
                            output,
                        )
                        .await
                    }
                    _ => Err(anyhow!(
                        "usage: user password <user_id> <new_password> [current_password]"
                    )),
                },
                "services" | "set-services" => match subargs {
                    [id, services @ ..] => {
                        let svc_ids: Vec<String> = services.to_vec();
                        set_user_services(client, base, id, svc_ids, output).await
                    }
                    _ => Err(anyhow!("usage: user services <user_id> [service_ids...]")),
                },
                "grant" => match subargs {
                    [user_id, service_id] => {
                        add_user_service(client, base, user_id, service_id, output).await
                    }
                    _ => Err(anyhow!("usage: user grant <user_id> <service_id>")),
                },
                "revoke" => match subargs {
                    [user_id, service_id] => {
                        remove_user_service(client, base, user_id, service_id, output).await
                    }
                    _ => Err(anyhow!("usage: user revoke <user_id> <service_id>")),
                },
                _ => Err(anyhow!(
                    "unknown user subcommand: {}. Try: list, get, create, delete, password, grant, revoke",
                    subcmd
                )),
            }
        }
        "help" => {
            print_help();
            Ok(())
        }
        _ => {
            print_error(&format!(
                "Unknown command: '{}'. Type 'help' for usage.",
                cmd
            ));
            Ok(())
        }
    }
}

async fn fetch_service_ids(client: &reqwest::Client, base: &str) -> anyhow::Result<Vec<String>> {
    use hypercraft_core::ServiceSummary;
    let url = format!("{}/services", base);
    let resp = client.get(&url).send().await?;
    if resp.status().is_success() {
        let services: Vec<ServiceSummary> = resp.json().await?;
        Ok(services.into_iter().map(|s| s.id).collect())
    } else {
        Ok(vec![])
    }
}

fn print_shell_banner() {
    println!();
    println!(
        "{}",
        "╔══════════════════════════════════════════════════════════════╗".dark_cyan()
    );
    println!(
        "{}",
        "║                    🚀 HYPERCRAFT SHELL                       ║".dark_cyan()
    );
    println!(
        "{}",
        "╚══════════════════════════════════════════════════════════════╝".dark_cyan()
    );
    println!();
    println!(
        "  {}  Interactive mode. Type {} for commands, {} to exit.",
        "ℹ".blue(),
        "help".cyan(),
        "exit".cyan()
    );
    println!(
        "  {} Press {} for auto-completion.",
        "💡".yellow(),
        "Tab".cyan()
    );
    println!();
}

fn print_help() {
    print_header("📖 COMMAND REFERENCE");

    println!("  {}", "SERVICE MANAGEMENT".white().bold());
    println!("  {}", "─".repeat(50).dark_grey());
    print_cmd("list", "ls", "List all services");
    print_cmd("info <id>", "get", "Show service details");
    print_cmd("create-i", "new", "Create service interactively");
    print_cmd("create <file>", "", "Create service from JSON file");
    print_cmd("update <id> <file>", "", "Update service config");
    print_cmd("delete <id>", "rm", "Delete a service");
    println!();

    println!("  {}", "LIFECYCLE CONTROL".white().bold());
    println!("  {}", "─".repeat(50).dark_grey());
    print_cmd("start <id>", "", "Start a service");
    print_cmd("stop <id>", "", "Stop a service");
    print_cmd("restart <id>", "", "Restart a service");
    print_cmd("status <id>", "", "Show service status");
    println!();

    println!("  {}", "MONITORING".white().bold());
    println!("  {}", "─".repeat(50).dark_grey());
    print_cmd("logs <id> [n] [-f]", "", "View logs (n=lines, -f=follow)");
    print_cmd("attach <id>", "", "Attach to service console");
    println!();

    println!("  {}", "AUTHENTICATION".white().bold());
    println!("  {}", "─".repeat(50).dark_grey());
    print_cmd("login <user> <pass>", "", "Login and get access token");
    println!();

    println!("  {}", "USER MANAGEMENT (Admin)".white().bold());
    println!("  {}", "─".repeat(50).dark_grey());
    print_cmd("user list", "ls", "List all users");
    print_cmd("user get <id>", "info", "Show user details");
    print_cmd("user create <u> <p>", "new", "Create user");
    print_cmd("user delete <id>", "rm", "Delete user");
    print_cmd("user password <id> <p> [old]", "", "Update password");
    print_cmd("user grant <uid> <sid>", "", "Grant service access");
    print_cmd("user revoke <uid> <sid>", "", "Revoke service access");
    println!();

    println!("  {}", "SHELL".white().bold());
    println!("  {}", "─".repeat(50).dark_grey());
    print_cmd("help", "", "Show this help");
    print_cmd("exit", "quit", "Exit shell");
    println!();
}

fn print_cmd(cmd: &str, alias: &str, desc: &str) {
    if alias.is_empty() {
        println!("    {:<24} {}", cmd.cyan(), desc.dark_grey());
    } else {
        println!(
            "    {:<24} {} {}",
            cmd.cyan(),
            desc.dark_grey(),
            format!("(alias: {})", alias).dark_grey().italic()
        );
    }
}
