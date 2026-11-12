//! 服务工作目录内的文件浏览与配置编辑。
//!
//! 安全模型：
//! - 以服务 manifest 的 `cwd` 为根，通过 `cap-std` 打开为能力目录（capability），
//!   之后所有操作只能在该目录内进行，`..`、绝对路径、指向目录外的软链接均会被拒绝；
//! - 请求路径额外做词法校验（只允许普通路径段），双重防护；
//! - 独立的文件管理权限：用户 `file_access`（none / read / write），API Key scope
//!   `files:read` / `files:write`；系统管理员恒有读写；同时仍需该服务的访问权；
//! - 在线查看与编辑仅限 YAML / JSON / TOML，保存前做语法校验，失败返回 422 与行列号；
//! - 上传与下载支持任意类型，单文件上限 25 MiB；上传流式落盘，超限立即中止并清理；
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

/// 单文件上限：在线编辑、上传、下载统一 25 MiB
pub const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
/// 在线编辑的大小上限
const MAX_EDIT_BYTES: u64 = MAX_FILE_BYTES;
/// 写入接口的 JSON 请求体上限（内容 25 MiB + JSON 转义余量）
pub const MAX_WRITE_BODY_BYTES: usize = (MAX_FILE_BYTES as usize) * 2 + 64 * 1024;
/// 单个目录最多返回的条目数
const MAX_LIST_ENTRIES: usize = 10_000;
/// 允许查看与编辑的扩展名
const EDITABLE_EXTS: &[&str] = &["yml", "yaml", "json", "toml"];

// ==================== 请求 / 响应 ====================

#[derive(Debug, Deserialize)]
pub struct PathQuery {
    #[serde(default)]
    pub path: String,
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
}

#[derive(Debug, Deserialize)]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
    /// 读取时拿到的 etag；为空表示强制覆盖
    #[serde(default)]
    pub etag: Option<String>,
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

fn not_found(msg: impl Into<String>) -> ApiError {
    ApiError::new("NotFound", StatusCode::NOT_FOUND, msg)
}

fn conflict(code: &'static str, msg: impl Into<String>) -> ApiError {
    ApiError::new(code, StatusCode::CONFLICT, msg)
}

fn io_error(err: io::Error, path: &str) -> ApiError {
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
fn normalize_rel(raw: &str) -> Result<PathBuf, ApiError> {
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
fn display_path(p: &StdPath) -> String {
    p.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn is_editable_name(name: &str) -> bool {
    StdPath::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| EDITABLE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 文件名本身的校验（新建 / 重命名的目标名）
fn validate_name(name: &str) -> Result<(), ApiError> {
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

fn modified_ms(meta: &Metadata) -> Option<u64> {
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

async fn open_service_root(state: &AppState, service_id: &str) -> Result<Dir, ApiError> {
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

async fn blocking<T: Send + 'static>(
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

fn require_editable(rel: &StdPath) -> Result<Lang, ApiError> {
    if rel.as_os_str().is_empty() {
        return Err(ApiError::bad_request("路径不能为空"));
    }
    lang_of(rel).ok_or_else(|| {
        ApiError::new(
            "UnsupportedFileType",
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "仅支持查看和编辑 YAML / JSON / TOML 文件",
        )
    })
}

fn read_file(root: &Dir, rel: &StdPath) -> Result<FileContent, FileError> {
    require_editable(rel)?;
    let shown = display_path(rel);
    let meta = root.metadata(rel).map_err(|e| io_error(e, &shown))?;
    if !meta.is_file() {
        return Err(ApiError::bad_request(format!("不是文件: {shown}")).into());
    }
    if meta.len() > MAX_EDIT_BYTES {
        return Err(ApiError::new(
            "FileTooLarge",
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("文件超过 {} MiB，无法在线编辑", MAX_EDIT_BYTES / 1024 / 1024),
        )
        .into());
    }
    let bytes = root.read(rel).map_err(|e| io_error(e, &shown))?;
    let etag = etag_of(&bytes);
    let content = String::from_utf8(bytes).map_err(|_| {
        ApiError::new(
            "UnsupportedEncoding",
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "文件不是 UTF-8 编码，暂不支持在线编辑",
        )
    })?;
    Ok(FileContent {
        path: shown,
        size: content.len() as u64,
        content,
        etag,
        modified: modified_ms(&meta),
    })
}

fn write_file(root: &Dir, rel: &StdPath, content: &str, etag: Option<&str>) -> Result<WriteFileResponse, FileError> {
    let lang = require_editable(rel)?;
    let shown = display_path(rel);
    if content.len() as u64 > MAX_EDIT_BYTES {
        return Err(ApiError::new("FileTooLarge", StatusCode::PAYLOAD_TOO_LARGE, "内容过大").into());
    }
    validate_syntax(lang, content).map_err(FileError::Syntax)?;

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
        f.write_all(content.as_bytes())?;
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
        etag: etag_of(content.as_bytes()),
        size: content.len() as u64,
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
            let lang = require_editable(rel)?;
            let mut opts = OpenOptions::new();
            opts.write(true).create_new(true);
            let mut f = root.open_with(rel, &opts).map_err(|e| io_error(e, &shown))?;
            if lang == Lang::Json {
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
    if meta.len() > MAX_FILE_BYTES {
        return Err(too_large(format!(
            "文件超过 {} MiB，无法下载",
            MAX_FILE_BYTES / 1024 / 1024
        ))
        .into());
    }
    let f = root.open(rel).map_err(|e| io_error(e, &shown))?;
    Ok((f.into_std(), meta.len()))
}

fn too_large(msg: impl Into<String>) -> ApiError {
    ApiError::new("FileTooLarge", StatusCode::PAYLOAD_TOO_LARGE, msg)
}

/// 上传：在目标目录创建临时文件，返回（临时文件相对路径，std 句柄）
fn begin_upload(root: &Dir, target: &StdPath, overwrite: bool) -> Result<(PathBuf, std::fs::File), FileError> {
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
        Ok(m) if m.is_dir() => {
            return Err(conflict("AlreadyExists", format!("已存在同名文件夹: {shown}")).into());
        }
        Ok(m) if m.file_type().is_symlink() => {
            // 不允许通过上传替换软链接（可能指向目录外）
            return Err(ApiError::forbidden(format!("不能覆盖软链接: {shown}")).into());
        }
        Ok(_) if !overwrite => {
            return Err(conflict("AlreadyExists", format!("文件已存在: {shown}")).into());
        }
        _ => {}
    }
    let tmp = parent.join(format!(".{name}.hc-upload-{:08x}.tmp", rand::random::<u32>()));
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    let f = root.open_with(&tmp, &opts).map_err(|e| io_error(e, &shown))?;
    Ok((tmp, f.into_std()))
}

/// 上传完成：原子替换到目标位置
fn finish_upload(root: &Dir, tmp: &StdPath, target: &StdPath, overwrite: bool) -> Result<FileEntry, FileError> {
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
    blocking(move || read_file(&root, &rel)).await.map(Json)
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
    blocking(move || write_file(&root, &rel, &req.content, req.etag.as_deref()))
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

/// GET /services/:id/files/download?path=x —— 流式下载（≤ 25 MiB）
pub async fn download_file(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Query(q): Query<PathQuery>,
) -> Result<Response, FileError> {
    auth.require_files_read(&id)?;
    let rel = normalize_rel(&q.path)?;
    let name = rel
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".into());
    let root = open_service_root(&state, &id).await?;
    let (file, len) = blocking(move || open_for_download(&root, &rel)).await?;
    tracing::info!(service_id = %id, path = %q.path, user = %auth.claims.sub, "download service file");
    let stream = tokio_util::io::ReaderStream::new(tokio::fs::File::from_std(file));
    Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_LENGTH, len)
        .header(header::CONTENT_DISPOSITION, content_disposition(&name))
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(Body::from_stream(stream))
        .map_err(|e| FileError::Api(ApiError::new("Error", StatusCode::INTERNAL_SERVER_ERROR, e.to_string())))
}

/// PUT /services/:id/files/upload?dir=x&name=y&overwrite=bool
/// 请求体即文件原始字节（不用 multipart，便于流式与进度）。≤ 25 MiB。
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
        if len > MAX_FILE_BYTES {
            return Err(too_large(format!("文件超过 {} MiB", MAX_FILE_BYTES / 1024 / 1024)).into());
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
            if written > MAX_FILE_BYTES {
                return Err(too_large(format!("文件超过 {} MiB", MAX_FILE_BYTES / 1024 / 1024)).into());
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

        let f = read_file(&root, StdPath::new("config/a.yml")).unwrap();
        assert_eq!(f.content, "a: 1\n");

        let w = write_file(&root, StdPath::new("config/a.yml"), "a: 2\n", Some(&f.etag)).unwrap();
        assert_ne!(w.etag, f.etag);
        assert_eq!(std::fs::read_to_string(tmp.path().join("config/a.yml")).unwrap(), "a: 2\n");
        // 没有遗留临时文件
        assert_eq!(std::fs::read_dir(tmp.path().join("config")).unwrap().count(), 1);

        // 旧 etag → 冲突
        let e = write_file(&root, StdPath::new("config/a.yml"), "a: 3\n", Some(&f.etag)).unwrap_err();
        assert_eq!(api_status(e), StatusCode::CONFLICT);
        // 语法错误 → 422，且原文件不变
        let e = write_file(&root, StdPath::new("config/a.yml"), "a: [1\n", None).unwrap_err();
        assert_eq!(api_status(e), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(std::fs::read_to_string(tmp.path().join("config/a.yml")).unwrap(), "a: 2\n");
        // 非配置文件不可读写
        let e = read_file(&root, StdPath::new("server.jar")).unwrap_err();
        assert_eq!(api_status(e), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_blocked() {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.yml"), "token: x\n").unwrap();
        let (tmp, root) = sandbox();
        std::os::unix::fs::symlink(outside.path(), tmp.path().join("escape")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.yml"), tmp.path().join("s.yml")).unwrap();

        assert!(read_file(&root, StdPath::new("escape/secret.yml")).is_err());
        assert!(read_file(&root, StdPath::new("s.yml")).is_err());
        assert!(write_file(&root, StdPath::new("s.yml"), "a: 1\n", None).is_err());
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
        // 只能新建配置文件
        assert!(create_entry(&root, StdPath::new("run.sh"), CreateKind::File).is_err());
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
