use axum::body::{to_bytes, Body};
use axum::http::header::{self, HeaderMap, HeaderValue};
use axum::http::{Request, Response, StatusCode, Uri};
use hypercraft_core::{ServiceManifest, TokenClaims, TokenType, WebConfig};

use super::state::AppState;

pub const WEB_SESSION_COOKIE: &str = "hc_web_session";
pub const WEB_SESSION_QUERY: &str = "hc_web_token";

const MAX_PROXY_REQUEST_BODY_BYTES: usize = 64 * 1024 * 1024;
const HOP_BY_HOP_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

pub fn detect_request_scheme(headers: &HeaderMap) -> String {
    if let Some(value) = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return value.to_string();
    }

    if let Some(origin) = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split("://").next())
    {
        return origin.to_string();
    }

    "http".to_string()
}

pub fn request_host(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub fn build_gateway_url(
    service_id: &str,
    scheme: &str,
    base_domain: &str,
    session_token: &str,
) -> String {
    let (base_host, port) = split_host_port(base_domain.trim().trim_matches('.'));
    let host = build_gateway_host(service_id, &base_host);
    let authority = match port {
        Some(port) => format!("{}:{}", host, port),
        None => host,
    };
    format!(
        "{}://{}/?{}={}",
        scheme,
        authority,
        WEB_SESSION_QUERY,
        session_token
    )
}

pub fn extract_gateway_service_id(host: &str, base_domain: &str) -> Option<String> {
    let (host_only, _) = split_host_port(host);
    let host_only = host_only.to_ascii_lowercase();
    let (base_domain, _) = split_host_port(base_domain.trim().trim_matches('.'));
    let base_domain = base_domain.to_ascii_lowercase();
    let suffix = format!(".{}", base_domain);
    if !host_only.ends_with(&suffix) {
        return None;
    }

    let label = host_only.strip_suffix(&suffix)?;
    if label.contains('.') {
        return None;
    }

    decode_service_host_label(label)
}

pub async fn handle_web_gateway_request(
    state: &AppState,
    request: Request<Body>,
    service_id: String,
) -> Response<Body> {
    let manifest = match state.manager.load_manifest(&service_id).await {
        Ok(manifest) => manifest,
        Err(_) => return plain_response(StatusCode::NOT_FOUND, "service not found"),
    };
    let web = match manifest.web.as_ref().filter(|web| web.enabled) {
        Some(web) => web,
        None => return plain_response(StatusCode::NOT_FOUND, "web service not enabled"),
    };

    if let Some(session_token) = extract_query_param(request.uri(), WEB_SESSION_QUERY) {
        if !authorize_web_session(state, &session_token, &service_id).await {
            return plain_response(StatusCode::UNAUTHORIZED, "web session is invalid");
        }

        let secure = should_mark_session_cookie_secure(request.headers());
        let mut response = Response::builder()
            .status(StatusCode::FOUND)
            .header(header::LOCATION, clean_redirect_target(request.uri()))
            .header(
                header::SET_COOKIE,
                build_session_cookie(&session_token, state.web_proxy_session_ttl, secure),
            )
            .body(Body::empty())
            .unwrap_or_else(|_| plain_response(StatusCode::INTERNAL_SERVER_ERROR, "redirect failed"));
        response.headers_mut().append(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store, no-cache, must-revalidate"),
        );
        return response;
    }

    let session_token = match extract_cookie(request.headers(), WEB_SESSION_COOKIE) {
        Some(token) => token,
        None => return plain_response(StatusCode::UNAUTHORIZED, "missing web session"),
    };
    if !authorize_web_session(state, &session_token, &service_id).await {
        return plain_response(StatusCode::UNAUTHORIZED, "web session is invalid");
    }

    proxy_request(state, request, &manifest, web).await
}

async fn authorize_web_session(state: &AppState, token: &str, service_id: &str) -> bool {
    let claims = match state.user_manager.verify_token(token).await {
        Ok(claims) => claims,
        Err(_) => return false,
    };

    matches!(
        claims,
        TokenClaims {
            token_type: TokenType::Web,
            service_id: Some(ref bound_service_id),
            ..
        } if bound_service_id == service_id
    )
}

async fn proxy_request(
    state: &AppState,
    request: Request<Body>,
    manifest: &ServiceManifest,
    web: &WebConfig,
) -> Response<Body> {
    let request_headers = request.headers().clone();
    let upstream_url = match build_upstream_url(&web.upstream, request.uri()) {
        Ok(url) => url,
        Err(message) => return plain_response(StatusCode::BAD_GATEWAY, message),
    };

    let gateway_host = request_host(&request_headers).unwrap_or_default();
    let gateway_scheme = detect_request_scheme(&request_headers);
    let upstream_host = upstream_host_header(&upstream_url);
    let forwarded_for = request_headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("{}, hypercraft-web-gateway", value))
        .unwrap_or_else(|| "hypercraft-web-gateway".to_string());
    let method = match reqwest::Method::from_bytes(request.method().as_str().as_bytes()) {
        Ok(method) => method,
        Err(_) => return plain_response(StatusCode::BAD_REQUEST, "invalid request method"),
    };

    let body_bytes = match to_bytes(request.into_body(), MAX_PROXY_REQUEST_BODY_BYTES).await {
        Ok(body) => body,
        Err(_) => {
            return plain_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "request body is too large for web proxy",
            );
        }
    };

    let mut upstream_request = state.http_client.request(method, upstream_url.clone());
    for (name, value) in &request_headers {
        if is_hop_by_hop_header(name.as_str()) || name == header::HOST {
            continue;
        }

        if name == header::COOKIE {
            if let Some(filtered_cookie) = filter_proxy_cookie_header(value) {
                upstream_request = upstream_request.header(name, filtered_cookie);
            }
            continue;
        }

        upstream_request = upstream_request.header(name, value);
    }

    if let Some(upstream_host) = upstream_host {
        // 上游应看到自己的 Host，外部网关 Host 通过 X-Forwarded-Host 传递。
        upstream_request = upstream_request.header(header::HOST, upstream_host);
    }

    upstream_request = upstream_request
        .header("x-forwarded-host", gateway_host.clone())
        .header("x-forwarded-proto", gateway_scheme.clone())
        .header("x-forwarded-for", forwarded_for);

    if !body_bytes.is_empty() {
        upstream_request = upstream_request.body(body_bytes);
    }

    let upstream_response = match upstream_request.send().await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(
                service_id = %manifest.id,
                upstream = %web.upstream,
                error = %error,
                "web upstream request failed"
            );
            return plain_response(StatusCode::BAD_GATEWAY, "web upstream is unavailable");
        }
    };

    let status = upstream_response.status();
    let upstream_headers = upstream_response.headers().clone();
    let mut response = Response::builder().status(status);
    if let Some(headers) = response.headers_mut() {
        for (name, value) in &upstream_headers {
            if is_hop_by_hop_header(name.as_str()) || name == header::CONTENT_LENGTH {
                continue;
            }
            if name == header::X_FRAME_OPTIONS {
                continue;
            }
            if name == header::CONTENT_SECURITY_POLICY {
                if let Some(rewritten) = rewrite_content_security_policy(value) {
                    headers.append(name, rewritten);
                }
                continue;
            }
            if name == header::LOCATION {
                if let Some(rewritten) = rewrite_location(value, &upstream_url, &gateway_scheme, &gateway_host) {
                    headers.append(name, rewritten);
                }
                continue;
            }
            headers.append(name, value.clone());
        }
    }

    response
        .body(Body::from_stream(upstream_response.bytes_stream()))
        .unwrap_or_else(|_| plain_response(StatusCode::INTERNAL_SERVER_ERROR, "proxy response failed"))
}

fn build_upstream_url(upstream: &str, uri: &Uri) -> Result<reqwest::Url, String> {
    let mut target = reqwest::Url::parse(upstream)
        .map_err(|_| "web upstream is not a valid URL".to_string())?;
    let base_path = target.path().trim_end_matches('/').to_string();
    let request_path = uri.path();
    let joined_path = if base_path.is_empty() || base_path == "/" {
        request_path.to_string()
    } else if request_path == "/" {
        base_path
    } else {
        format!("{}/{}", base_path.trim_end_matches('/'), request_path.trim_start_matches('/'))
    };
    target.set_path(if joined_path.is_empty() { "/" } else { &joined_path });
    target.set_query(uri.query());
    target.set_fragment(None);
    Ok(target)
}

fn rewrite_location(
    value: &HeaderValue,
    upstream_url: &reqwest::Url,
    gateway_scheme: &str,
    gateway_host: &str,
) -> Option<HeaderValue> {
    let raw = value.to_str().ok()?;
    let mut location = match reqwest::Url::parse(raw) {
        Ok(url) => url,
        Err(_) => return Some(value.clone()),
    };
    if !same_origin(&location, upstream_url) {
        return Some(value.clone());
    }

    let (host, port) = split_host_port(gateway_host);
    location.set_scheme(gateway_scheme).ok()?;
    location.set_host(Some(&host)).ok()?;
    location.set_port(port).ok()?;
    HeaderValue::from_str(location.as_str()).ok()
}

fn upstream_host_header(upstream_url: &reqwest::Url) -> Option<String> {
    let host = upstream_url.host_str()?;
    let host = if host.contains(':') {
        format!("[{}]", host)
    } else {
        host.to_string()
    };
    let port = upstream_url.port()?;
    Some(format!("{}:{}", host, port))
}

fn same_origin(left: &reqwest::Url, right: &reqwest::Url) -> bool {
    left.scheme() == right.scheme()
        && left.host_str() == right.host_str()
        && left.port_or_known_default() == right.port_or_known_default()
}

fn rewrite_content_security_policy(value: &HeaderValue) -> Option<HeaderValue> {
    let raw = value.to_str().ok()?;
    let directives: Vec<&str> = raw
        .split(';')
        .map(str::trim)
        .filter(|directive| !directive.is_empty() && !directive.starts_with("frame-ancestors"))
        .collect();
    if directives.is_empty() {
        return None;
    }
    HeaderValue::from_str(&directives.join("; ")).ok()
}

fn filter_proxy_cookie_header(value: &HeaderValue) -> Option<HeaderValue> {
    let raw = value.to_str().ok()?;
    let filtered: Vec<&str> = raw
        .split(';')
        .map(str::trim)
        .filter(|pair| !pair.is_empty() && !pair.starts_with(&format!("{}=", WEB_SESSION_COOKIE)))
        .collect();
    if filtered.is_empty() {
        return None;
    }
    HeaderValue::from_str(&filtered.join("; ")).ok()
}

fn build_session_cookie(session_token: &str, ttl_seconds: i64, secure: bool) -> String {
    if secure {
        // 浏览器 tab 通过 iframe 嵌入网关页面时，这个会话 cookie 会被视为第三方 cookie。
        // 这里必须显式放宽 SameSite，并启用 Secure/Partitioned，避免重定向后的第二跳丢失会话。
        return format!(
            "{}={}; Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age={}",
            WEB_SESSION_COOKIE,
            session_token,
            ttl_seconds
        );
    }

    format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
        WEB_SESSION_COOKIE,
        session_token,
        ttl_seconds
    )
}

fn extract_cookie(headers: &HeaderMap, key: &str) -> Option<String> {
    let cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie.split(';').find_map(|part| {
        let (cookie_key, value) = part.trim().split_once('=')?;
        if cookie_key == key {
            Some(value.to_string())
        } else {
            None
        }
    })
}

fn extract_query_param(uri: &Uri, key: &str) -> Option<String> {
    uri.query().and_then(|query| {
        query.split('&').find_map(|pair| {
            let (query_key, value) = pair.split_once('=')?;
            if query_key == key {
                urlencoding::decode(value).ok().map(|value| value.into_owned())
            } else {
                None
            }
        })
    })
}

fn clean_redirect_target(uri: &Uri) -> String {
    let mut target = uri.path().to_string();
    let query = uri.query().unwrap_or_default();
    let filtered: Vec<&str> = query
        .split('&')
        .filter(|pair| !pair.is_empty() && !pair.starts_with(&format!("{}=", WEB_SESSION_QUERY)))
        .collect();
    if !filtered.is_empty() {
        target.push('?');
        target.push_str(&filtered.join("&"));
    }
    if target.is_empty() {
        "/".to_string()
    } else {
        target
    }
}

fn plain_response(status: StatusCode, message: impl Into<String>) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(message.into()))
        .unwrap_or_else(|_| Response::new(Body::from("response build failed")))
}

fn is_hop_by_hop_header(name: &str) -> bool {
    HOP_BY_HOP_HEADERS
        .iter()
        .any(|header_name| header_name.eq_ignore_ascii_case(name))
}

fn build_gateway_host(service_id: &str, base_domain: &str) -> String {
    let (base_host, _) = split_host_port(base_domain.trim().trim_matches('.'));
    format!(
        "{}.{}",
        encode_service_host_label(service_id),
        base_host.to_ascii_lowercase()
    )
}

fn encode_service_host_label(service_id: &str) -> String {
    let mut encoded = String::from("svc-");
    for byte in service_id.as_bytes() {
        encoded.push(char::from(nibble_to_hex(byte >> 4)));
        encoded.push(char::from(nibble_to_hex(byte & 0x0f)));
    }
    encoded
}

fn decode_service_host_label(label: &str) -> Option<String> {
    let payload = label.strip_prefix("svc-")?;
    if payload.len() % 2 != 0 {
        return None;
    }

    let mut bytes = Vec::with_capacity(payload.len() / 2);
    let mut chars = payload.chars();
    while let (Some(high), Some(low)) = (chars.next(), chars.next()) {
        let high = high.to_digit(16)?;
        let low = low.to_digit(16)?;
        bytes.push(((high << 4) | low) as u8);
    }

    String::from_utf8(bytes).ok()
}

fn nibble_to_hex(nibble: u8) -> u8 {
    match nibble {
        0..=9 => b'0' + nibble,
        10..=15 => b'a' + (nibble - 10),
        _ => b'0',
    }
}

fn split_host_port(host: &str) -> (String, Option<u16>) {
    if let Some(rest) = host.strip_prefix('[') {
        if let Some((ipv6_host, remainder)) = rest.split_once(']') {
            let port = remainder.strip_prefix(':').and_then(|value| value.parse().ok());
            return (ipv6_host.to_string(), port);
        }
    }

    if let Some((host_part, port_part)) = host.rsplit_once(':') {
        if !host_part.contains(':') {
            return (host_part.to_string(), port_part.parse().ok());
        }
    }

    (host.to_string(), None)
}

fn should_mark_session_cookie_secure(headers: &HeaderMap) -> bool {
    if detect_request_scheme(headers) == "https" {
        return true;
    }

    request_host(headers)
        .map(|host| split_host_port(&host).0)
        .map(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host.to_ascii_lowercase().ends_with(".localhost")
        })
        .unwrap_or(false)
}
