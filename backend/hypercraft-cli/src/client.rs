use reqwest::header::{HeaderMap, AUTHORIZATION};
use serde_json::{json, Value};

/// Build an HTTP client with optional Bearer token default header.
pub fn build_client(token: &Option<String>) -> anyhow::Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder();
    if let Some(tok) = token {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, format!("Bearer {}", tok).parse()?);
        builder = builder.default_headers(headers);
    }
    Ok(builder.build()?)
}

/// Normalize non-2xx responses into errors while returning the response on success.
pub async fn handle_error(resp: reqwest::Response) -> anyhow::Result<reqwest::Response> {
    if resp.status().is_success() {
        return Ok(resp);
    }
    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .unwrap_or_else(|_| json!({"message": "unknown error"}));
    Err(anyhow::anyhow!("request failed {}: {}", status, body))
}
