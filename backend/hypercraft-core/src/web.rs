use crate::{Result, ServiceError};

/// 解析并校验内嵌 Web 的本机上游地址。
pub fn validate_web_upstream_url(upstream: &str) -> Result<url::Url> {
    let upstream = upstream.trim();
    let url = url::Url::parse(upstream)
        .map_err(|_| ServiceError::PolicyViolation("web upstream is not a valid URL".into()))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(ServiceError::PolicyViolation(
            "web upstream only supports http/https".into(),
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ServiceError::PolicyViolation(
            "web upstream must not include credentials".into(),
        ));
    }
    if url.fragment().is_some() {
        return Err(ServiceError::PolicyViolation(
            "web upstream must not include fragment".into(),
        ));
    }

    let host = url
        .host_str()
        .ok_or_else(|| ServiceError::PolicyViolation("web upstream must include host".into()))?;
    if !is_local_web_upstream_host(host) {
        return Err(ServiceError::PolicyViolation(format!(
            "web upstream host not allowed: {}",
            host
        )));
    }

    Ok(url)
}

fn is_local_web_upstream_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || matches!(host, "127.0.0.1" | "::1")
}
