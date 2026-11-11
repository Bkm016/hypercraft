//! 运行环境安装器（基于内嵌 mise）：支持 mise registry 中的任意工具（java / node / python / go / bun …）。
//!
//! - mise 数据目录隔离在 `<data_dir>/mise`，不影响宿主机上的 mise
//! - 下载源通过 mise `url_replacements` 改写：Temurin 走清华 / 中科大，Node / Python / Go 走国内镜像，
//!   其余 GitHub Release 可走代理；mise 仍按上游校验和校验
//! - 安装任务后台执行，阶段与日志保存在内存中供前端轮询；支持取消、清理已结束任务与下载缓存

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use hypercraft_core::runtime::{
    adoptium_arch, dir_size, java_binary_in, parse_major, probe_java, validate_runtime_id,
    validate_tool_name,
};
use hypercraft_core::{JavaRuntime, RuntimeRegistry, RuntimeSource};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{Mutex, RwLock};

/// Java 发行版（mise 中的版本前缀），按推荐顺序
const JAVA_VENDORS: &[(&str, &str, &str)] = &[
    ("temurin-jre", "Eclipse Temurin", "jre"),
    ("temurin", "Eclipse Temurin", "jdk"),
    ("zulu-jre", "Azul Zulu", "jre"),
    ("zulu", "Azul Zulu", "jdk"),
    ("corretto", "Amazon Corretto", "jdk"),
    ("dragonwell", "Alibaba Dragonwell", "jdk"),
    ("kona", "Tencent Kona", "jdk"),
    ("liberica-jre", "BellSoft Liberica", "jre"),
    ("liberica", "BellSoft Liberica", "jdk"),
    ("graalvm-community", "GraalVM Community", "jdk"),
    ("semeru-jre-openj9", "IBM Semeru (OpenJ9)", "jre"),
    ("microsoft", "Microsoft OpenJDK", "jdk"),
    ("sapmachine-jre", "SapMachine", "jre"),
];

/// Java 常用主版本（Minecraft：1.16.5 及以下 8，1.17–1.20.4 用 17，1.20.5+ 用 21）
const JAVA_COMMON_MAJORS: &[u32] = &[8, 11, 17, 21, 25];

/// 面板中置顶推荐的工具
pub const FEATURED_TOOLS: &[(&str, &str)] = &[
    ("java", "Java"),
    ("node", "Node.js"),
    ("python", "Python"),
    ("go", "Go"),
    ("bun", "Bun"),
    ("deno", "Deno"),
    ("maven", "Maven"),
    ("gradle", "Gradle"),
    ("rust", "Rust"),
    ("ruby", "Ruby"),
    ("php", "PHP"),
    ("dotnet", ".NET"),
];

fn tool_display(tool: &str) -> String {
    FEATURED_TOOLS
        .iter()
        .find(|(t, _)| *t == tool)
        .map(|(_, n)| n.to_string())
        .unwrap_or_else(|| tool.to_string())
}

// ============================================================================
// 下载源
// ============================================================================

/// 下载源配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DownloadSettings {
    /// Temurin（Adoptium）镜像：official / tuna / ustc
    #[serde(default = "default_mirror")]
    pub adoptium_mirror: String,
    /// GitHub Release 代理前缀，如 https://ghfast.top/ ；空为直连
    #[serde(default)]
    pub github_proxy: String,
    /// Node.js / Python / Go 等使用国内镜像（npmmirror / golang.google.cn）
    #[serde(default)]
    pub cn_mirrors: bool,
}

fn default_mirror() -> String {
    "official".into()
}

impl DownloadSettings {
    fn from_env() -> Self {
        let mirror = std::env::var("HC_JAVA_MIRROR")
            .ok()
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(default_mirror);
        let proxy = std::env::var("HC_GITHUB_PROXY").unwrap_or_default();
        // 未显式配置时：Temurin 走国内镜像即视为国内环境
        // 空值（如 1Panel 升级后未填写的新参数）视为未配置，按 Temurin 镜像推断
        let cn = std::env::var("HC_CN_MIRRORS")
            .ok()
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .map(|s| matches!(s.as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(mirror != "official");
        Self::normalized(mirror, proxy, cn).unwrap_or(Self {
            adoptium_mirror: default_mirror(),
            github_proxy: String::new(),
            cn_mirrors: false,
        })
    }

    pub fn normalized(mirror: String, proxy: String, cn_mirrors: bool) -> Result<Self, String> {
        let mirror = mirror.trim().to_ascii_lowercase();
        if !matches!(mirror.as_str(), "official" | "tuna" | "ustc") {
            return Err("adoptium_mirror 仅支持 official / tuna / ustc".into());
        }
        let mut proxy = proxy.trim().to_string();
        if !proxy.is_empty() {
            if !(proxy.starts_with("https://") || proxy.starts_with("http://"))
                || proxy.contains(['"', '\'', '\\', '\n', ' '])
            {
                return Err("github_proxy 必须是 http(s) 地址".into());
            }
            if !proxy.ends_with('/') {
                proxy.push('/');
            }
        }
        Ok(Self {
            adoptium_mirror: mirror,
            github_proxy: proxy,
            cn_mirrors,
        })
    }

    /// 生成 mise 配置（TOML）。规则按顺序匹配，首条命中生效，因此具体镜像规则在通用 GitHub 代理之前
    fn to_mise_toml(&self) -> String {
        let mut rules: Vec<(String, String)> = Vec::new();
        match self.adoptium_mirror.as_str() {
            // 清华：/Adoptium/<major>/<jre|jdk>/<arch>/<os>/<file>
            "tuna" => rules.push((
                r"regex:^https://github\.com/adoptium/temurin(\d+)-binaries/releases/download/[^/]+/(OpenJDK\d+U-(jre|jdk)_(x64|aarch64|arm|ppc64le|s390x)_(linux|mac|windows|alpine-linux)_hotspot_.+)$".into(),
                "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/$1/$3/$4/$5/$2".into(),
            )),
            // 中科大：与 GitHub 路径一致
            "ustc" => rules.push((
                r"regex:^https://github\.com/adoptium/(temurin\d+-binaries)/releases/download/(.+)$".into(),
                "https://mirrors.ustc.edu.cn/adoptium/releases/$1/$2".into(),
            )),
            _ => {}
        }
        if self.cn_mirrors {
            rules.push((r"regex:^https://nodejs\.org/dist/(.+)$".into(), "https://npmmirror.com/mirrors/node/$1".into()));
            rules.push((
                r"regex:^https://(?:go\.dev/dl|dl\.google\.com/go)/(.+)$".into(),
                "https://golang.google.cn/dl/$1".into(),
            ));
            rules.push((
                r"regex:^https://github\.com/(?:astral-sh|indygreg)/python-build-standalone/releases/download/(.+)$".into(),
                "https://registry.npmmirror.com/-/binary/python-build-standalone/$1".into(),
            ));
        }
        if !self.github_proxy.is_empty() {
            rules.push((r"regex:^(https://github\.com/.+)$".into(), format!("{}$1", self.github_proxy)));
        }
        let mut s = String::from(
            "# 由 Hypercraft 生成，请在面板「环境 → 下载源」中修改\n[settings]\nexperimental = true\n",
        );
        if !rules.is_empty() {
            s.push_str("\n[settings.url_replacements]\n");
            for (k, v) in rules {
                s.push_str(&format!("{} = {}\n", toml_str(&k), toml_str(&v)));
            }
        }
        s
    }
}

fn toml_str(s: &str) -> String {
    format!("'{}'", s.replace('\'', ""))
}

// ============================================================================
// 数据结构
// ============================================================================

/// Java 可安装版本
#[derive(Debug, Clone, Serialize)]
pub struct JavaCatalogItem {
    pub spec: String,
    pub vendor_key: String,
    pub vendor: String,
    pub image_type: String,
    pub major: u32,
    pub latest: String,
    pub common: bool,
    pub installed_id: Option<String>,
    pub installed_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct JavaCatalog {
    pub arch: String,
    pub mise_version: String,
    pub settings: DownloadSettings,
    pub items: Vec<JavaCatalogItem>,
}

/// mise registry 中的工具
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryTool {
    #[serde(alias = "short")]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub backends: Vec<String>,
    #[serde(default)]
    pub bins: Vec<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolListResponse {
    pub featured: Vec<RegistryTool>,
    pub tools: Vec<RegistryTool>,
}

/// 某工具的可用版本（新到旧）
#[derive(Debug, Clone, Serialize)]
pub struct ToolVersions {
    pub tool: String,
    /// 推荐的版本前缀（如 node: ["24","22","20"]）
    pub channels: Vec<String>,
    pub versions: Vec<String>,
}

/// 安装请求
#[derive(Debug, Clone, Deserialize)]
pub struct InstallRequest {
    /// mise 工具名，缺省 java
    #[serde(default)]
    pub tool: Option<String>,
    /// 版本前缀或完整版本，如 temurin-jre-21 / 22 / 3.12 / latest
    pub spec: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InstallState {
    Pending,
    Resolving,
    Downloading,
    Extracting,
    Done,
    Failed,
    Cancelled,
}

impl InstallState {
    pub fn is_finished(&self) -> bool {
        matches!(self, Self::Done | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallTask {
    pub id: String,
    pub tool: String,
    pub runtime_id: String,
    pub spec: String,
    pub state: InstallState,
    pub source_url: Option<String>,
    pub message: Option<String>,
    /// 最近的 mise 输出
    pub log: Vec<String>,
    pub started_at: chrono::DateTime<Utc>,
    pub finished_at: Option<chrono::DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
struct MiseLsEntry {
    version: String,
    install_path: String,
    #[serde(default)]
    installed: bool,
}

/// 磁盘占用
#[derive(Debug, Clone, Serialize)]
pub struct StorageUsage {
    pub installs_bytes: u64,
    pub cache_bytes: u64,
    /// 未被任何运行环境引用的 mise 安装（可清理）
    pub orphans: Vec<OrphanInstall>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrphanInstall {
    pub tool: String,
    pub version: String,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CleanupResult {
    pub removed_tasks: usize,
    pub freed_cache_bytes: u64,
    pub removed_orphans: Vec<String>,
    pub freed_orphan_bytes: u64,
}

// ============================================================================
// 安装器
// ============================================================================

#[derive(Clone)]
pub struct RuntimeInstaller {
    mise_bin: PathBuf,
    mise_root: PathBuf,
    registry: RuntimeRegistry,
    settings_path: PathBuf,
    settings: Arc<RwLock<DownloadSettings>>,
    tasks: Arc<RwLock<HashMap<String, InstallTask>>>,
    /// 运行中任务的取消信号
    cancels: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>>,
    /// 串行化 mise 安装 / 卸载，避免并发踩缓存
    mise_lock: Arc<Mutex<()>>,
    remote_cache: Arc<RwLock<HashMap<String, (std::time::Instant, Vec<String>)>>>,
    registry_cache: Arc<RwLock<Option<(std::time::Instant, Vec<RegistryTool>)>>>,
}

impl RuntimeInstaller {
    pub fn new(data_dir: &Path, registry: RuntimeRegistry) -> anyhow::Result<Self> {
        let mise_bin = std::env::var_os("HC_MISE_BIN")
            .map(PathBuf::from)
            .or_else(|| find_in_path("mise"))
            .unwrap_or_else(|| PathBuf::from("mise"));
        let mise_root = data_dir.join("mise");
        for sub in ["data", "cache", "config", "state"] {
            std::fs::create_dir_all(mise_root.join(sub))?;
        }
        std::fs::create_dir_all(registry.base())?;
        let settings_path = registry.base().join("download-settings.json");
        let env_path = registry.base().join("download-settings.env.json");
        // 兼容 0.2.0：旧配置位于 runtimes/java/
        for name in ["download-settings.json", "download-settings.env.json"] {
            let old = registry.root().join(name);
            let new = registry.base().join(name);
            if old.exists() && !new.exists() {
                let _ = std::fs::rename(&old, &new);
            }
        }
        // 环境变量（如 1Panel 参数）变化时以环境变量为准，否则沿用面板中保存的配置
        let from_env = DownloadSettings::from_env();
        let last_env = std::fs::read(&env_path)
            .ok()
            .and_then(|d| serde_json::from_slice::<DownloadSettings>(&d).ok());
        let saved = std::fs::read(&settings_path)
            .ok()
            .and_then(|d| serde_json::from_slice::<DownloadSettings>(&d).ok())
            .and_then(|s| DownloadSettings::normalized(s.adoptium_mirror, s.github_proxy, s.cn_mirrors).ok());
        let settings = match saved {
            Some(s) if last_env.as_ref() == Some(&from_env) => s,
            _ => from_env.clone(),
        };
        if let Ok(data) = serde_json::to_vec_pretty(&from_env) {
            let _ = std::fs::write(&env_path, data);
        }
        let this = Self {
            mise_bin,
            mise_root,
            registry,
            settings_path,
            settings: Arc::new(RwLock::new(settings.clone())),
            tasks: Arc::new(RwLock::new(HashMap::new())),
            cancels: Arc::new(Mutex::new(HashMap::new())),
            mise_lock: Arc::new(Mutex::new(())),
            remote_cache: Arc::new(RwLock::new(HashMap::new())),
            registry_cache: Arc::new(RwLock::new(None)),
        };
        this.write_mise_config(&settings)?;
        this.cleanup_interrupted();
        Ok(this)
    }

    pub fn registry(&self) -> &RuntimeRegistry {
        &self.registry
    }

    fn write_mise_config(&self, settings: &DownloadSettings) -> std::io::Result<()> {
        std::fs::write(self.mise_root.join("config").join("config.toml"), settings.to_mise_toml())
    }

    /// 启动时清理上次中断的下载临时文件
    fn cleanup_interrupted(&self) {
        let _ = std::fs::remove_dir_all(self.mise_root.join("cache").join("invocation-downloads"));
    }

    pub async fn settings(&self) -> DownloadSettings {
        self.settings.read().await.clone()
    }

    pub async fn update_settings(&self, req: DownloadSettings) -> Result<DownloadSettings, String> {
        let s = DownloadSettings::normalized(req.adoptium_mirror, req.github_proxy, req.cn_mirrors)?;
        self.write_mise_config(&s).map_err(|e| e.to_string())?;
        std::fs::write(&self.settings_path, serde_json::to_vec_pretty(&s).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        *self.settings.write().await = s.clone();
        Ok(s)
    }

    fn mise(&self) -> Command {
        let mut cmd = Command::new(&self.mise_bin);
        let r = &self.mise_root;
        cmd.env("MISE_DATA_DIR", r.join("data"))
            .env("MISE_CACHE_DIR", r.join("cache"))
            .env("MISE_CONFIG_DIR", r.join("config"))
            .env("MISE_STATE_DIR", r.join("state"))
            .env("MISE_GLOBAL_CONFIG_FILE", r.join("config").join("config.toml"))
            .env("MISE_YES", "1")
            .env("MISE_COLOR", "0")
            .env("NO_COLOR", "1")
            .env("MISE_LOG_FILE_LEVEL", "off")
            .current_dir(r)
            .stdin(Stdio::null())
            .kill_on_drop(true);
        cmd
    }

    async fn mise_output(&self, args: &[&str], timeout: Duration) -> Result<String, String> {
        let fut = self.mise().args(args).output();
        let out = tokio::time::timeout(timeout, fut)
            .await
            .map_err(|_| format!("mise {} 超时", args.join(" ")))?
            .map_err(|e| format!("无法执行 mise（{}）：{e}", self.mise_bin.display()))?;
        if !out.status.success() {
            let err = strip_ansi(&String::from_utf8_lossy(&out.stderr));
            return Err(format!("mise {} 失败：{}", args.join(" "), last_lines(&err, 3)));
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    pub async fn mise_version(&self) -> String {
        self.mise_output(&["--version"], Duration::from_secs(10))
            .await
            .map(|s| s.split_whitespace().next().unwrap_or_default().to_string())
            .unwrap_or_else(|e| format!("unavailable: {e}"))
    }

    // ------------------------------------------------------------------
    // 工具与版本
    // ------------------------------------------------------------------

    /// mise registry 全量工具（缓存 6 小时）
    pub async fn tools(&self) -> Result<ToolListResponse, String> {
        let list = {
            let cached = self.registry_cache.read().await.clone();
            match cached {
                Some((at, list)) if at.elapsed() < Duration::from_secs(6 * 3600) => list,
                _ => {
                    let out = self.mise_output(&["registry", "-J"], Duration::from_secs(60)).await?;
                    let list: Vec<RegistryTool> =
                        serde_json::from_str(&out).map_err(|e| format!("解析 mise registry 失败: {e}"))?;
                    *self.registry_cache.write().await = Some((std::time::Instant::now(), list.clone()));
                    list
                }
            }
        };
        let featured = FEATURED_TOOLS
            .iter()
            .filter_map(|(t, _)| list.iter().find(|x| x.name == *t).cloned())
            .collect();
        Ok(ToolListResponse { featured, tools: list })
    }

    async fn remote_versions(&self, tool: &str, refresh: bool) -> Result<Vec<String>, String> {
        validate_tool_name(tool).map_err(|e| e.to_string())?;
        if !refresh {
            if let Some((at, list)) = self.remote_cache.read().await.get(tool) {
                if at.elapsed() < Duration::from_secs(3600) {
                    return Ok(list.clone());
                }
            }
        }
        let out = self.mise_output(&["ls-remote", tool], Duration::from_secs(90)).await?;
        let list: Vec<String> = out.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
        self.remote_cache
            .write()
            .await
            .insert(tool.to_string(), (std::time::Instant::now(), list.clone()));
        Ok(list)
    }

    /// 某工具的可用版本：去除预发布，新到旧，最多 300 条；并给出推荐的版本通道
    pub async fn versions(&self, tool: &str, refresh: bool) -> Result<ToolVersions, String> {
        let all = self.remote_versions(tool, refresh).await?;
        let mut stable: Vec<String> = all
            .into_iter()
            .filter(|v| {
                let l = v.to_ascii_lowercase();
                !(l.contains("alpha") || l.contains("beta") || l.contains("-rc") || l.contains("dev") || l.contains("nightly"))
            })
            .collect();
        stable.reverse();
        // 推荐通道：按「主版本」（node/java）或「主.次」（python/go 等）取前若干个
        let mut channels: Vec<String> = Vec::new();
        for v in &stable {
            let digits: Vec<&str> = v.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).collect();
            let key = match (tool, digits.as_slice()) {
                ("node" | "java" | "deno" | "bun" | "dotnet", [m, ..]) => m.to_string(),
                (_, [m, n, ..]) => format!("{m}.{n}"),
                (_, [m]) => m.to_string(),
                _ => continue,
            };
            if !v.starts_with(|c: char| c.is_ascii_digit()) {
                continue;
            }
            if !channels.contains(&key) {
                channels.push(key);
            }
            if channels.len() >= 6 {
                break;
            }
        }
        stable.truncate(300);
        Ok(ToolVersions { tool: tool.to_string(), channels, versions: stable })
    }

    /// Java 专用目录：每个发行版 × 主版本取最新
    pub async fn java_catalog(&self, refresh: bool) -> Result<JavaCatalog, String> {
        let remote = self.remote_versions("java", refresh).await?;
        let installed = self.registry.list().unwrap_or_default();
        let mut latest: BTreeMap<(usize, u32), String> = BTreeMap::new();
        for v in &remote {
            let Some((idx, rest)) = JAVA_VENDORS
                .iter()
                .enumerate()
                .filter_map(|(i, (p, _, _))| v.strip_prefix(&format!("{p}-")).map(|r| (i, r)))
                .max_by_key(|(i, _)| JAVA_VENDORS[*i].0.len())
            else {
                continue;
            };
            if !rest.starts_with(|c: char| c.is_ascii_digit()) {
                continue;
            }
            let major = parse_major(rest);
            if major < 8 {
                continue;
            }
            latest.insert((idx, major), v.clone());
        }
        let mut items: Vec<JavaCatalogItem> = latest
            .into_iter()
            .map(|((idx, major), ver)| {
                let (prefix, vendor, image_type) = JAVA_VENDORS[idx];
                let spec = format!("{prefix}-{major}");
                let existing = installed.iter().find(|r| r.id == spec);
                JavaCatalogItem {
                    installed_id: existing.map(|r| r.id.clone()),
                    installed_version: existing.and_then(|r| r.mise_version.clone().or(Some(r.version.clone()))),
                    spec,
                    vendor_key: prefix.into(),
                    vendor: vendor.into(),
                    image_type: image_type.into(),
                    major,
                    latest: ver,
                    common: JAVA_COMMON_MAJORS.contains(&major),
                }
            })
            .collect();
        items.sort_by(|a, b| {
            b.major.cmp(&a.major).then_with(|| {
                let ia = JAVA_VENDORS.iter().position(|v| v.0 == a.vendor_key);
                let ib = JAVA_VENDORS.iter().position(|v| v.0 == b.vendor_key);
                ia.cmp(&ib)
            })
        });
        Ok(JavaCatalog {
            arch: adoptium_arch().unwrap_or_default().into(),
            mise_version: self.mise_version().await,
            settings: self.settings().await,
            items,
        })
    }

    // ------------------------------------------------------------------
    // 安装任务
    // ------------------------------------------------------------------

    pub async fn list_tasks(&self) -> Vec<InstallTask> {
        let mut v: Vec<_> = self.tasks.read().await.values().cloned().collect();
        v.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        v
    }

    pub async fn get_task(&self, id: &str) -> Option<InstallTask> {
        self.tasks.read().await.get(id).cloned()
    }

    /// 清理已结束的任务记录；返回清理数量
    pub async fn clear_finished_tasks(&self) -> usize {
        let mut tasks = self.tasks.write().await;
        let before = tasks.len();
        tasks.retain(|_, t| !t.state.is_finished());
        before - tasks.len()
    }

    /// 删除单个已结束任务记录
    pub async fn remove_task(&self, id: &str) -> Result<(), String> {
        let mut tasks = self.tasks.write().await;
        match tasks.get(id) {
            None => Err("任务不存在".into()),
            Some(t) if !t.state.is_finished() => Err("任务仍在进行中，请先取消".into()),
            Some(_) => {
                tasks.remove(id);
                Ok(())
            }
        }
    }

    /// 取消进行中的任务
    pub async fn cancel_task(&self, id: &str) -> Result<(), String> {
        let tx = self.cancels.lock().await.remove(id);
        match tx {
            Some(tx) => {
                let _ = tx.send(());
                Ok(())
            }
            None => match self.get_task(id).await {
                Some(t) if t.state == InstallState::Pending => {
                    self.update(id, |t| {
                        t.state = InstallState::Cancelled;
                        t.message = Some("已取消".into());
                        t.finished_at = Some(Utc::now());
                    })
                    .await;
                    Ok(())
                }
                Some(_) => Err("任务已结束".into()),
                None => Err("任务不存在".into()),
            },
        }
    }

    /// 提交安装任务（立即返回，后台执行）。同 ID 已存在时视为升级。
    pub async fn start_install(&self, req: InstallRequest) -> Result<InstallTask, String> {
        let tool = req.tool.clone().map(|t| t.trim().to_ascii_lowercase()).filter(|t| !t.is_empty()).unwrap_or_else(|| "java".into());
        validate_tool_name(&tool).map_err(|e| e.to_string())?;
        let spec = req.spec.trim().to_string();
        if spec.is_empty()
            || spec.len() > 96
            || !spec.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '+' | '_'))
        {
            return Err("无效的版本标识".into());
        }
        let runtime_id = req
            .id
            .clone()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| default_runtime_id(&tool, &spec));
        validate_runtime_id(&runtime_id).map_err(|e| e.to_string())?;
        if let Ok(existing) = self.registry.get(&runtime_id) {
            if existing.tool != tool {
                return Err(format!("运行环境 ID「{runtime_id}」已被 {} 使用", existing.tool));
            }
            if existing.source != RuntimeSource::Managed {
                return Err(format!("「{runtime_id}」不是托管安装，不能覆盖"));
            }
        }
        {
            let tasks = self.tasks.read().await;
            if tasks.values().any(|t| t.runtime_id == runtime_id && !t.state.is_finished()) {
                return Err(format!("{runtime_id} 正在安装中"));
            }
        }

        let task = InstallTask {
            id: uuid::Uuid::new_v4().to_string(),
            tool: tool.clone(),
            runtime_id: runtime_id.clone(),
            spec: spec.clone(),
            state: InstallState::Pending,
            source_url: None,
            message: None,
            log: Vec::new(),
            started_at: Utc::now(),
            finished_at: None,
        };
        {
            let mut tasks = self.tasks.write().await;
            // 仅保留最近 50 条已结束任务
            let mut finished: Vec<_> = tasks
                .values()
                .filter(|t| t.state.is_finished())
                .map(|t| (t.started_at, t.id.clone()))
                .collect();
            finished.sort();
            while finished.len() >= 50 {
                let (_, id) = finished.remove(0);
                tasks.remove(&id);
            }
            tasks.insert(task.id.clone(), task.clone());
        }

        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        self.cancels.lock().await.insert(task.id.clone(), cancel_tx);

        let this = self.clone();
        let task_id = task.id.clone();
        tokio::spawn(async move {
            let result = this.run_install(&task_id, &tool, &runtime_id, &spec, req.name, cancel_rx).await;
            this.cancels.lock().await.remove(&task_id);
            let mut tasks = this.tasks.write().await;
            if let Some(t) = tasks.get_mut(&task_id) {
                t.finished_at = Some(Utc::now());
                match result {
                    Ok(rt) => {
                        t.state = InstallState::Done;
                        t.message = Some(format!("已安装 {}（{}）", rt.name, rt.version));
                    }
                    Err(InstallError::Cancelled) => {
                        t.state = InstallState::Cancelled;
                        t.message = Some("已取消".into());
                    }
                    Err(InstallError::Failed(e)) => {
                        tracing::warn!(runtime_id = %t.runtime_id, error = %e, "运行环境安装失败");
                        t.state = InstallState::Failed;
                        t.message = Some(e);
                    }
                }
            }
        });
        Ok(task)
    }

    async fn update<F: FnOnce(&mut InstallTask)>(&self, task_id: &str, f: F) {
        if let Some(t) = self.tasks.write().await.get_mut(task_id) {
            f(t);
        }
    }

    async fn installed_entries(&self, tool: &str) -> Vec<MiseLsEntry> {
        self.mise_output(&["ls", tool, "--installed", "--json"], Duration::from_secs(30))
            .await
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<MiseLsEntry>>(&s).ok())
            .unwrap_or_default()
    }

    async fn run_install(
        &self,
        task_id: &str,
        tool: &str,
        runtime_id: &str,
        spec: &str,
        name: Option<String>,
        mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    ) -> Result<JavaRuntime, InstallError> {
        // 等待前序任务（串行），期间也可取消
        let _guard = tokio::select! {
            g = self.mise_lock.lock() => g,
            _ = &mut cancel_rx => return Err(InstallError::Cancelled),
        };
        self.update(task_id, |t| t.state = InstallState::Resolving).await;

        let previous = self.registry.get(runtime_id).ok();
        let before: Vec<String> = self.installed_entries(tool).await.into_iter().map(|e| e.version).collect();

        let target = format!("{tool}@{spec}");
        let mut child = self
            .mise()
            .args(["install", "-v", &target])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| InstallError::Failed(format!("无法执行 mise（{}）：{e}", self.mise_bin.display())))?;

        let stderr = child.stderr.take().expect("piped stderr");
        let stdout = child.stdout.take().expect("piped stdout");
        let this = self.clone();
        let tid = task_id.to_string();
        let reader = tokio::spawn(async move {
            let mut tail: VecDeque<String> = VecDeque::new();
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = strip_ansi(&line);
                if line.trim().is_empty() || line.contains("mise-versions.jdx.dev") {
                    continue;
                }
                let lower = line.to_ascii_lowercase();
                let url = line
                    .split_whitespace()
                    .find(|w| w.starts_with("https://") && !lower.contains(" 200 ") && !lower.contains(" 404 "))
                    .map(str::to_string);
                let state = if lower.contains("tar -") || lower.contains("extract") || lower.contains("unzip") {
                    Some(InstallState::Extracting)
                } else if lower.contains("download") || lower.contains(" get ") {
                    Some(InstallState::Downloading)
                } else {
                    None
                };
                tail.push_back(line.clone());
                if tail.len() > 40 {
                    tail.pop_front();
                }
                let snapshot: Vec<String> = tail.iter().cloned().collect();
                this.update(&tid, |t| {
                    if let Some(u) = url {
                        let l = u.to_ascii_lowercase();
                        let is_artifact = [".tar.gz", ".tgz", ".tar.xz", ".zip", ".tar.zst", ".pkg"].iter().any(|e| l.ends_with(e));
                        if is_artifact || t.source_url.is_none() {
                            t.source_url = Some(u);
                        }
                    }
                    if let Some(s) = state {
                        if !(t.state == InstallState::Extracting && s == InstallState::Downloading) {
                            t.state = s;
                        }
                    }
                    t.log = snapshot;
                })
                .await;
            }
            tail.into_iter().collect::<Vec<_>>()
        });
        let drain = tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(_)) = lines.next_line().await {}
        });

        let status = tokio::select! {
            r = tokio::time::timeout(Duration::from_secs(60 * 60), child.wait()) => {
                r.map_err(|_| InstallError::Failed("安装超时（60 分钟）".into()))?
                    .map_err(|e| InstallError::Failed(e.to_string()))?
            }
            _ = &mut cancel_rx => {
                let _ = child.kill().await;
                let _ = reader.await;
                let _ = drain.await;
                // 清理半成品：新出现但不完整的安装目录
                self.cleanup_partial(tool, &before).await;
                return Err(InstallError::Cancelled);
            }
        };
        let tail = reader.await.unwrap_or_default();
        let _ = drain.await;
        if !status.success() {
            self.cleanup_partial(tool, &before).await;
            let msg = tail
                .iter()
                .rev()
                .find(|l| l.contains("ERROR") || l.to_ascii_lowercase().contains("error"))
                .cloned()
                .unwrap_or_else(|| tail.last().cloned().unwrap_or_else(|| "mise install 失败".into()));
            return Err(InstallError::Failed(msg));
        }

        let rt = self
            .register_installed(tool, runtime_id, spec, name, previous.as_ref(), &before)
            .await
            .map_err(InstallError::Failed)?;
        Ok(rt)
    }

    /// 安装失败 / 取消后，卸载本次新出现的版本
    async fn cleanup_partial(&self, tool: &str, before: &[String]) {
        let after = self.installed_entries(tool).await;
        for e in after.iter().filter(|e| !before.contains(&e.version)) {
            let _ = self
                .mise_output(&["uninstall", &format!("{tool}@{}", e.version)], Duration::from_secs(120))
                .await;
            let _ = tokio::fs::remove_dir_all(&e.install_path).await;
        }
        let _ = tokio::fs::remove_dir_all(self.mise_root.join("cache").join("invocation-downloads")).await;
    }

    async fn register_installed(
        &self,
        tool: &str,
        runtime_id: &str,
        spec: &str,
        name: Option<String>,
        previous: Option<&JavaRuntime>,
        before: &[String],
    ) -> Result<JavaRuntime, String> {
        // 定位实际安装的版本：优先新增条目，否则用 mise where 解析
        let after = self.installed_entries(tool).await;
        let entry = after
            .iter()
            .filter(|e| e.installed && !before.contains(&e.version))
            .find(|e| spec == "latest" || e.version.starts_with(spec) || spec.starts_with(&e.version))
            .or_else(|| {
                after
                    .iter()
                    .filter(|e| e.installed && (spec == "latest" || e.version.starts_with(spec)))
                    .max_by(|a, b| natural_cmp(&a.version, &b.version))
            });
        let target = format!("{tool}@{spec}");
        let (mise_version, home) = match entry {
            Some(e) => (e.version.clone(), PathBuf::from(&e.install_path)),
            None => {
                let p = self.mise_output(&["where", &target], Duration::from_secs(30)).await?.trim().to_string();
                let v = Path::new(&p).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                (v, PathBuf::from(p))
            }
        };
        let exact = format!("{tool}@{mise_version}");

        // PATH 与环境变量以 mise 计算结果为准（GOROOT、DENO_INSTALL_ROOT 等）
        let bin_paths: Vec<String> = self
            .mise_output(&["bin-paths", &exact], Duration::from_secs(30))
            .await
            .map(|s| s.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
            .unwrap_or_default();
        let mut env: BTreeMap<String, String> = self
            .mise_output(&["env", "-J", &exact], Duration::from_secs(30))
            .await
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        env.remove("PATH");

        let home_c = home.clone();
        let size = tokio::task::spawn_blocking(move || dir_size(&home_c)).await.unwrap_or(0);

        let (major, version, vendor, image_type, default_name) = if tool == "java" {
            let probed = match java_binary_in(&home) {
                Some(bin) => tokio::task::spawn_blocking(move || probe_java(&bin)).await.ok().flatten().unwrap_or_default(),
                None => return Err(format!("安装目录中未找到 bin/java：{}", home.display())),
            };
            let v = JAVA_VENDORS
                .iter()
                .filter(|(p, _, _)| mise_version.starts_with(&format!("{p}-")))
                .max_by_key(|(p, _, _)| p.len());
            let major = if probed.major > 0 {
                probed.major
            } else {
                parse_major(mise_version.trim_start_matches(|c: char| !c.is_ascii_digit()))
            };
            let name = match v {
                Some((_, vn, t)) => format!("{vn} {major}{}", if *t == "jre" { " JRE" } else { "" }),
                None => format!("Java {major}"),
            };
            (
                major,
                if probed.version.is_empty() { mise_version.clone() } else { probed.version },
                if probed.vendor.is_empty() { v.map(|x| x.1.to_string()).unwrap_or_default() } else { probed.vendor },
                v.map(|x| x.2.to_string()).unwrap_or_default(),
                name,
            )
        } else {
            let major = parse_major(&mise_version);
            let short = short_version(tool, &mise_version);
            (major, mise_version.clone(), String::new(), String::new(), format!("{} {short}", tool_display(tool)))
        };

        let runtime = JavaRuntime {
            id: runtime_id.to_string(),
            tool: tool.to_string(),
            name: name
                .filter(|s| !s.trim().is_empty())
                .or_else(|| previous.map(|p| p.name.clone()))
                .unwrap_or(default_name),
            major,
            version,
            vendor,
            image_type,
            arch: adoptium_arch().unwrap_or_default().into(),
            home: home.to_string_lossy().into_owned(),
            source: RuntimeSource::Managed,
            installed_at: Some(Utc::now()),
            size_bytes: Some(size),
            mise_version: Some(mise_version.clone()),
            spec: Some(spec.to_string()),
            bin_paths,
            env,
        };
        self.registry.save(&runtime).map_err(|e| e.to_string())?;

        // 升级：旧版本若不再被其他运行环境引用，则卸载
        if let Some(old) = previous.and_then(|p| p.mise_version.clone()).filter(|v| *v != mise_version) {
            let still_used = self
                .registry
                .list()
                .unwrap_or_default()
                .iter()
                .any(|r| r.tool == tool && r.mise_version.as_deref() == Some(old.as_str()));
            if !still_used {
                let _ = self.mise_output(&["uninstall", &format!("{tool}@{old}")], Duration::from_secs(120)).await;
            }
        }
        tracing::info!(tool, runtime_id, version = %runtime.version, "运行环境安装完成");
        Ok(runtime)
    }

    /// 删除运行环境；托管安装同时调用 mise uninstall
    pub async fn remove(&self, id: &str) -> Result<(), String> {
        let rt = self.registry.get(id).map_err(|e| e.to_string())?;
        if rt.source == RuntimeSource::Managed {
            if let Some(v) = rt.mise_version.as_deref() {
                let shared = self
                    .registry
                    .list()
                    .unwrap_or_default()
                    .iter()
                    .any(|r| r.id != id && r.tool == rt.tool && r.mise_version.as_deref() == Some(v));
                if !shared {
                    let _guard = self.mise_lock.lock().await;
                    self.mise_output(&["uninstall", &format!("{}@{v}", rt.tool)], Duration::from_secs(120))
                        .await?;
                }
            }
        }
        self.registry.remove(id).map_err(|e| e.to_string())
    }

    /// 登记外部已有的 JAVA_HOME
    pub async fn register_custom(&self, id: &str, name: Option<String>, home: &str) -> Result<JavaRuntime, String> {
        validate_runtime_id(id).map_err(|e| e.to_string())?;
        if self.registry.get(id).is_ok() {
            return Err(format!("运行环境 {id} 已存在"));
        }
        let home_path = PathBuf::from(home.trim());
        if !home_path.is_absolute() {
            return Err("JAVA_HOME 必须是绝对路径".into());
        }
        let home_path = home_path.canonicalize().map_err(|_| "JAVA_HOME 目录不存在".to_string())?;
        let bin = java_binary_in(&home_path).ok_or("该目录下没有 bin/java")?;
        let probed = tokio::task::spawn_blocking(move || probe_java(&bin))
            .await
            .ok()
            .flatten()
            .ok_or("无法执行 java -version，请确认该 JDK/JRE 适用于当前系统")?;
        let mut env = BTreeMap::new();
        env.insert("JAVA_HOME".to_string(), home_path.to_string_lossy().into_owned());
        let runtime = JavaRuntime {
            id: id.to_string(),
            tool: "java".into(),
            name: name.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| format!("Java {}", probed.major)),
            major: probed.major,
            version: probed.version,
            vendor: probed.vendor,
            image_type: String::new(),
            arch: adoptium_arch().unwrap_or_default().into(),
            home: home_path.to_string_lossy().into_owned(),
            source: RuntimeSource::Custom,
            installed_at: Some(Utc::now()),
            size_bytes: None,
            mise_version: None,
            spec: None,
            bin_paths: vec![home_path.join("bin").to_string_lossy().into_owned()],
            env,
        };
        self.registry.save(&runtime).map_err(|e| e.to_string())?;
        Ok(runtime)
    }

    // ------------------------------------------------------------------
    // 存储与清理
    // ------------------------------------------------------------------

    async fn orphans(&self) -> Vec<OrphanInstall> {
        let installs = self.mise_root.join("data").join("installs");
        let referenced: Vec<(String, String)> = self
            .registry
            .list()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|r| r.mise_version.map(|v| (r.tool, v)))
            .collect();
        let running: Vec<String> = self
            .tasks
            .read()
            .await
            .values()
            .filter(|t| !t.state.is_finished())
            .map(|t| t.tool.clone())
            .collect();
        tokio::task::spawn_blocking(move || {
            let mut out = Vec::new();
            let Ok(tools) = std::fs::read_dir(&installs) else { return out };
            for t in tools.flatten() {
                let tool = t.file_name().to_string_lossy().into_owned();
                if tool.starts_with('.') || running.contains(&tool) {
                    continue;
                }
                let Ok(vers) = std::fs::read_dir(t.path()) else { continue };
                for v in vers.flatten() {
                    // mise 会为前缀创建符号链接（如 22 -> 22.23.4），只统计真实目录
                    let Ok(ft) = v.file_type() else { continue };
                    if !ft.is_dir() || ft.is_symlink() {
                        continue;
                    }
                    let version = v.file_name().to_string_lossy().into_owned();
                    if version.starts_with('.') || referenced.iter().any(|(rt, rv)| *rt == tool && *rv == version) {
                        continue;
                    }
                    out.push(OrphanInstall {
                        size_bytes: dir_size(&v.path()),
                        path: v.path().to_string_lossy().into_owned(),
                        tool: tool.clone(),
                        version,
                    });
                }
            }
            out
        })
        .await
        .unwrap_or_default()
    }

    pub async fn storage(&self) -> StorageUsage {
        let installs = self.mise_root.join("data").join("installs");
        let cache = self.mise_root.join("cache");
        let (i, c) = tokio::task::spawn_blocking(move || (dir_size(&installs), dir_size(&cache)))
            .await
            .unwrap_or((0, 0));
        StorageUsage { installs_bytes: i, cache_bytes: c, orphans: self.orphans().await }
    }

    /// 清理：已结束任务记录、mise 下载缓存、（可选）未被引用的安装
    pub async fn cleanup(&self, tasks: bool, cache: bool, orphans: bool) -> Result<CleanupResult, String> {
        let removed_tasks = if tasks { self.clear_finished_tasks().await } else { 0 };
        let busy = self.tasks.read().await.values().any(|t| !t.state.is_finished());
        if (cache || orphans) && busy {
            return Err("有安装任务进行中，请等待完成或取消后再清理缓存".into());
        }
        let _guard = self.mise_lock.lock().await;
        let mut freed_cache_bytes = 0;
        if cache {
            let dir = self.mise_root.join("cache");
            let d = dir.clone();
            freed_cache_bytes = tokio::task::spawn_blocking(move || dir_size(&d)).await.unwrap_or(0);
            if let Ok(mut rd) = tokio::fs::read_dir(&dir).await {
                while let Ok(Some(e)) = rd.next_entry().await {
                    let p = e.path();
                    let _ = if p.is_dir() { tokio::fs::remove_dir_all(&p).await } else { tokio::fs::remove_file(&p).await };
                }
            }
            // 已解压完成的下载包
            let dl = self.mise_root.join("data").join("downloads");
            let d2 = dl.clone();
            freed_cache_bytes += tokio::task::spawn_blocking(move || dir_size(&d2)).await.unwrap_or(0);
            let _ = tokio::fs::remove_dir_all(&dl).await;
            self.remote_cache.write().await.clear();
        }
        let mut removed_orphans = Vec::new();
        let mut freed_orphan_bytes = 0;
        if orphans {
            for o in self.orphans().await {
                let _ = self
                    .mise_output(&["uninstall", &format!("{}@{}", o.tool, o.version)], Duration::from_secs(120))
                    .await;
                let _ = tokio::fs::remove_dir_all(&o.path).await;
                freed_orphan_bytes += o.size_bytes;
                removed_orphans.push(format!("{}@{}", o.tool, o.version));
            }
        }
        Ok(CleanupResult { removed_tasks, freed_cache_bytes, removed_orphans, freed_orphan_bytes })
    }
}

enum InstallError {
    Cancelled,
    Failed(String),
}

impl From<String> for InstallError {
    fn from(s: String) -> Self {
        Self::Failed(s)
    }
}

/// 默认运行环境 ID：java 直接用 spec（temurin-jre-21），其他工具加前缀（node-22 / python-3.12）
fn default_runtime_id(tool: &str, spec: &str) -> String {
    let spec = spec.to_ascii_lowercase().replace('+', "-");
    let raw = if tool == "java" { spec } else { format!("{tool}-{spec}") };
    raw.chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c.to_ascii_lowercase() } else { '-' })
        .take(64)
        .collect()
}

/// 名称中的简短版本：node 22.23.4 -> 22，python 3.12.16 -> 3.12
fn short_version(tool: &str, version: &str) -> String {
    let parts: Vec<&str> = version.split('.').collect();
    match tool {
        "node" | "deno" | "bun" => parts.first().copied().unwrap_or(version).to_string(),
        _ if parts.len() >= 2 => format!("{}.{}", parts[0], parts[1]),
        _ => version.to_string(),
    }
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(name)).find(|p| p.is_file())
}

fn last_lines(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join(" | ")
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        if c != '\r' {
            out.push(c);
        }
    }
    out
}

/// 数字段按数值比较的自然排序
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let split = |s: &str| -> Vec<Result<u64, String>> {
        let mut parts = Vec::new();
        let mut cur = String::new();
        let mut digit = None;
        for c in s.chars() {
            let d = c.is_ascii_digit();
            if digit.is_some_and(|x| x != d) {
                parts.push(if digit == Some(true) { Ok(cur.parse().unwrap_or(0)) } else { Err(cur.clone()) });
                cur.clear();
            }
            digit = Some(d);
            cur.push(c);
        }
        if !cur.is_empty() {
            parts.push(if digit == Some(true) { Ok(cur.parse().unwrap_or(0)) } else { Err(cur) });
        }
        parts
    };
    split(a).cmp(&split(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mise_toml_rules_order() {
        let s = DownloadSettings::normalized("tuna".into(), "https://ghfast.top".into(), true).unwrap();
        let toml = s.to_mise_toml();
        let tuna = toml.find("mirrors.tuna").unwrap();
        let node = toml.find("npmmirror.com/mirrors/node").unwrap();
        let py = toml.find("python-build-standalone/$1").unwrap();
        let proxy = toml.find("https://ghfast.top/$1").unwrap();
        // 具体规则必须在通用 GitHub 代理之前（mise 首条命中生效）
        assert!(tuna < proxy && node < proxy && py < proxy);
        assert!(toml.contains("golang.google.cn"));
        assert!(DownloadSettings::normalized("foo".into(), String::new(), false).is_err());
        assert!(DownloadSettings::normalized("official".into(), "ftp://x".into(), false).is_err());
        let off = DownloadSettings::normalized("official".into(), String::new(), false).unwrap();
        assert!(!off.to_mise_toml().contains("url_replacements"));
    }

    #[test]
    fn ids_and_versions() {
        assert_eq!(default_runtime_id("java", "temurin-jre-21"), "temurin-jre-21");
        assert_eq!(default_runtime_id("node", "22"), "node-22");
        assert_eq!(default_runtime_id("python", "3.12"), "python-3.12");
        assert_eq!(short_version("node", "22.23.4"), "22");
        assert_eq!(short_version("python", "3.12.16"), "3.12");
        assert_eq!(natural_cmp("temurin-21.0.9", "temurin-21.0.13"), std::cmp::Ordering::Less);
    }
}
