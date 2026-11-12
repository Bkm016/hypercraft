//! 服务工作目录内的文件浏览与配置编辑。
//!
//! 安全模型：
//! - 以服务 manifest 的 `cwd` 为根，通过 `cap-std` 打开为能力目录（capability），
//!   之后所有操作只能在该目录内进行，`..`、绝对路径、指向目录外的软链接均会被拒绝；
//! - 请求路径额外做词法校验（只允许普通路径段），双重防护；
//! - 独立的文件管理权限：用户 `file_access`（none / read / write），API Key scope
//!   `files:read` / `files:write`；系统管理员恒有读写；同时仍需该服务的访问权；
//! - 在线查看与编辑仅限 YAML / JSON / TOML，保存前做语法校验，失败返回 422 与行列号；
//! - 上传与下载支持任意类型，单文件上限 512 MiB（在线编辑仍为 25 MiB）；
//!   上传流式落盘、下载流式输出，超限立即中止并清理；
//! - 用内容 SHA-256 作为 etag，保存时比对，防止覆盖服务进程在此期间写入的修改；
//! - 写入先落同目录临时文件再原子 rename，写到一半崩溃也不会损坏原文件。

use std::io::{self, Write};
use std::path::{Component, Path as StdPath, PathBuf};
use std::time::UNIX_EPOCH;

use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use cap_std::ambient_authority;
use cap_std::fs::{Dir, Metadata, OpenOptions};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::app::middleware::AuthInfo;
use crate::app::{ApiError, AppState};
use futures::StreamExt;

/// 上传 / 下载的单文件上限：512 MiB（全程流式，不占用整块内存）
pub const MAX_TRANSFER_BYTES: u64 = 512 * 1024 * 1024;
/// 在线查看 / 编辑的大小上限：25 MiB（整文件载入浏览器编辑器）
pub const MAX_EDIT_BYTES: u64 = 25 * 1024 * 1024;
/// 写入接口的 JSON 请求体上限（内容 25 MiB + JSON 转义余量）
pub const MAX_WRITE_BODY_BYTES: usize = (MAX_EDIT_BYTES as usize) * 2 + 64 * 1024;
/// 二进制文件十六进制只读视图最多展示的字节数
const HEX_VIEW_BYTES: usize = 64 * 1024;
/// 单个目录最多返回的条目数
const MAX_LIST_ENTRIES: usize = 10_000;
/// 已知的二进制扩展名：列表中标记为不可编辑（仅作提示，实际是否能打开以内容检测为准）
const BINARY_EXTS: &[&str] = &[
    "jar", "war", "ear", "class", "zip", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "tar", "mca", "mcr", "dat",
    "dat_old", "nbt", "schem", "schematic", "litematic", "db", "sqlite", "sqlite3", "mv.db", "png", "jpg", "jpeg",
    "gif", "webp", "bmp", "ico", "icns", "tif", "tiff", "psd", "mp3", "ogg", "wav", "flac", "mp4", "mkv", "webm",
    "avi", "mov", "ttf", "otf", "woff", "woff2", "eot", "exe", "dll", "so", "dylib", "bin", "o", "a", "lib", "pdf",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "iso", "img", "pyc", "wasm",
];

// ==================== 请求 / 响应 ====================

#[derive(Debug, Deserialize)]
pub struct PathQuery {
    #[serde(default)]
    pub path: String,
    /// 读取内容时：`hex` 表示二进制文件以十六进制只读视图打开
    #[serde(default)]
    pub view: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    /// 修改时间（unix 毫秒）
    pub modified: Option<u64>,
    /// 是否可在 Web 中查看/编辑
    pub editable: bool,
}

#[derive(Debug, Serialize)]
pub struct DirListing {
    pub path: String,
    pub entries: Vec<FileEntry>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub etag: String,
    pub size: u64,
    pub modified: Option<u64>,
    /// 检测到的编码；保存时按原编码写回
    pub encoding: TextEncoding,
    /// 为 true 时 content 是十六进制只读视图（二进制文件），不可保存
    #[serde(default)]
    pub binary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TextEncoding {
    #[default]
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-8-bom")]
    Utf8Bom,
    #[serde(rename = "utf-16le")]
    Utf16Le,
    #[serde(rename = "utf-16be")]
    Utf16Be,
    Gb18030,
    #[serde(rename = "big5")]
    Big5,
    #[serde(rename = "shift_jis")]
    ShiftJis,
    #[serde(rename = "euc-kr")]
    EucKr,
    /// 兜底：单字节编码，任意字节都能无损往返
    #[serde(rename = "windows-1252")]
    Windows1252,
}

impl TextEncoding {
    fn from_codec(c: &'static encoding_rs::Encoding) -> Option<Self> {
        Some(if c == encoding_rs::GB18030 || c == encoding_rs::GBK {
            TextEncoding::Gb18030
        } else if c == encoding_rs::BIG5 {
            TextEncoding::Big5
        } else if c == encoding_rs::SHIFT_JIS {
            TextEncoding::ShiftJis
        } else if c == encoding_rs::EUC_KR {
            TextEncoding::EucKr
        } else if c == encoding_rs::WINDOWS_1252 {
            TextEncoding::Windows1252
        } else {
            return None;
        })
    }

    fn legacy(self) -> Option<&'static encoding_rs::Encoding> {
        match self {
            TextEncoding::Gb18030 => Some(encoding_rs::GB18030),
            TextEncoding::Big5 => Some(encoding_rs::BIG5),
            TextEncoding::ShiftJis => Some(encoding_rs::SHIFT_JIS),
            TextEncoding::EucKr => Some(encoding_rs::EUC_KR),
            TextEncoding::Windows1252 => Some(encoding_rs::WINDOWS_1252),
            _ => None,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
    /// 读取时拿到的 etag；为空表示强制覆盖
    #[serde(default)]
    pub etag: Option<String>,
    /// 写回使用的编码，缺省 UTF-8
    #[serde(default)]
    pub encoding: TextEncoding,
}

#[derive(Debug, Serialize)]
pub struct WriteFileResponse {
    pub path: String,
    pub etag: String,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CreateKind {
    File,
    Dir,
}

#[derive(Debug, Deserialize)]
pub struct CreateRequest {
    pub path: String,
    pub kind: CreateKind,
}

#[derive(Debug, Deserialize)]
pub struct RenameRequest {
    pub from: String,
    pub to: String,
}

// ==================== 错误 ====================

/// 文件接口错误：大多数映射为通用 ApiError；语法错误额外带行列号
#[derive(Debug)]
pub enum FileError {
    Api(ApiError),
    Syntax(SyntaxError),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SyntaxError {
    pub line: usize,
    pub column: usize,
    pub message: String,
}

impl From<ApiError> for FileError {
    fn from(e: ApiError) -> Self {
        FileError::Api(e)
    }
}

impl IntoResponse for FileError {
    fn into_response(self) -> Response {
        match self {
            FileError::Api(e) => e.into_response(),
            FileError::Syntax(e) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({
                    "code": "InvalidSyntax",
                    "message": format!("第 {} 行第 {} 列：{}", e.line, e.column, e.message),
                    "line": e.line,
                    "column": e.column,
                })),
            )
                .into_response(),
        }
    }
}

pub(super) fn not_found(msg: impl Into<String>) -> ApiError {
    ApiError::new("NotFound", StatusCode::NOT_FOUND, msg)
}

pub(super) fn conflict(code: &'static str, msg: impl Into<String>) -> ApiError {
    ApiError::new(code, StatusCode::CONFLICT, msg)
}

pub(super) fn io_error(err: io::Error, path: &str) -> ApiError {
    match err.kind() {
        io::ErrorKind::NotFound => not_found(format!("文件不存在: {path}")),
        io::ErrorKind::AlreadyExists => conflict("AlreadyExists", format!("已存在: {path}")),
        io::ErrorKind::PermissionDenied => {
            // cap-std 对越界访问（含软链接逃逸）返回 PermissionDenied
            ApiError::forbidden(format!("无权访问: {path}"))
        }
        _ => {
            tracing::warn!(path = %path, error = %err, "file operation failed");
            ApiError::new(
                "IoError",
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("文件操作失败: {err}"),
            )
        }
    }
}

// ==================== 路径与类型 ====================

/// 校验并规范化相对路径。空串表示根目录。
/// 只允许普通路径段；拒绝绝对路径、`..`、盘符、NUL 等。
pub(super) fn normalize_rel(raw: &str) -> Result<PathBuf, ApiError> {
    let trimmed = raw.trim().trim_start_matches(['/', '\\']);
    if trimmed.contains('\0') {
        return Err(ApiError::bad_request("非法路径"));
    }
    let mut out = PathBuf::new();
    for comp in StdPath::new(trimmed).components() {
        match comp {
            Component::Normal(seg) => out.push(seg),
            Component::CurDir => {}
            _ => return Err(ApiError::bad_request(format!("非法路径: {raw}"))),
        }
    }
    Ok(out)
}

/// 统一用 `/` 分隔返回给前端
pub(super) fn display_path(p: &StdPath) -> String {
    p.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// 列表提示：已知二进制扩展名之外的文件都尝试作为文本打开
/// 面板自身产生的临时文件（保存 / 上传中的 .tmp、分片上传的 .part），列表中隐藏
pub(super) fn is_internal_temp(name: &str) -> bool {
    name.starts_with('.') && name.contains(".hc-") && (name.ends_with(".tmp") || name.ends_with(".part"))
}

pub(super) fn is_editable_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !BINARY_EXTS.iter().any(|ext| lower.ends_with(&format!(".{ext}")))
}

// ==================== 文本检测 / 编码 ====================

/// 按内容判断是否为文本并解码；确认为二进制才返回 None。
/// 顺序：BOM（UTF-8 / UTF-16）→ 无 BOM 的 UTF-16 → 含 NUL 视为二进制 → UTF-8
/// → GB18030 / Big5 / Shift_JIS / EUC-KR → Windows-1252 兜底（任意字节可解码）。
/// 每一步都要求控制字符占比足够低，避免把二进制误当文本。
fn decode_text(bytes: &[u8]) -> Option<(String, TextEncoding)> {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        // 带 BOM 但中间有非法字节：按有损 UTF-8 打开（保存时会规范化）
        let text = String::from_utf8_lossy(rest).into_owned();
        return looks_textual(&text).then_some((text, TextEncoding::Utf8Bom));
    }
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        let le = bytes[0] == 0xFF;
        if let Some(text) = decode_utf16(&bytes[2..], le) {
            return Some((text, if le { TextEncoding::Utf16Le } else { TextEncoding::Utf16Be }));
        }
    }
    // 无 BOM 的 UTF-16（Windows 工具常见）：大量 0 字节集中在奇数或偶数位
    if let Some(le) = guess_bomless_utf16(bytes) {
        if let Some(text) = decode_utf16(bytes, le) {
            return Some((text, if le { TextEncoding::Utf16Le } else { TextEncoding::Utf16Be }));
        }
    }
    if bytes.contains(&0) {
        return None;
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return looks_textual(s).then(|| (s.to_string(), TextEncoding::Utf8));
    }
    // 非 UTF-8：用 chardetng（Firefox 的编码探测）按统计特征猜测
    let mut det = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
    det.feed(bytes, true);
    let guessed = det.guess(None, chardetng::Utf8Detection::Deny);
    let mut candidates = vec![guessed];
    for e in [encoding_rs::GB18030, encoding_rs::BIG5, encoding_rs::SHIFT_JIS, encoding_rs::EUC_KR] {
        if !candidates.contains(&e) {
            candidates.push(e);
        }
    }
    for codec in candidates {
        let Some(enc) = TextEncoding::from_codec(codec) else { continue };
        let (text, had_errors) = codec.decode_without_bom_handling(bytes);
        if !had_errors && looks_textual(&text) {
            return Some((text.into_owned(), enc));
        }
    }
    // 兜底：单字节编码，任意字节都能无损往返
    let (text, _) = encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes);
    looks_textual(&text).then(|| (text.into_owned(), TextEncoding::Windows1252))
}

fn decode_utf16(body: &[u8], le: bool) -> Option<String> {
    if body.len() % 2 != 0 {
        return None;
    }
    let units: Vec<u16> = body
        .chunks_exact(2)
        .map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) })
        .collect();
    let text = String::from_utf16(&units).ok()?;
    looks_textual(&text).then_some(text)
}

/// 粗略判断无 BOM 的 UTF-16：返回 Some(true)=LE，Some(false)=BE
fn guess_bomless_utf16(bytes: &[u8]) -> Option<bool> {
    let sample = &bytes[..bytes.len().min(4096) & !1];
    if sample.len() < 8 {
        return None;
    }
    let pairs = sample.len() / 2;
    let even_zero = sample.iter().step_by(2).filter(|&&b| b == 0).count();
    let odd_zero = sample.iter().skip(1).step_by(2).filter(|&&b| b == 0).count();
    // ASCII 为主的 UTF-16 文本：一侧几乎全 0，另一侧几乎没有 0
    if odd_zero * 10 >= pairs * 7 && even_zero * 20 <= pairs {
        Some(true)
    } else if even_zero * 10 >= pairs * 7 && odd_zero * 20 <= pairs {
        Some(false)
    } else {
        None
    }
}

/// 十六进制视图（二进制文件只读查看），最多前 64 KiB
fn hex_dump(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len().min(HEX_VIEW_BYTES) * 4);
    for (row, chunk) in bytes.chunks(16).take(HEX_VIEW_BYTES / 16).enumerate() {
        let _ = write!(out, "{:08x}  ", row * 16);
        for i in 0..16 {
            match chunk.get(i) {
                Some(b) => {
                    let _ = write!(out, "{b:02x} ");
                }
                None => out.push_str("   "),
            }
            if i == 7 {
                out.push(' ');
            }
        }
        out.push_str(" |");
        out.extend(chunk.iter().map(|&b| if (0x20..0x7f).contains(&b) { b as char } else { '.' }));
        out.push_str("|\n");
    }
    if bytes.len() > HEX_VIEW_BYTES {
        let _ = write!(out, "\n… 仅显示前 {} KiB，共 {} 字节；完整内容请下载\n", HEX_VIEW_BYTES / 1024, bytes.len());
    }
    out
}

/// 控制字符（除常见空白、ESC、换页）占比过高视为二进制
fn looks_textual(text: &str) -> bool {
    let mut total = 0usize;
    let mut bad = 0usize;
    for c in text.chars().take(64 * 1024) {
        total += 1;
        if c.is_control() && !matches!(c, '\n' | '\r' | '\t' | '\u{0c}' | '\u{1b}' | '\u{08}') {
            bad += 1;
        }
    }
    total == 0 || bad * 100 <= total
}

fn encode_text(text: &str, enc: TextEncoding) -> Result<Vec<u8>, ApiError> {
    Ok(match enc {
        TextEncoding::Utf8 => text.as_bytes().to_vec(),
        TextEncoding::Utf8Bom => {
            let body = text.strip_prefix('\u{feff}').unwrap_or(text);
            let mut v = vec![0xEF, 0xBB, 0xBF];
            v.extend_from_slice(body.as_bytes());
            v
        }
        TextEncoding::Utf16Le | TextEncoding::Utf16Be => {
            let le = enc == TextEncoding::Utf16Le;
            let mut v = if le { vec![0xFF, 0xFE] } else { vec![0xFE, 0xFF] };
            for u in text.strip_prefix('\u{feff}').unwrap_or(text).encode_utf16() {
                v.extend_from_slice(&if le { u.to_le_bytes() } else { u.to_be_bytes() });
            }
            v
        }
        legacy => {
            let codec = legacy.legacy().expect("legacy encoding");
            let (bytes, _, had_errors) = codec.encode(text);
            if had_errors {
                return Err(ApiError::new(
                    "UnencodableText",
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!("内容包含 {} 无法表示的字符，无法按原编码保存", codec.name()),
                ));
            }
            bytes.into_owned()
        }
    })
}

/// 文件名本身的校验（新建 / 重命名的目标名）
pub(super) fn validate_name(name: &str) -> Result<(), ApiError> {
    if name.is_empty() || name == "." || name == ".." {
        return Err(ApiError::bad_request("文件名不能为空"));
    }
    if name.len() > 255 {
        return Err(ApiError::bad_request("文件名过长"));
    }
    if name.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()) {
        return Err(ApiError::bad_request(format!("文件名包含非法字符: {name}")));
    }
    Ok(())
}

pub(super) fn modified_ms(meta: &Metadata) -> Option<u64> {
    let t = meta.modified().ok()?.into_std();
    t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

fn etag_of(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(&digest[..16])
}

// ==================== 语法校验 ====================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Lang {
    Yaml,
    Json,
    Toml,
}

fn lang_of(path: &StdPath) -> Option<Lang> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "yml" | "yaml" => Some(Lang::Yaml),
        "json" => Some(Lang::Json),
        "toml" => Some(Lang::Toml),
        _ => None,
    }
}

/// 字节偏移 → 1 起始的行列号（列按字符计）
fn line_col_at(text: &str, offset: usize) -> (usize, usize) {
    let offset = offset.min(text.len());
    let before = &text[..text.floor_char_boundary(offset)];
    let line = before.matches('\n').count() + 1;
    let col = before.rsplit('\n').next().map(|s| s.chars().count()).unwrap_or(0) + 1;
    (line, col)
}

fn validate_syntax(lang: Lang, text: &str) -> Result<(), SyntaxError> {
    // 兼容带 BOM 的文件
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    match lang {
        Lang::Json => serde_json::from_str::<serde::de::IgnoredAny>(text)
            .map(|_| ())
            .map_err(|e| SyntaxError {
                line: e.line().max(1),
                column: e.column().max(1),
                message: e.to_string().split(" at line ").next().unwrap_or_default().to_string(),
            }),
        Lang::Yaml => yaml_rust2::YamlLoader::load_from_str(text)
            .map(|_| ())
            .map_err(|e| SyntaxError {
                line: e.marker().line().max(1),
                column: e.marker().col() + 1,
                message: e.info().to_string(),
            }),
        Lang::Toml => toml::from_str::<toml::Table>(text).map(|_| ()).map_err(|e| {
            let (line, column) = e.span().map(|s| line_col_at(text, s.start)).unwrap_or((1, 1));
            SyntaxError {
                line,
                column,
                message: e.message().trim().to_string(),
            }
        }),
    }
}

// ==================== 服务根目录 ====================

pub(super) async fn open_service_root(state: &AppState, service_id: &str) -> Result<Dir, ApiError> {
    let manifest = state.manager.load_manifest(service_id).await?;
    let cwd = manifest
        .cwd
        .filter(|c| !c.trim().is_empty())
        .ok_or_else(|| ApiError::bad_request("该服务未配置工作目录，无法浏览文件"))?;
    tokio::task::spawn_blocking(move || Dir::open_ambient_dir(&cwd, ambient_authority()).map_err(|e| (e, cwd)))
        .await
        .map_err(|e| ApiError::new("Error", StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(|(e, cwd)| match e.kind() {
            io::ErrorKind::NotFound => not_found(format!("工作目录不存在: {cwd}")),
            _ => io_error(e, &cwd),
        })
}

pub(super) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, FileError> + Send + 'static,
) -> Result<T, FileError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| FileError::Api(ApiError::new("Error", StatusCode::INTERNAL_SERVER_ERROR, e.to_string())))?
}


// ==================== 核心操作（同步，便于单元测试） ====================

fn list_dir(root: &Dir, rel: &StdPath) -> Result<DirListing, FileError> {
    let shown = display_path(rel);
    let dir = if rel.as_os_str().is_empty() {
        root.try_clone().map_err(|e| io_error(e, &shown))?
    } else {
        root.open_dir(rel).map_err(|e| io_error(e, &shown))?
    };
    let mut entries = Vec::new();
    let mut truncated = false;
    for item in dir.entries().map_err(|e| io_error(e, &shown))? {
        if entries.len() >= MAX_LIST_ENTRIES {
            truncated = true;
            break;
        }
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        if is_internal_temp(&name) {
            continue;
        }
        let lmeta = dir.symlink_metadata(&name).ok();
        let is_symlink = lmeta.as_ref().map(|m| m.file_type().is_symlink()).unwrap_or(false);
        // 软链接：在沙箱内解析；指向目录外则无法解析，按普通不可编辑项展示
        let meta = if is_symlink { dir.metadata(&name).ok() } else { lmeta };
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let child = rel.join(&name);
        entries.push(FileEntry {
            editable: !is_dir && meta.is_some() && is_editable_name(&name),
            path: display_path(&child),
            size: if is_dir { 0 } else { meta.as_ref().map(|m| m.len()).unwrap_or(0) },
            modified: meta.as_ref().and_then(modified_ms),
            name,
            is_dir,
            is_symlink,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(DirListing { path: shown, entries, truncated })
}

fn require_path(rel: &StdPath) -> Result<(), ApiError> {
    if rel.as_os_str().is_empty() {
        return Err(ApiError::bad_request("路径不能为空"));
    }
    Ok(())
}

fn read_file(root: &Dir, rel: &StdPath, allow_hex: bool) -> Result<FileContent, FileError> {
    require_path(rel)?;
    let shown = display_path(rel);
    let meta = root.metadata(rel).map_err(|e| io_error(e, &shown))?;
    if !meta.is_file() {
        return Err(ApiError::bad_request(format!("不是文件: {shown}")).into());
    }
    let size = meta.len();
    // 文本超过在线编辑上限无法整篇打开；二进制十六进制视图只读前 64 KiB，不受此限
    if size > MAX_EDIT_BYTES && !allow_hex {
        return Err(ApiError::new(
            "FileTooLarge",
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("文件超过 {} MiB，无法在线打开，可以下载查看", MAX_EDIT_BYTES / 1024 / 1024),
        )
        .into());
    }
    if allow_hex {
        use std::io::Read;
        let mut head = Vec::with_capacity(HEX_VIEW_BYTES + 1);
        root.open(rel)
            .map_err(|e| io_error(e, &shown))?
            .into_std()
            .take(HEX_VIEW_BYTES as u64 + 1)
            .read_to_end(&mut head)
            .map_err(|e| io_error(e, &shown))?;
        let mut content = hex_dump(&head[..head.len().min(HEX_VIEW_BYTES)]);
        if size as usize > HEX_VIEW_BYTES && !content.contains("仅显示前") {
            content.push_str(&format!("\n… 仅显示前 {} KiB，共 {} 字节；完整内容请下载\n", HEX_VIEW_BYTES / 1024, size));
        }
        return Ok(FileContent {
            path: shown,
            size,
            etag: String::new(),
            content,
            modified: modified_ms(&meta),
            encoding: TextEncoding::Utf8,
            binary: true,
        });
    }
    let bytes = root.read(rel).map_err(|e| io_error(e, &shown))?;
    let etag = etag_of(&bytes);
    let (content, encoding) = decode_text(&bytes).ok_or_else(|| {
        ApiError::new(
            "BinaryFile",
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "这是二进制文件，无法作为文本打开。可以以十六进制只读查看，或下载后用专门的工具打开",
        )
    })?;
    Ok(FileContent {
        path: shown,
        size,
        content,
        etag,
        modified: modified_ms(&meta),
        encoding,
        binary: false,
    })
}

fn write_file(
    root: &Dir,
    rel: &StdPath,
    content: &str,
    etag: Option<&str>,
    encoding: TextEncoding,
) -> Result<WriteFileResponse, FileError> {
    require_path(rel)?;
    let shown = display_path(rel);
    if content.len() as u64 > MAX_EDIT_BYTES {
        return Err(ApiError::new("FileTooLarge", StatusCode::PAYLOAD_TOO_LARGE, "内容过大").into());
    }
    // 仅对能识别的配置格式做语法校验，其他文本原样保存
    if let Some(lang) = lang_of(rel) {
        validate_syntax(lang, content).map_err(FileError::Syntax)?;
    }
    let bytes = encode_text(content, encoding)?;
    if bytes.len() as u64 > MAX_EDIT_BYTES {
        return Err(ApiError::new("FileTooLarge", StatusCode::PAYLOAD_TOO_LARGE, "内容过大").into());
    }

    let meta = root.metadata(rel).map_err(|e| io_error(e, &shown))?;
    if !meta.is_file() {
        return Err(ApiError::bad_request(format!("不是文件: {shown}")).into());
    }
    if let Some(expected) = etag.filter(|e| !e.is_empty()) {
        let current = etag_of(&root.read(rel).map_err(|e| io_error(e, &shown))?);
        if current != expected {
            return Err(conflict("FileChanged", "文件已被其他程序修改，请重新加载或强制覆盖").into());
        }
    }

    // 同目录临时文件 + rename，保证原子替换
    let parent = rel.parent().unwrap_or(StdPath::new(""));
    let file_name = rel.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = parent.join(format!(".{file_name}.hc-{:08x}.tmp", rand::random::<u32>()));
    let result = (|| -> io::Result<()> {
        let mut opts = OpenOptions::new();
        opts.write(true).create_new(true);
        let mut f = root.open_with(&tmp, &opts)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
        drop(f);
        // 保留原文件权限
        let _ = root.set_permissions(&tmp, meta.permissions());
        root.rename(&tmp, root, rel)
    })();
    if let Err(e) = result {
        let _ = root.remove_file(&tmp);
        return Err(io_error(e, &shown).into());
    }

    let new_meta = root.metadata(rel).ok();
    Ok(WriteFileResponse {
        path: shown,
        etag: etag_of(&bytes),
        size: bytes.len() as u64,
        modified: new_meta.as_ref().and_then(modified_ms),
    })
}

fn create_entry(root: &Dir, rel: &StdPath, kind: CreateKind) -> Result<FileEntry, FileError> {
    let shown = display_path(rel);
    let name = rel
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| ApiError::bad_request("路径不能为空"))?;
    validate_name(&name)?;
    match kind {
        CreateKind::Dir => root.create_dir(rel).map_err(|e| io_error(e, &shown))?,
        CreateKind::File => {
            let lang = lang_of(rel);
            let mut opts = OpenOptions::new();
            opts.write(true).create_new(true);
            let mut f = root.open_with(rel, &opts).map_err(|e| io_error(e, &shown))?;
            if lang == Some(Lang::Json) {
                f.write_all(b"{}\n").map_err(|e| io_error(e, &shown))?;
            }
        }
    }
    let meta = root.metadata(rel).map_err(|e| io_error(e, &shown))?;
    Ok(FileEntry {
        editable: meta.is_file() && is_editable_name(&name),
        path: shown,
        is_dir: meta.is_dir(),
        is_symlink: false,
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified: modified_ms(&meta),
        name,
    })
}

fn rename_entry(root: &Dir, from: &StdPath, to: &StdPath) -> Result<(), FileError> {
    if from.as_os_str().is_empty() || to.as_os_str().is_empty() {
        return Err(ApiError::bad_request("不能移动根目录").into());
    }
    if to.starts_with(from) {
        return Err(ApiError::bad_request("不能移动到自身内部").into());
    }
    let to_name = to.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    validate_name(&to_name)?;
    let (from_s, to_s) = (display_path(from), display_path(to));
    root.symlink_metadata(from).map_err(|e| io_error(e, &from_s))?;
    // rename 会静默覆盖已存在的文件，先显式拒绝
    if root.symlink_metadata(to).is_ok() {
        return Err(conflict("AlreadyExists", format!("目标已存在: {to_s}")).into());
    }
    root.rename(from, root, to).map_err(|e| io_error(e, &to_s))?;
    Ok(())
}

fn delete_entry(root: &Dir, rel: &StdPath) -> Result<(), FileError> {
    let shown = display_path(rel);
    if rel.as_os_str().is_empty() {
        return Err(ApiError::bad_request("不能删除服务根目录").into());
    }
    let meta = root.symlink_metadata(rel).map_err(|e| io_error(e, &shown))?;
    if meta.is_dir() {
        root.remove_dir_all(rel).map_err(|e| io_error(e, &shown))?;
    } else {
        // 文件与软链接本身（不跟随）
        root.remove_file(rel).map_err(|e| io_error(e, &shown))?;
    }
    Ok(())
}

/// 打开要下载的文件：必须是普通文件且不超过上限。返回 std 文件句柄与大小。
fn open_for_download(root: &Dir, rel: &StdPath) -> Result<(std::fs::File, u64), FileError> {
    let shown = display_path(rel);
    if rel.as_os_str().is_empty() {
        return Err(ApiError::bad_request("路径不能为空").into());
    }
    let meta = root.metadata(rel).map_err(|e| io_error(e, &shown))?;
    if !meta.is_file() {
        return Err(ApiError::bad_request(format!("不是文件: {shown}")).into());
    }
    if meta.len() > MAX_TRANSFER_BYTES {
        return Err(too_large(format!(
            "文件超过 {} MiB，无法下载",
            MAX_TRANSFER_BYTES / 1024 / 1024
        ))
        .into());
    }
    let f = root.open(rel).map_err(|e| io_error(e, &shown))?;
    Ok((f.into_std(), meta.len()))
}

pub(super) fn too_large(msg: impl Into<String>) -> ApiError {
    ApiError::new("FileTooLarge", StatusCode::PAYLOAD_TOO_LARGE, msg)
}

/// 校验上传目标：文件名合法、父目录存在、不是目录或软链接；不覆盖时目标必须不存在
pub(super) fn check_upload_target(root: &Dir, target: &StdPath, overwrite: bool) -> Result<String, FileError> {
    let shown = display_path(target);
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| ApiError::bad_request("文件名不能为空"))?;
    validate_name(&name)?;
    let parent = target.parent().unwrap_or(StdPath::new(""));
    if !parent.as_os_str().is_empty() {
        let pm = root.metadata(parent).map_err(|e| io_error(e, &display_path(parent)))?;
        if !pm.is_dir() {
            return Err(ApiError::bad_request(format!("目标目录不存在: {}", display_path(parent))).into());
        }
    }
    match root.symlink_metadata(target) {
        Ok(m) if m.is_dir() => Err(conflict("AlreadyExists", format!("已存在同名文件夹: {shown}")).into()),
        // 不允许通过上传替换软链接（可能指向目录外）
        Ok(m) if m.file_type().is_symlink() => Err(ApiError::forbidden(format!("不能覆盖软链接: {shown}")).into()),
        Ok(_) if !overwrite => Err(conflict("AlreadyExists", format!("文件已存在: {shown}")).into()),
        _ => Ok(name),
    }
}

/// 上传：在目标目录创建临时文件，返回（临时文件相对路径，std 句柄）
fn begin_upload(root: &Dir, target: &StdPath, overwrite: bool) -> Result<(PathBuf, std::fs::File), FileError> {
    let shown = display_path(target);
    let name = check_upload_target(root, target, overwrite)?;
    let parent = target.parent().unwrap_or(StdPath::new(""));
    let tmp = parent.join(format!(".{name}.hc-upload-{:08x}.tmp", rand::random::<u32>()));
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    let f = root.open_with(&tmp, &opts).map_err(|e| io_error(e, &shown))?;
    Ok((tmp, f.into_std()))
}

/// 上传完成：原子替换到目标位置
pub(super) fn finish_upload(root: &Dir, tmp: &StdPath, target: &StdPath, overwrite: bool) -> Result<FileEntry, FileError> {
    let shown = display_path(target);
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    // 覆盖时保留原文件权限；再次确认目标没有在上传期间变成目录/软链接/新文件
    match root.symlink_metadata(target) {
        Ok(m) if m.is_dir() || m.file_type().is_symlink() => {
            let _ = root.remove_file(tmp);
            return Err(conflict("AlreadyExists", format!("目标已变更: {shown}")).into());
        }
        Ok(m) => {
            if !overwrite {
                let _ = root.remove_file(tmp);
                return Err(conflict("AlreadyExists", format!("文件已存在: {shown}")).into());
            }
            let _ = root.set_permissions(tmp, m.permissions());
        }
        Err(_) => {}
    }
    if let Err(e) = root.rename(tmp, root, target) {
        let _ = root.remove_file(tmp);
        return Err(io_error(e, &shown).into());
    }
    let meta = root.metadata(target).map_err(|e| io_error(e, &shown))?;
    Ok(FileEntry {
        editable: is_editable_name(&name),
        path: shown,
        is_dir: false,
        is_symlink: false,
        size: meta.len(),
        modified: modified_ms(&meta),
        name,
    })
}

/// RFC 5987 文件名编码，兼容中文
fn content_disposition(name: &str) -> String {
    let ascii: String = name
        .chars()
        .map(|c| if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' { c } else { '_' })
        .collect();
    format!(
        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
        ascii,
        urlencoding::encode(name)
    )
}

// ==================== HTTP handlers ====================

/// GET /services/:id/files?path=dir
pub async fn list_files(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Query(q): Query<PathQuery>,
) -> Result<Json<DirListing>, FileError> {
    auth.require_files_read(&id)?;
    let rel = normalize_rel(&q.path)?;
    let root = open_service_root(&state, &id).await?;
    blocking(move || list_dir(&root, &rel)).await.map(Json)
}

/// GET /services/:id/files/content?path=file
pub async fn read_file_content(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Query(q): Query<PathQuery>,
) -> Result<Json<FileContent>, FileError> {
    auth.require_files_read(&id)?;
    let rel = normalize_rel(&q.path)?;
    let root = open_service_root(&state, &id).await?;
    let hex = q.view.as_deref() == Some("hex");
    blocking(move || read_file(&root, &rel, hex)).await.map(Json)
}

/// PUT /services/:id/files/content
pub async fn write_file_content(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Json(req): Json<WriteFileRequest>,
) -> Result<Json<WriteFileResponse>, FileError> {
    auth.require_files_write(&id)?;
    let rel = normalize_rel(&req.path)?;
    let root = open_service_root(&state, &id).await?;
    tracing::info!(service_id = %id, path = %req.path, user = %auth.claims.sub, "write service file");
    blocking(move || write_file(&root, &rel, &req.content, req.etag.as_deref(), req.encoding))
        .await
        .map(Json)
}

/// POST /services/:id/files/create
pub async fn create_file_entry(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Json(req): Json<CreateRequest>,
) -> Result<Json<FileEntry>, FileError> {
    auth.require_files_write(&id)?;
    let rel = normalize_rel(&req.path)?;
    let root = open_service_root(&state, &id).await?;
    tracing::info!(service_id = %id, path = %req.path, user = %auth.claims.sub, "create service file");
    blocking(move || create_entry(&root, &rel, req.kind)).await.map(Json)
}

/// POST /services/:id/files/rename（重命名与移动）
pub async fn rename_file_entry(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Json(req): Json<RenameRequest>,
) -> Result<StatusCode, FileError> {
    auth.require_files_write(&id)?;
    let from = normalize_rel(&req.from)?;
    let to = normalize_rel(&req.to)?;
    let root = open_service_root(&state, &id).await?;
    tracing::info!(service_id = %id, from = %req.from, to = %req.to, user = %auth.claims.sub, "rename service file");
    blocking(move || rename_entry(&root, &from, &to)).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /services/:id/files?path=x
pub async fn delete_file_entry(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Query(q): Query<PathQuery>,
) -> Result<StatusCode, FileError> {
    auth.require_files_write(&id)?;
    let rel = normalize_rel(&q.path)?;
    let root = open_service_root(&state, &id).await?;
    tracing::info!(service_id = %id, path = %q.path, user = %auth.claims.sub, "delete service file");
    blocking(move || delete_entry(&root, &rel)).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct UploadQuery {
    /// 目标目录（相对工作目录）
    #[serde(default)]
    pub dir: String,
    /// 文件名
    pub name: String,
    /// 同名文件是否覆盖
    #[serde(default)]
    pub overwrite: bool,
}

/// 解析单段 Range 头（`bytes=a-b` / `bytes=a-` / `bytes=-n`），返回闭区间 [start, end]
fn parse_range(h: &str, len: u64) -> Option<(u64, u64)> {
    let spec = h.trim().strip_prefix("bytes=")?;
    if spec.contains(',') || len == 0 {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => {
            let n: u64 = n.parse().ok()?;
            if n == 0 {
                return None;
            }
            (len.saturating_sub(n), len - 1)
        }
        (a, "") => (a.parse().ok()?, len - 1),
        (a, b) => (a.parse().ok()?, b.parse::<u64>().ok()?.min(len - 1)),
    };
    (start <= end && start < len).then_some((start, end))
}

/// GET /services/:id/files/download?path=x —— 流式下载（≤ 512 MiB），支持 Range 断点续传
pub async fn download_file(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Query(q): Query<PathQuery>,
    headers: HeaderMap,
) -> Result<Response, FileError> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    auth.require_files_read(&id)?;
    let rel = normalize_rel(&q.path)?;
    let name = rel
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".into());
    let root = open_service_root(&state, &id).await?;
    let (file, len) = blocking(move || open_for_download(&root, &rel)).await?;
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|h| parse_range(h, len));
    let internal = |e: String| FileError::Api(ApiError::new("Error", StatusCode::INTERNAL_SERVER_ERROR, e));
    let base = Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_DISPOSITION, content_disposition(&name))
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff");
    let mut file = tokio::fs::File::from_std(file);
    match range {
        // 请求了 Range 但不可满足
        Some(None) => base
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{len}"))
            .body(Body::empty())
            .map_err(|e| internal(e.to_string())),
        Some(Some((start, end))) => {
            file.seek(io::SeekFrom::Start(start)).await.map_err(|e| io_error(e, &name))?;
            let n = end - start + 1;
            let stream = tokio_util::io::ReaderStream::new(file.take(n));
            base.status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_LENGTH, n)
                .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
                .body(Body::from_stream(stream))
                .map_err(|e| internal(e.to_string()))
        }
        None => {
            tracing::info!(service_id = %id, path = %q.path, user = %auth.claims.sub, "download service file");
            base.header(header::CONTENT_LENGTH, len)
                .body(Body::from_stream(tokio_util::io::ReaderStream::new(file)))
                .map_err(|e| internal(e.to_string()))
        }
    }
}

/// PUT /services/:id/files/upload?dir=x&name=y&overwrite=bool
/// 请求体即文件原始字节（不用 multipart，便于流式与进度）。≤ 512 MiB。
pub async fn upload_file(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Query(q): Query<UploadQuery>,
    headers: HeaderMap,
    body: Body,
) -> Result<Json<FileEntry>, FileError> {
    auth.require_files_write(&id)?;
    // 先按 Content-Length 快速拒绝
    if let Some(len) = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
    {
        if len > MAX_TRANSFER_BYTES {
            return Err(too_large(format!("文件超过 {} MiB", MAX_TRANSFER_BYTES / 1024 / 1024)).into());
        }
    }
    let dir = normalize_rel(&q.dir)?;
    let name = q.name.trim().to_string();
    validate_name(&name)?;
    let target = dir.join(&name);
    let root = open_service_root(&state, &id).await?;
    let root = std::sync::Arc::new(root);

    let (tmp, file) = {
        let (root, target, overwrite) = (root.clone(), target.clone(), q.overwrite);
        blocking(move || begin_upload(&root, &target, overwrite)).await?
    };

    // 流式写入临时文件，超限即中止
    let write_result: Result<(), FileError> = async {
        use tokio::io::AsyncWriteExt;
        let mut out = tokio::fs::File::from_std(file);
        let mut written: u64 = 0;
        let mut stream = body.into_data_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| ApiError::bad_request(format!("上传中断: {e}")))?;
            written += chunk.len() as u64;
            if written > MAX_TRANSFER_BYTES {
                return Err(too_large(format!("文件超过 {} MiB", MAX_TRANSFER_BYTES / 1024 / 1024)).into());
            }
            out.write_all(&chunk).await.map_err(|e| io_error(e, &name))?;
        }
        out.sync_all().await.map_err(|e| io_error(e, &name))?;
        Ok(())
    }
    .await;

    if let Err(e) = write_result {
        let (root, tmp) = (root.clone(), tmp.clone());
        let _ = tokio::task::spawn_blocking(move || root.remove_file(&tmp)).await;
        return Err(e);
    }

    let overwrite = q.overwrite;
    let entry = blocking(move || finish_upload(&root, &tmp, &target, overwrite)).await?;
    tracing::info!(service_id = %id, path = %entry.path, size = entry.size, user = %auth.claims.sub, "upload service file");
    Ok(Json(entry))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox() -> (tempfile::TempDir, Dir) {
        let tmp = tempfile::tempdir().unwrap();
        let root = Dir::open_ambient_dir(tmp.path(), ambient_authority()).unwrap();
        (tmp, root)
    }

    fn api_status(e: FileError) -> StatusCode {
        e.into_response().status()
    }

    #[test]
    fn normalize_rejects_escape() {
        assert_eq!(normalize_rel("").unwrap(), PathBuf::new());
        assert_eq!(normalize_rel("/config/a.yml").unwrap(), PathBuf::from("config/a.yml"));
        assert_eq!(normalize_rel("./a/./b.json").unwrap(), PathBuf::from("a/b.json"));
        assert!(normalize_rel("../etc/passwd").is_err());
        assert!(normalize_rel("a/../../b").is_err());
        assert!(normalize_rel("a\0b").is_err());
        #[cfg(windows)]
        assert!(normalize_rel("C:\\Windows").is_err());
    }

    #[test]
    fn syntax_validation_reports_position() {
        assert!(validate_syntax(Lang::Json, "{\"a\": 1}").is_ok());
        let e = validate_syntax(Lang::Json, "{\n  \"a\": 1\n  \"b\": 2\n}").unwrap_err();
        assert_eq!(e.line, 3);

        assert!(validate_syntax(Lang::Yaml, "a:\n  b: 1\n").is_ok());
        let e = validate_syntax(Lang::Yaml, "a: 1\nb: [1, 2\n").unwrap_err();
        assert!(e.line >= 2, "{e:?}");

        assert!(validate_syntax(Lang::Toml, "a = 1\n[s]\nb = \"x\"\n").is_ok());
        let e = validate_syntax(Lang::Toml, "a = 1\nb = tru e\n").unwrap_err();
        assert_eq!(e.line, 2);

        // BOM 兼容
        assert!(validate_syntax(Lang::Json, "\u{feff}{}").is_ok());
    }

    #[test]
    fn list_read_write_roundtrip() {
        let (tmp, root) = sandbox();
        std::fs::create_dir(tmp.path().join("config")).unwrap();
        std::fs::write(tmp.path().join("config/a.yml"), "a: 1\n").unwrap();
        std::fs::write(tmp.path().join("server.jar"), b"\0\0").unwrap();

        let ls = list_dir(&root, StdPath::new("")).unwrap();
        assert_eq!(ls.entries[0].name, "config");
        assert!(ls.entries[0].is_dir);
        assert!(!ls.entries[1].editable);

        let f = read_file(&root, StdPath::new("config/a.yml"), false).unwrap();
        assert_eq!(f.content, "a: 1\n");

        let w = write_file(&root, StdPath::new("config/a.yml"), "a: 2\n", Some(&f.etag), f.encoding).unwrap();
        assert_ne!(w.etag, f.etag);
        assert_eq!(std::fs::read_to_string(tmp.path().join("config/a.yml")).unwrap(), "a: 2\n");
        // 没有遗留临时文件
        assert_eq!(std::fs::read_dir(tmp.path().join("config")).unwrap().count(), 1);

        // 旧 etag → 冲突
        let e = write_file(&root, StdPath::new("config/a.yml"), "a: 3\n", Some(&f.etag), f.encoding).unwrap_err();
        assert_eq!(api_status(e), StatusCode::CONFLICT);
        // 语法错误 → 422，且原文件不变
        let e = write_file(&root, StdPath::new("config/a.yml"), "a: [1\n", None, TextEncoding::Utf8).unwrap_err();
        assert_eq!(api_status(e), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(std::fs::read_to_string(tmp.path().join("config/a.yml")).unwrap(), "a: 2\n");
        // 二进制文件不可读
        let e = read_file(&root, StdPath::new("server.jar"), false).unwrap_err();
        assert_eq!(api_status(e), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }

    #[test]
    fn any_text_file_can_be_opened_and_saved() {
        let (tmp, root) = sandbox();
        // 无扩展名 / 任意扩展名的文本都能打开，保存不做语法校验
        std::fs::write(tmp.path().join("eula.txt"), "eula=false\n").unwrap();
        std::fs::write(tmp.path().join("start"), "#!/bin/sh\njava -jar server.jar\n").unwrap();
        std::fs::write(tmp.path().join("server.properties"), "motd=hi\n").unwrap();
        for name in ["eula.txt", "start", "server.properties"] {
            let f = read_file(&root, StdPath::new(name), false).unwrap();
            assert_eq!(f.encoding, TextEncoding::Utf8);
        }
        let f = read_file(&root, StdPath::new("eula.txt"), false).unwrap();
        write_file(&root, StdPath::new("eula.txt"), "eula=true\n[unbalanced", Some(&f.etag), f.encoding).unwrap();
        assert_eq!(std::fs::read_to_string(tmp.path().join("eula.txt")).unwrap(), "eula=true\n[unbalanced");

        // GBK 编码按原编码写回
        let (gbk, _, _) = encoding_rs::GBK.encode("名称: 主城\n");
        std::fs::write(tmp.path().join("zh.yml"), &gbk).unwrap();
        let f = read_file(&root, StdPath::new("zh.yml"), false).unwrap();
        assert_eq!(f.encoding, TextEncoding::Gb18030);
        assert_eq!(f.content, "名称: 主城\n");
        write_file(&root, StdPath::new("zh.yml"), "名称: 副城\n", Some(&f.etag), f.encoding).unwrap();
        let (expected, _, _) = encoding_rs::GBK.encode("名称: 副城\n");
        assert_eq!(std::fs::read(tmp.path().join("zh.yml")).unwrap(), expected.into_owned());

        // UTF-8 BOM 与 UTF-16LE 保留
        std::fs::write(tmp.path().join("bom.txt"), b"\xEF\xBB\xBFhello").unwrap();
        let f = read_file(&root, StdPath::new("bom.txt"), false).unwrap();
        assert_eq!((f.content.as_str(), f.encoding), ("hello", TextEncoding::Utf8Bom));
        write_file(&root, StdPath::new("bom.txt"), "bye", Some(&f.etag), f.encoding).unwrap();
        assert_eq!(std::fs::read(tmp.path().join("bom.txt")).unwrap(), b"\xEF\xBB\xBFbye");
        let mut u16 = vec![0xFF, 0xFE];
        for u in "日志".encode_utf16() {
            u16.extend_from_slice(&u.to_le_bytes());
        }
        std::fs::write(tmp.path().join("w.log"), &u16).unwrap();
        let f = read_file(&root, StdPath::new("w.log"), false).unwrap();
        assert_eq!((f.content.as_str(), f.encoding), ("日志", TextEncoding::Utf16Le));

        // 二进制：含 NUL / 随机字节
        std::fs::write(tmp.path().join("level.dat"), [0x1f, 0x8b, 0x08, 0x00, 0xff, 0x00]).unwrap();
        assert_eq!(api_status(read_file(&root, StdPath::new("level.dat"), false).unwrap_err()), StatusCode::UNSUPPORTED_MEDIA_TYPE);
        // 真实 PNG 头（IHDR 长度字段含 NUL）
        std::fs::write(
            tmp.path().join("x.png"),
            [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52],
        )
        .unwrap();
        assert!(read_file(&root, StdPath::new("x.png"), false).is_err());
        // 二进制可以十六进制只读查看
        let h = read_file(&root, StdPath::new("x.png"), true).unwrap();
        assert!(h.binary);
        assert!(h.content.starts_with("00000000  89 50 4e 47 0d 0a 1a 0a  00 00 00 0d 49 48 44 52  |.PNG........IHDR|"), "{}", h.content);

        // 其他 CJK 编码与无 BOM 的 UTF-16
        let jp = "# サーバーの設定ファイルです。ここでプレイヤーの最大人数やワールドの名前を変更できます。\nmotd=ようこそ、マインクラフトのサーバーへ\n";
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode(jp);
        std::fs::write(tmp.path().join("jp.cfg"), &sjis).unwrap();
        let f = read_file(&root, StdPath::new("jp.cfg"), false).unwrap();
        assert_eq!((f.content.as_str(), f.encoding), (jp, TextEncoding::ShiftJis));
        let tw = "# 伺服器設定檔，可以在這裡修改玩家人數與世界名稱。\nmotd=歡迎來到我們的伺服器\n";
        let (big5, _, _) = encoding_rs::BIG5.encode(tw);
        std::fs::write(tmp.path().join("tw.cfg"), &big5).unwrap();
        let f = read_file(&root, StdPath::new("tw.cfg"), false).unwrap();
        assert_eq!((f.content.as_str(), f.encoding), (tw, TextEncoding::Big5));
        let mut le = Vec::new();
        for u in "level-name=world\r\n".encode_utf16() {
            le.extend_from_slice(&u.to_le_bytes());
        }
        std::fs::write(tmp.path().join("nobom.ini"), &le).unwrap();
        let f = read_file(&root, StdPath::new("nobom.ini"), false).unwrap();
        assert_eq!((f.content.as_str(), f.encoding), ("level-name=world\r\n", TextEncoding::Utf16Le));
        write_file(&root, StdPath::new("nobom.ini"), "level-name=x\r\n", Some(&f.etag), f.encoding).unwrap();
        // 写回时补 BOM，内容可再次正确读出
        let f = read_file(&root, StdPath::new("nobom.ini"), false).unwrap();
        assert_eq!(f.content, "level-name=x\r\n");

        // Latin-1 兜底：任意非 UTF-8 的西文文本也能打开并原样写回
        std::fs::write(tmp.path().join("latin.txt"), b"caf\xe9 cr\xe8me\n").unwrap();
        let f = read_file(&root, StdPath::new("latin.txt"), false).unwrap();
        assert!(f.content.ends_with("me\n"));
        write_file(&root, StdPath::new("latin.txt"), &f.content, Some(&f.etag), f.encoding).unwrap();
        assert_eq!(std::fs::read(tmp.path().join("latin.txt")).unwrap(), b"caf\xe9 cr\xe8me\n");

        // 二进制扩展名但内容是文本：照样打开
        std::fs::write(tmp.path().join("notes.dat"), "plain text\n").unwrap();
        assert_eq!(read_file(&root, StdPath::new("notes.dat"), false).unwrap().content, "plain text\n");

        // 新建任意扩展名
        let e = create_entry(&root, StdPath::new("notes.md"), CreateKind::File).unwrap();
        assert!(e.editable);
        assert!(!is_editable_name("server.jar"));
        assert!(is_editable_name("start.sh"));
        assert!(is_editable_name("Dockerfile"));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_blocked() {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.yml"), "token: x\n").unwrap();
        let (tmp, root) = sandbox();
        std::os::unix::fs::symlink(outside.path(), tmp.path().join("escape")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.yml"), tmp.path().join("s.yml")).unwrap();

        assert!(read_file(&root, StdPath::new("escape/secret.yml"), false).is_err());
        assert!(read_file(&root, StdPath::new("s.yml"), false).is_err());
        assert!(write_file(&root, StdPath::new("s.yml"), "a: 1\n", None, TextEncoding::Utf8).is_err());
        assert!(list_dir(&root, StdPath::new("escape")).is_err());
        assert_eq!(std::fs::read_to_string(outside.path().join("secret.yml")).unwrap(), "token: x\n");

        // 删除软链接只删链接本身
        delete_entry(&root, StdPath::new("escape")).unwrap();
        assert!(outside.path().join("secret.yml").exists());
    }

    #[test]
    fn create_rename_delete() {
        let (tmp, root) = sandbox();
        create_entry(&root, StdPath::new("plugins"), CreateKind::Dir).unwrap();
        let f = create_entry(&root, StdPath::new("plugins/x.json"), CreateKind::File).unwrap();
        assert!(f.editable);
        assert_eq!(std::fs::read_to_string(tmp.path().join("plugins/x.json")).unwrap(), "{}\n");
        // 任意文本文件均可新建（二进制扩展名仅影响列表提示）
        assert!(create_entry(&root, StdPath::new("run.sh"), CreateKind::File).is_ok());
        // 重复新建
        assert!(create_entry(&root, StdPath::new("plugins"), CreateKind::Dir).is_err());

        rename_entry(&root, StdPath::new("plugins/x.json"), StdPath::new("y.json")).unwrap();
        assert!(tmp.path().join("y.json").exists());
        // 目标存在时拒绝覆盖
        create_entry(&root, StdPath::new("z.json"), CreateKind::File).unwrap();
        assert!(rename_entry(&root, StdPath::new("y.json"), StdPath::new("z.json")).is_err());
        // 不能移入自身
        assert!(rename_entry(&root, StdPath::new("plugins"), StdPath::new("plugins/sub")).is_err());

        delete_entry(&root, StdPath::new("plugins")).unwrap();
        assert!(!tmp.path().join("plugins").exists());
        assert!(delete_entry(&root, StdPath::new("")).is_err());
    }

    #[test]
    fn upload_and_download_helpers() {
        let (tmp, root) = sandbox();
        std::fs::create_dir(tmp.path().join("plugins")).unwrap();

        // 正常上传
        let (t, mut f) = begin_upload(&root, StdPath::new("plugins/a.jar"), false).unwrap();
        f.write_all(b"jarbytes").unwrap();
        drop(f);
        let e = finish_upload(&root, &t, StdPath::new("plugins/a.jar"), false).unwrap();
        assert_eq!(e.size, 8);
        assert!(!e.editable);
        assert_eq!(std::fs::read(tmp.path().join("plugins/a.jar")).unwrap(), b"jarbytes");
        // 没有遗留临时文件
        assert_eq!(std::fs::read_dir(tmp.path().join("plugins")).unwrap().count(), 1);

        // 同名不覆盖 → 409；覆盖 → 成功
        assert_eq!(api_status(begin_upload(&root, StdPath::new("plugins/a.jar"), false).unwrap_err()), StatusCode::CONFLICT);
        let (t, mut f) = begin_upload(&root, StdPath::new("plugins/a.jar"), true).unwrap();
        f.write_all(b"v2").unwrap();
        drop(f);
        finish_upload(&root, &t, StdPath::new("plugins/a.jar"), true).unwrap();
        assert_eq!(std::fs::read(tmp.path().join("plugins/a.jar")).unwrap(), b"v2");

        // 目标是目录 / 父目录不存在
        assert!(begin_upload(&root, StdPath::new("plugins"), true).is_err());
        assert!(begin_upload(&root, StdPath::new("nope/x.txt"), false).is_err());

        // 下载
        let (_f, len) = open_for_download(&root, StdPath::new("plugins/a.jar")).unwrap();
        assert_eq!(len, 2);
        assert!(open_for_download(&root, StdPath::new("plugins")).is_err());
        assert!(open_for_download(&root, StdPath::new("")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn upload_download_symlink_escape_blocked() {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.bin"), b"top").unwrap();
        let (tmp, root) = sandbox();
        std::os::unix::fs::symlink(outside.path(), tmp.path().join("escape")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.bin"), tmp.path().join("s.bin")).unwrap();

        assert!(open_for_download(&root, StdPath::new("escape/secret.bin")).is_err());
        assert!(open_for_download(&root, StdPath::new("s.bin")).is_err());
        assert!(begin_upload(&root, StdPath::new("escape/new.bin"), true).is_err());
        // 不能覆盖软链接
        assert!(begin_upload(&root, StdPath::new("s.bin"), true).is_err());
        assert!(!outside.path().join("new.bin").exists());
        assert_eq!(std::fs::read(outside.path().join("secret.bin")).unwrap(), b"top");
    }

    #[test]
    fn range_parsing() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=900-5000", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=5-1", 1000), None);
        assert_eq!(parse_range("bytes=0-1,5-6", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
    }

    #[test]
    fn content_disposition_encodes_utf8() {
        let h = content_disposition("配置 文件.yml");
        assert!(h.contains("filename*=UTF-8''%E9%85%8D"));
        assert!(h.starts_with("attachment; filename=\""));
        assert!(!content_disposition("a\"b.txt").contains("a\"b"));
    }

    #[test]
    fn line_col_from_offset() {
        assert_eq!(line_col_at("ab\ncd", 0), (1, 1));
        assert_eq!(line_col_at("ab\ncd", 4), (2, 2));
        assert_eq!(line_col_at("中文\nx", 7), (2, 1));
    }
}
