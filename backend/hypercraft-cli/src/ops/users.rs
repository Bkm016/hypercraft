//! 用户管理 CLI 操作

use super::ui::{print_error, print_header, print_kv, print_section, print_success};
use super::OutputFormat;
use crossterm::style::Stylize;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// 用户摘要（从 API 返回）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSummary {
    pub id: String,
    pub username: String,
    pub service_ids: Vec<String>,
    pub created_at: Option<String>,
}

/// 认证响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthToken {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub token_type: String,
}

/// 用户登录
pub async fn login(
    client: &Client,
    base: &str,
    username: &str,
    password: &str,
    output: OutputFormat,
) -> anyhow::Result<AuthToken> {
    let url = format!("{}/auth/login", base);
    let resp = client
        .post(&url)
        .json(&json!({
            "username": username,
            "password": password
        }))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("login failed ({}): {}", status, body);
    }

    let token: AuthToken = resp.json().await?;

    match output {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(&token)?);
        }
        OutputFormat::Table => {
            print_header("🔐 登录成功");
            println!();
            print_kv("Access Token", &token.access_token);
            print_kv("Expires In", &format!("{} seconds", token.expires_in));
            println!();
            print_section("💡 提示");
            println!(
                "  设置环境变量以使用此 token: {}",
                "HC_DEV_TOKEN=<access_token>".cyan()
            );
        }
    }

    Ok(token)
}

/// 刷新 token
pub async fn refresh_token(
    client: &Client,
    base: &str,
    refresh_token: &str,
    output: OutputFormat,
) -> anyhow::Result<AuthToken> {
    let url = format!("{}/auth/refresh", base);
    let resp = client
        .post(&url)
        .json(&json!({
            "refresh_token": refresh_token
        }))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("refresh failed ({}): {}", status, body);
    }

    let token: AuthToken = resp.json().await?;

    match output {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(&token)?);
        }
        OutputFormat::Table => {
            print_success("Token 刷新成功");
            print_kv("过期时间", &format!("{} 秒", token.expires_in));
        }
    }

    Ok(token)
}

/// 列出所有用户
pub async fn list_users(client: &Client, base: &str, output: OutputFormat) -> anyhow::Result<()> {
    let url = format!("{}/users", base);
    let resp = client.get(&url).send().await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        print_error(&format!("获取用户列表失败 ({}): {}", status, body));
        return Ok(());
    }

    let users: Vec<UserSummary> = resp.json().await?;

    match output {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(&users)?);
        }
        OutputFormat::Table => {
            print_header("👥 用户列表");
            println!();

            if users.is_empty() {
                println!("  {}", "暂无用户".dark_grey());
            } else {
                // 表头
                println!(
                    "  {:<36}  {:<20}  {}",
                    "ID".bold(),
                    "用户名".bold(),
                    "可访问服务".bold()
                );
                println!("  {}", "─".repeat(80).dark_grey());

                for user in users {
                    let services = if user.service_ids.is_empty() {
                        "无".dark_grey().to_string()
                    } else if user.service_ids.len() <= 3 {
                        user.service_ids.join(", ")
                    } else {
                        format!(
                            "{}, ... (+{})",
                            user.service_ids[..3].join(", "),
                            user.service_ids.len() - 3
                        )
                    };
                    println!(
                        "  {:<36}  {:<20}  {}",
                        user.id.dark_grey(),
                        user.username.cyan(),
                        services
                    );
                }
            }
            println!();
        }
    }

    Ok(())
}

/// 获取用户详情
pub async fn get_user(
    client: &Client,
    base: &str,
    id: &str,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let url = format!("{}/users/{}", base, id);
    let resp = client.get(&url).send().await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        print_error(&format!("获取用户失败 ({}): {}", status, body));
        return Ok(());
    }

    let user: UserSummary = resp.json().await?;

    match output {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(&user)?);
        }
        OutputFormat::Table => {
            print_header(&format!("👤 用户: {}", user.username));
            println!();
            print_kv("ID", &user.id);
            print_kv("用户名", &user.username);
            print_kv("创建时间", user.created_at.as_deref().unwrap_or("未知"));
            println!();
            print_section("🔑 可访问的服务");
            if user.service_ids.is_empty() {
                println!("  {}", "无".dark_grey());
            } else {
                for sid in &user.service_ids {
                    println!("  • {}", sid.as_str().cyan());
                }
            }
            println!();
        }
    }

    Ok(())
}

/// 创建用户
pub async fn create_user(
    client: &Client,
    base: &str,
    username: &str,
    password: &str,
    service_ids: Vec<String>,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let url = format!("{}/users", base);
    let resp = client
        .post(&url)
        .json(&json!({
            "username": username,
            "password": password,
            "service_ids": service_ids
        }))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        print_error(&format!("创建用户失败 ({}): {}", status, body));
        return Ok(());
    }

    let user: UserSummary = resp.json().await?;

    match output {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(&user)?);
        }
        OutputFormat::Table => {
            print_success(&format!("用户 {} 创建成功", user.username));
            print_kv("ID", &user.id);
        }
    }

    Ok(())
}

/// 删除用户
pub async fn delete_user(client: &Client, base: &str, id: &str) -> anyhow::Result<()> {
    let url = format!("{}/users/{}", base, id);
    let resp = client.delete(&url).send().await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        print_error(&format!("删除用户失败 ({}): {}", status, body));
        return Ok(());
    }

    print_success(&format!("用户 {} 已删除", id));
    Ok(())
}

/// 更新用户密码
pub async fn update_user_password(
    client: &Client,
    base: &str,
    id: &str,
    new_password: &str,
    current_password: Option<&str>,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let url = format!("{}/users/{}/password", base, id);
    let mut body = json!({ "new_password": new_password });
    if let Some(curr) = current_password {
        body["current_password"] = curr.into();
    }

    let resp = client.post(&url).json(&body).send().await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        print_error(&format!("更新密码失败 ({}): {}", status, body));
        return Ok(());
    }

    let user: UserSummary = resp.json().await?;

    match output {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(&user)?);
        }
        OutputFormat::Table => {
            print_success(&format!("用户 {} 密码已更新", user.username));
        }
    }

    Ok(())
}

/// 设置用户的服务权限
pub async fn set_user_services(
    client: &Client,
    base: &str,
    user_id: &str,
    service_ids: Vec<String>,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let url = format!("{}/users/{}/services", base, user_id);
    let resp = client
        .put(&url)
        .json(&json!({
            "service_ids": service_ids
        }))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        print_error(&format!("设置服务权限失败 ({}): {}", status, body));
        return Ok(());
    }

    let user: UserSummary = resp.json().await?;

    match output {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(&user)?);
        }
        OutputFormat::Table => {
            print_success(&format!("用户 {} 的服务权限已更新", user.username));
            print_section("🔑 当前可访问的服务");
            if user.service_ids.is_empty() {
                println!("  {}", "无".dark_grey());
            } else {
                for sid in &user.service_ids {
                    println!("  • {}", sid.as_str().cyan());
                }
            }
        }
    }

    Ok(())
}

/// 添加用户服务权限
pub async fn add_user_service(
    client: &Client,
    base: &str,
    user_id: &str,
    service_id: &str,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let url = format!("{}/users/{}/services/{}", base, user_id, service_id);
    let resp = client.post(&url).send().await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        print_error(&format!("添加服务权限失败 ({}): {}", status, body));
        return Ok(());
    }

    let user: UserSummary = resp.json().await?;

    match output {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(&user)?);
        }
        OutputFormat::Table => {
            print_success(&format!(
                "已为用户 {} 添加服务 {} 的访问权限",
                user.username, service_id
            ));
        }
    }

    Ok(())
}

/// 移除用户服务权限
pub async fn remove_user_service(
    client: &Client,
    base: &str,
    user_id: &str,
    service_id: &str,
    output: OutputFormat,
) -> anyhow::Result<()> {
    let url = format!("{}/users/{}/services/{}", base, user_id, service_id);
    let resp = client.delete(&url).send().await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        print_error(&format!("移除服务权限失败 ({}): {}", status, body));
        return Ok(());
    }

    let user: UserSummary = resp.json().await?;

    match output {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(&user)?);
        }
        OutputFormat::Table => {
            print_success(&format!(
                "已移除用户 {} 对服务 {} 的访问权限",
                user.username, service_id
            ));
        }
    }

    Ok(())
}
