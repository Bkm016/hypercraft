//! 分片上传与断点续传。
//!
//! 流程：
//! 1. `POST   /services/:id/files/uploads`                    创建会话（或按指纹找回未完成的会话）
//! 2. `PUT    /services/:id/files/uploads/:uid/chunks/:index` 上传分片（可并发、可重试，幂等）
//! 3. `GET    /services/:id/files/uploads/:uid`               查询已收到的分片（断点续传）
//! 4. `POST   /services/:id/files/uploads/:uid/complete`      校验齐全后原子落盘
//! 5. `DELETE /services/:id/files/uploads/:uid`               取消并清理
//!
//! 设计要点：
//! - 数据直接写入目标目录下的隐藏文件 `.<name>.hc-<uid>.part`（与目标同一文件系统，完成时 rename 原子替换），
//!   按 `index * chunk_size` 定位写入，分片可乱序、可并发、可重复；
//! - 会话元数据（目标、大小、分片位图、所属用户）存于 `<HC_DATA_DIR>/file-uploads/<uid>.json`，
//!   API 重启后仍可续传；所有文件操作仍经 cap-std 限定在服务工作目录内；
//! - 每个分片携带 SHA-256，服务端校验后才记为已收到，传输损坏会被拒收并由客户端重传；
//! - 会话绑定用户与服务，只有创建者能继续；24 小时未活动的会话自动清理；
//! - 单文件上限 512 MiB；单用户同时进行的会话数有上限，防止占满磁盘。

use std::collections::BTreeSet;
use std::io::{self, Write};
use std::path::{Path as StdPath, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::{Extension, Json};
use cap_std::fs::{Dir, OpenOptions};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use super::files::{
    blocking, check_upload_target, display_path, finish_upload, io_error, normalize_rel, not_found,
    open_service_root, too_large, validate_name, FileEntry, FileError, MAX_TRANSFER_BYTES,
};
use crate::app::middleware::AuthInfo;
use crate::app::{ApiError, AppState};

/// 默认分片大小 8 MiB；客户端可在 [1 MiB, 16 MiB] 内指定
pub const DEFAULT_CHUNK_BYTES: u64 = 8 * 1024 * 1024;
pub const MIN_CHUNK_BYTES: u64 = 1024 * 1024;
pub const MAX_CHUNK_BYTES: u64 = 16 * 1024 * 1024;
/// 会话闲置过期时间
const SESSION_TTL_SECS: i64 = 24 * 3600;
/// 单个用户同时进行的上传会话上限
const MAX_SESSIONS_PER_USER: usize = 32;

/// 会话元数据（持久化）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct UploadSession {
    id: String,
    service_id: String,
    /// 创建者（TokenClaims.sub）
    owner: String,
    /// 目标相对路径
    path: String,
    size: u64,
    chunk_size: u64,
    overwrite: bool,
    /// 客户端指纹（文件名 + 大小 + 修改时间等），用于刷新页面后找回会话
    #[serde(default)]
    fingerprint: Option<String>,
    /// 整个文件的 SHA-256（可选，complete 时校验）
    #[serde(default)]
    sha256: Option<String>,
    received: BTreeSet<u64>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl UploadSession {
    fn total_chunks(&self) -> u64 {
        if self.size == 0 {
            1
        } else {
            self.size.div_ceil(self.chunk_size)
        }
    }

    fn chunk_len(&self, index: u64) -> u64 {
        if self.size == 0 {
            return 0;
        }
        let start = index * self.chunk_size;
        self.chunk_size.min(self.size - start)
    }

    fn part_path(&self) -> PathBuf {
        let target = PathBuf::from(&self.path);
        let parent = target.parent().map(PathBuf::from).unwrap_or_default();
        let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        parent.join(format!(".{name}.hc-{}.part", self.id))
    }

    fn expired(&self, now: DateTime<Utc>) -> bool {
        (now - self.updated_at).num_seconds() > SESSION_TTL_SECS
    }

    fn status(&self) -> UploadStatus {
        UploadStatus {
            upload_id: self.id.clone(),
            path: self.path.clone(),
            size: self.size,
            chunk_size: self.chunk_size,
            total_chunks: self.total_chunks(),
            received: self.received.iter().copied().collect(),
            received_bytes: self.received.iter().map(|&i| self.chunk_len(i)).sum(),
            expires_at: self.updated_at + chrono::Duration::seconds(SESSION_TTL_SECS),
        }
    }
}

/// 会话存储：JSON 文件 + 进程内锁（同一会话的元数据更新串行化）
pub struct UploadStore {
    dir: PathBuf,
    lock: Mutex<()>,
}

impl UploadStore {
    pub fn new(data_dir: &StdPath) -> Self {
        Self {
            dir: data_dir.join("file-uploads"),
            lock: Mutex::new(()),
        }
    }

    fn meta_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }

    fn load(&self, id: &str) -> Option<UploadSession> {
        let data = std::fs::read(self.meta_path(id)).ok()?;
        serde_json::from_slice(&data).ok()
    }

    fn save(&self, s: &UploadSession) -> io::Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        let tmp = self.dir.join(format!(".{}.json.tmp", s.id));
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(&serde_json::to_vec(s).map_err(io::Error::other)?)?;
        f.sync_all()?;
        std::fs::rename(tmp, self.meta_path(&s.id))
    }

    fn remove(&self, id: &str) {
        let _ = std::fs::remove_file(self.meta_path(id));
    }

    fn all(&self) -> Vec<UploadSession> {
        let Ok(rd) = std::fs::read_dir(&self.dir) else { return vec![] };
        rd.filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| serde_json::from_slice(&std::fs::read(e.path()).ok()?).ok())
            .collect()
    }
}

// ==================== 请求 / 响应 ====================

#[derive(Debug, Deserialize)]
pub struct InitUploadRequest {
    /// 目标目录（相对工作目录）
    #[serde(default)]
    pub dir: String,
    pub name: String,
    pub size: u64,
    #[serde(default)]
    pub chunk_size: Option<u64>,
    #[serde(default)]
    pub overwrite: bool,
    /// 用于找回同一文件未完成会话的客户端指纹
    #[serde(default)]
    pub fingerprint: Option<String>,
    /// 整个文件的 SHA-256（十六进制，可选）
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UploadStatus {
    pub upload_id: String,
    pub path: String,
    pub size: u64,
    pub chunk_size: u64,
    pub total_chunks: u64,
    /// 已收到的分片序号
    pub received: Vec<u64>,
    pub received_bytes: u64,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct InitUploadResponse {
    #[serde(flatten)]
    pub status: UploadStatus,
    /// 是否找回了已有会话（断点续传）
    pub resumed: bool,
}

#[derive(Debug, Deserialize, Default)]
pub struct CompleteUploadRequest {
    /// 覆盖创建时的 overwrite（例如用户在完成前确认覆盖）
    #[serde(default)]
    pub overwrite: Option<bool>,
}

// ==================== 内部工具 ====================

fn is_hex_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// 读取会话并校验归属（服务 + 用户），过期视为不存在
fn load_owned(store: &UploadStore, uid: &str, service_id: &str, auth: &AuthInfo) -> Result<UploadSession, ApiError> {
    // uid 只允许 uuid 字符，防止拼接出越界路径
    if uid.is_empty() || uid.len() > 64 || !uid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(ApiError::bad_request("无效的上传会话"));
    }
    let s = store
        .load(uid)
        .filter(|s| s.service_id == service_id && s.owner == auth.claims.sub && !s.expired(Utc::now()))
        .ok_or_else(|| not_found("上传会话不存在或已过期"))?;
    Ok(s)
}

/// 清理过期会话（删除元数据与对应 .part）
async fn sweep_expired(state: &AppState) {
    let store = state.uploads.clone();
    let now = Utc::now();
    let expired: Vec<UploadSession> = {
        let _g = store.lock.lock().await;
        store.all().into_iter().filter(|s| s.expired(now)).collect()
    };
    for s in expired {
        if let Ok(root) = open_service_root(state, &s.service_id).await {
            let part = s.part_path();
            let _ = tokio::task::spawn_blocking(move || root.remove_file(part)).await;
        }
        store.remove(&s.id);
        tracing::info!(upload_id = %s.id, path = %s.path, "expired upload session removed");
    }
}

/// 后台定时清理任务
pub fn spawn_upload_janitor(state: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(3600));
        loop {
            tick.tick().await;
            sweep_expired(&state).await;
        }
    });
}

fn create_part_file(root: &Dir, part: &StdPath, size: u64) -> io::Result<()> {
    let mut opts = OpenOptions::new();
    opts.write(true).create(true);
    let f = root.open_with(part, &opts)?;
    // 预分配逻辑大小，后续按偏移写入；完成时再次 set_len 保证精确
    f.set_len(size)
}

fn write_chunk(root: &Dir, part: &StdPath, offset: u64, data: &[u8]) -> io::Result<()> {
    let mut opts = OpenOptions::new();
    opts.write(true);
    let f = root.open_with(part, &opts)?.into_std();
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileExt;
        f.write_all_at(data, offset)?;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileExt;
        let mut written = 0usize;
        while written < data.len() {
            let n = f.seek_write(&data[written..], offset + written as u64)?;
            if n == 0 {
                return Err(io::Error::new(io::ErrorKind::WriteZero, "write zero"));
            }
            written += n;
        }
    }
    f.sync_data()
}

fn sha256_of_file(root: &Dir, part: &StdPath) -> io::Result<String> {
    let mut f = root.open(part)?.into_std();
    let mut hasher = Sha256::new();
    io::copy(&mut f, &mut hasher)?;
    Ok(hex::encode(hasher.finalize()))
}

// ==================== HTTP handlers ====================

/// POST /services/:id/files/uploads —— 创建或找回上传会话
pub async fn init_upload(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path(id): Path<String>,
    Json(req): Json<InitUploadRequest>,
) -> Result<Json<InitUploadResponse>, FileError> {
    auth.require_files_write(&id)?;
    if req.size > MAX_TRANSFER_BYTES {
        return Err(too_large(format!("文件超过 {} MiB", MAX_TRANSFER_BYTES / 1024 / 1024)).into());
    }
    let name = req.name.trim().to_string();
    validate_name(&name)?;
    let dir = normalize_rel(&req.dir)?;
    let target = dir.join(&name);
    let path = display_path(&target);
    let chunk_size = req
        .chunk_size
        .unwrap_or(DEFAULT_CHUNK_BYTES)
        .clamp(MIN_CHUNK_BYTES, MAX_CHUNK_BYTES);
    if let Some(h) = &req.sha256 {
        if !is_hex_sha256(h) {
            return Err(ApiError::bad_request("sha256 格式不正确").into());
        }
    }
    let fingerprint = req.fingerprint.as_ref().map(|f| f.chars().take(256).collect::<String>());

    let store = state.uploads.clone();
    let root = Arc::new(open_service_root(&state, &id).await?);

    // 1) 找回：同一用户、同一服务、同一目标、同一大小与指纹的未过期会话
    {
        let _g = store.lock.lock().await;
        let now = Utc::now();
        let existing = store.all().into_iter().find(|s| {
            s.service_id == id
                && s.owner == auth.claims.sub
                && s.path == path
                && s.size == req.size
                && s.fingerprint.is_some()
                && s.fingerprint == fingerprint
                && !s.expired(now)
        });
        if let Some(mut s) = existing {
            let part = s.part_path();
            let r = root.clone();
            let part_ok = blocking(move || Ok(r.metadata(&part).map(|m| m.is_file()).unwrap_or(false))).await?;
            if part_ok {
                s.overwrite = req.overwrite || s.overwrite;
                s.updated_at = now;
                store.save(&s).map_err(|e| io_error(e, &path))?;
                return Ok(Json(InitUploadResponse { status: s.status(), resumed: true }));
            }
            // .part 已丢失：作废旧会话，下面新建
            store.remove(&s.id);
        }
        let active = store.all().into_iter().filter(|s| s.owner == auth.claims.sub && !s.expired(now)).count();
        if active >= MAX_SESSIONS_PER_USER {
            return Err(ApiError::too_many_requests("进行中的上传过多，请先完成或取消部分上传").into());
        }
    }

    // 2) 新建：校验目标并创建 .part
    let now = Utc::now();
    let session = UploadSession {
        id: uuid::Uuid::new_v4().to_string(),
        service_id: id.clone(),
        owner: auth.claims.sub.clone(),
        path: path.clone(),
        size: req.size,
        chunk_size,
        overwrite: req.overwrite,
        fingerprint,
        sha256: req.sha256.map(|h| h.to_ascii_lowercase()),
        received: BTreeSet::new(),
        created_at: now,
        updated_at: now,
    };
    {
        let (r, t, part, size, ow) = (root.clone(), target.clone(), session.part_path(), session.size, req.overwrite);
        let shown = path.clone();
        blocking(move || {
            check_upload_target(&r, &t, ow)?;
            create_part_file(&r, &part, size).map_err(|e| io_error(e, &shown))?;
            Ok(())
        })
        .await?;
    }
    store.save(&session).map_err(|e| io_error(e, &path))?;
    tracing::info!(service_id = %id, upload_id = %session.id, path = %path, size = session.size, user = %auth.claims.sub, "upload session created");
    Ok(Json(InitUploadResponse { status: session.status(), resumed: false }))
}

/// GET /services/:id/files/uploads/:uid —— 查询进度
pub async fn upload_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path((id, uid)): Path<(String, String)>,
) -> Result<Json<UploadStatus>, FileError> {
    auth.require_files_write(&id)?;
    let s = load_owned(&state.uploads, &uid, &id, &auth)?;
    Ok(Json(s.status()))
}

/// PUT /services/:id/files/uploads/:uid/chunks/:index —— 上传一个分片
/// 请求头 `X-Chunk-Sha256` 为该分片的 SHA-256（必填）。
pub async fn upload_chunk(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path((id, uid, index)): Path<(String, String, u64)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<UploadStatus>, FileError> {
    auth.require_files_write(&id)?;
    let session = load_owned(&state.uploads, &uid, &id, &auth)?;
    if index >= session.total_chunks() {
        return Err(ApiError::bad_request(format!("分片序号越界: {index}")).into());
    }
    let expected_len = session.chunk_len(index);
    if body.len() as u64 != expected_len {
        return Err(ApiError::bad_request(format!(
            "分片 {index} 大小不符：期望 {expected_len} 字节，实际 {} 字节",
            body.len()
        ))
        .into());
    }
    let declared = headers
        .get("x-chunk-sha256")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| is_hex_sha256(v))
        .ok_or_else(|| ApiError::bad_request("缺少或无效的 X-Chunk-Sha256"))?;
    let actual = hex::encode(Sha256::digest(&body));
    if actual != declared {
        return Err(ApiError::new("ChunkChecksumMismatch", StatusCode::UNPROCESSABLE_ENTITY, format!("分片 {index} 校验失败，请重传")).into());
    }

    let root = open_service_root(&state, &id).await?;
    let part = session.part_path();
    let offset = index * session.chunk_size;
    let shown = session.path.clone();
    blocking(move || write_chunk(&root, &part, offset, &body).map_err(|e| io_error(e, &shown).into())).await?;

    // 写入成功后再记账（并发分片串行更新元数据）
    let store = state.uploads.clone();
    let _g = store.lock.lock().await;
    let mut s = load_owned(&store, &uid, &id, &auth)?;
    s.received.insert(index);
    s.updated_at = Utc::now();
    store.save(&s).map_err(|e| io_error(e, &s.path))?;
    Ok(Json(s.status()))
}

/// POST /services/:id/files/uploads/:uid/complete —— 所有分片齐全后原子落盘
pub async fn complete_upload(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path((id, uid)): Path<(String, String)>,
    body: Option<Json<CompleteUploadRequest>>,
) -> Result<Json<FileEntry>, FileError> {
    auth.require_files_write(&id)?;
    let req = body.map(|b| b.0).unwrap_or_default();
    let store = state.uploads.clone();
    let session = {
        let _g = store.lock.lock().await;
        load_owned(&store, &uid, &id, &auth)?
    };
    let total = session.total_chunks();
    let missing: Vec<u64> = (0..total).filter(|i| !session.received.contains(i)).take(20).collect();
    if !missing.is_empty() {
        return Err(ApiError::new(
            "UploadIncomplete",
            StatusCode::CONFLICT,
            format!("还有分片未上传: {:?}", missing),
        )
        .into());
    }

    let root = Arc::new(open_service_root(&state, &id).await?);
    let part = session.part_path();
    let target = PathBuf::from(&session.path);
    let overwrite = req.overwrite.unwrap_or(session.overwrite);
    let (size, expect_sha, shown) = (session.size, session.sha256.clone(), session.path.clone());
    let r = root.clone();
    let result = blocking(move || {
        let meta = r.metadata(&part).map_err(|e| io_error(e, &shown))?;
        if meta.len() != size {
            r.open_with(&part, OpenOptions::new().write(true))
                .and_then(|f| f.set_len(size))
                .map_err(|e| io_error(e, &shown))?;
        }
        if let Some(expect) = expect_sha {
            let got = sha256_of_file(&r, &part).map_err(|e| io_error(e, &shown))?;
            if got != expect {
                return Err(ApiError::new("FileChecksumMismatch", StatusCode::UNPROCESSABLE_ENTITY, "文件整体校验失败，请重新上传").into());
            }
        }
        // finish_upload 在冲突时会删除 .part；这里先确认目标，冲突则保留 .part 以便用户确认覆盖后重试
        check_upload_target(&r, &target, overwrite)?;
        finish_upload(&r, &part, &target, overwrite)
    })
    .await;

    match &result {
        Ok(entry) => {
            let _g = store.lock.lock().await;
            store.remove(&uid);
            tracing::info!(service_id = %id, upload_id = %uid, path = %entry.path, size = entry.size, user = %auth.claims.sub, "chunked upload completed");
        }
        Err(FileError::Api(e)) if e.status() == StatusCode::UNPROCESSABLE_ENTITY => {
            // 整体校验失败：内容已不可信，作废会话
            let part = session.part_path();
            let _ = tokio::task::spawn_blocking(move || root.remove_file(part)).await;
            let _g = store.lock.lock().await;
            store.remove(&uid);
        }
        Err(_) => {}
    }
    result.map(Json)
}

/// DELETE /services/:id/files/uploads/:uid —— 取消上传
pub async fn abort_upload(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthInfo>,
    Path((id, uid)): Path<(String, String)>,
) -> Result<StatusCode, FileError> {
    auth.require_files_write(&id)?;
    let store = state.uploads.clone();
    let session = {
        let _g = store.lock.lock().await;
        let s = load_owned(&store, &uid, &id, &auth)?;
        store.remove(&uid);
        s
    };
    if let Ok(root) = open_service_root(&state, &id).await {
        let part = session.part_path();
        let _ = tokio::task::spawn_blocking(move || root.remove_file(part)).await;
    }
    tracing::info!(service_id = %id, upload_id = %uid, user = %auth.claims.sub, "upload session aborted");
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cap_std::ambient_authority;

    fn session(size: u64, chunk: u64) -> UploadSession {
        UploadSession {
            id: "u1".into(),
            service_id: "s".into(),
            owner: "o".into(),
            path: "plugins/a.jar".into(),
            size,
            chunk_size: chunk,
            overwrite: false,
            fingerprint: None,
            sha256: None,
            received: BTreeSet::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn chunk_math() {
        let s = session(10, 4);
        assert_eq!(s.total_chunks(), 3);
        assert_eq!((s.chunk_len(0), s.chunk_len(1), s.chunk_len(2)), (4, 4, 2));
        let s = session(8, 4);
        assert_eq!(s.total_chunks(), 2);
        assert_eq!(s.chunk_len(1), 4);
        // 空文件：一个长度为 0 的分片
        let s = session(0, 4);
        assert_eq!(s.total_chunks(), 1);
        assert_eq!(s.chunk_len(0), 0);
        assert_eq!(session(5, 4).part_path(), PathBuf::from("plugins/.a.jar.hc-u1.part"));
    }

    #[test]
    fn out_of_order_chunks_assemble_correctly() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("plugins")).unwrap();
        let root = Dir::open_ambient_dir(tmp.path(), ambient_authority()).unwrap();
        let data: Vec<u8> = (0..10_000u32).map(|i| (i % 251) as u8).collect();
        let s = session(data.len() as u64, 4096);
        let part = s.part_path();
        create_part_file(&root, &part, s.size).unwrap();
        // 乱序 + 重复写同一分片
        for &i in &[2u64, 0, 1, 0] {
            let start = (i * s.chunk_size) as usize;
            let end = start + s.chunk_len(i) as usize;
            write_chunk(&root, &part, start as u64, &data[start..end]).unwrap();
        }
        assert_eq!(sha256_of_file(&root, &part).unwrap(), hex::encode(Sha256::digest(&data)));
        let e = finish_upload(&root, &part, StdPath::new("plugins/a.jar"), false).unwrap();
        assert_eq!(e.size, data.len() as u64);
        assert_eq!(std::fs::read(tmp.path().join("plugins/a.jar")).unwrap(), data);
        assert!(!tmp.path().join("plugins/.a.jar.hc-u1.part").exists());
    }

    #[test]
    fn store_roundtrip_and_expiry() {
        let tmp = tempfile::tempdir().unwrap();
        let store = UploadStore::new(tmp.path());
        let mut s = session(10, 4);
        s.received.insert(1);
        store.save(&s).unwrap();
        let back = store.load("u1").unwrap();
        assert_eq!(back.received, s.received);
        assert_eq!(store.all().len(), 1);
        assert!(!back.expired(Utc::now()));
        assert!(back.expired(Utc::now() + chrono::Duration::seconds(SESSION_TTL_SECS + 1)));
        store.remove("u1");
        assert!(store.load("u1").is_none());
    }

    #[test]
    fn sha_hex_validation() {
        assert!(is_hex_sha256(&"a".repeat(64)));
        assert!(!is_hex_sha256(&"g".repeat(64)));
        assert!(!is_hex_sha256("abc"));
    }
}
