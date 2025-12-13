//! UI utilities for beautiful command output.

use crossterm::style::Stylize;

/// Calculate display width of a string (accounting for wide chars like emoji).
fn display_width(s: &str) -> usize {
    s.chars()
        .map(|c| {
            if c.is_ascii() {
                1
            } else {
                // Most CJK and emoji are 2 cells wide
                2
            }
        })
        .sum()
}

/// Print a section header with box drawing characters.
pub fn print_header(title: &str) {
    let inner_width: usize = 58; // Fixed inner width
    let title_width = display_width(title);
    let total_padding = inner_width.saturating_sub(title_width);
    let left_pad = total_padding / 2;
    let right_pad = total_padding - left_pad;

    println!();
    println!("{}", format!("╔{}╗", "═".repeat(inner_width)).dark_cyan());
    println!(
        "{}",
        format!(
            "║{}{}{}║",
            " ".repeat(left_pad),
            title,
            " ".repeat(right_pad)
        )
        .dark_cyan()
    );
    println!("{}", format!("╚{}╝", "═".repeat(inner_width)).dark_cyan());
    println!();
}

/// Print a small section title.
pub fn print_section(title: &str) {
    println!();
    println!("  {} {}", "▸".dark_cyan(), title.white().bold());
    println!("  {}", "─".repeat(50).dark_grey());
}

/// Print a success message.
pub fn print_success(msg: &str) {
    println!("  {} {}", "✓".green(), msg);
}

/// Print an error message.
pub fn print_error(msg: &str) {
    println!("  {} {}", "✗".red(), msg);
}

/// Print a warning message.
pub fn print_warning(msg: &str) {
    println!("  {} {}", "⚠".yellow(), msg);
}

/// Print an info message.
pub fn print_info(msg: &str) {
    println!("  {} {}", "ℹ".blue(), msg);
}

/// Print a key-value pair.
pub fn print_kv(key: &str, value: &str) {
    println!("  {:<14} {}", format!("{}:", key).dark_grey(), value);
}

/// Print a key-value pair with colored value.
pub fn print_kv_colored(key: &str, value: &str, color: KvColor) {
    let styled_value = match color {
        KvColor::Green => value.green().to_string(),
        KvColor::Red => value.red().to_string(),
        KvColor::Yellow => value.yellow().to_string(),
        KvColor::Cyan => value.cyan().to_string(),
        KvColor::White => value.white().bold().to_string(),
        KvColor::Grey => value.dark_grey().to_string(),
    };
    println!("  {:<14} {}", format!("{}:", key).dark_grey(), styled_value);
}

#[derive(Clone, Copy)]
#[allow(dead_code)]
pub enum KvColor {
    Green,
    Red,
    Yellow,
    Cyan,
    White,
    Grey,
}

/// Print a spinner-style progress message (use \r to update).
pub fn print_progress(msg: &str) {
    print!("  {} {}...", "⏳".yellow(), msg);
    use std::io::Write;
    let _ = std::io::stdout().flush();
}

/// Clear the progress line and print success.
pub fn finish_progress_success(msg: &str) {
    println!("\r  {} {}                    ", "✓".green(), msg);
}

/// Clear the progress line and print error.
pub fn finish_progress_error(msg: &str) {
    println!("\r  {} {}                    ", "✗".red(), msg);
}

/// Format uptime from milliseconds to human readable string.
pub fn format_uptime(ms: u64) -> String {
    let seconds = ms / 1000;
    let minutes = seconds / 60;
    let hours = minutes / 60;
    let days = hours / 24;

    if days > 0 {
        format!("{}d {}h {}m", days, hours % 24, minutes % 60)
    } else if hours > 0 {
        format!("{}h {}m {}s", hours, minutes % 60, seconds % 60)
    } else if minutes > 0 {
        format!("{}m {}s", minutes, seconds % 60)
    } else {
        format!("{}s", seconds)
    }
}

/// Format state with color.
pub fn format_state(state: &str) -> String {
    match state.to_lowercase().as_str() {
        "running" => "● Running".green().to_string(),
        "stopped" => "○ Stopped".dark_grey().to_string(),
        _ => format!("? {}", state).yellow().to_string(),
    }
}

/// Print a table header.
pub fn print_table_header(columns: &[(&str, usize)]) {
    let header: String = columns
        .iter()
        .map(|(name, width)| format!("{:<width$}", name, width = width))
        .collect::<Vec<_>>()
        .join(" ");
    println!("  {}", header.white().bold());
    let separator: String = columns
        .iter()
        .map(|(_, width)| "─".repeat(*width))
        .collect::<Vec<_>>()
        .join(" ");
    println!("  {}", separator.dark_grey());
}

/// Print a table row.
#[allow(dead_code)]
pub fn print_table_row(columns: &[(&str, usize)]) {
    let row: String = columns
        .iter()
        .map(|(val, width)| format!("{:<width$}", val, width = width))
        .collect::<Vec<_>>()
        .join(" ");
    println!("  {}", row);
}

/// Print an empty state message.
pub fn print_empty(msg: &str) {
    println!();
    println!("  {}", msg.dark_grey().italic());
    println!();
}

/// Print a hint/tip message.
pub fn print_hint(msg: &str) {
    println!("  {} {}", "💡".yellow(), msg.dark_grey());
}
