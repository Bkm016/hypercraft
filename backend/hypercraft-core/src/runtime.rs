//! 运行环境注册表（Java / Node.js / Python / Go … 任意 mise 工具）。
//!
//! 目录布局：`<data_dir>/runtimes/<tool>/<id>/runtime.json`
//! - 托管安装（managed）：由内嵌 mise 安装，文件位于 `<data_dir>/mise/data/installs/...`
//! - 自定义（custom）：登记外部已有目录（目前用于 JDK / JRE）
//! - 系统（system）：容器 / 主机自带的 java，只读、不落盘
//!
//! 服务通过 `runtimes: [id, ...]` 引用多个运行环境：启动时按顺序前置各自的 bin 目录到 PATH，
//! 并合并其环境变量（如 JAVA_HOME / GOROOT），排在前面的优先。

use crate::error::{Result, ServiceError};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// 系统默认 Java 运行环境的保留 ID
pub const SYSTEM_RUNTIME_ID: &str = "system";
const RUNTIME_META_FILE: &str = "runtime.json";
/// 与 API 路由冲突的保留 ID
const RESERVED_IDS: &[&str] = &[
    SYSTEM_RUNTIME_ID,
    "java",
    "tasks",
    "settings",
    "registry",
    "versions",
    "install",
    "cache",
    "catalog",
];

/// 运行环境来源
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeSource {
    /// 由 Hypercraft（内嵌 mise）安装
    Managed,
    /// 管理员登记的外部目录
    Custom,
    /// 容器 / 主机自带
    System,
}

fn default_tool() -> String {
    "java".into()
}

/// 单个运行环境（历史原因类型名保留 JavaRuntime，tool 字段区分工具）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaRuntime {
    pub id: String,
    /// mise 工具名：java / node / python / go / bun …
    #[serde(default = "default_tool")]
    pub tool: String,
    pub name: String,
    /// 主版本号（Java 8/17/21，Node 22，Python 3 …），未知为 0
    pub major: u32,
    /// 完整版本
    pub version: String,
    #[serde(default)]
    pub vendor: String,
    /// jre / jdk / 空
    #[serde(default)]
    pub image_type: String,
    #[serde(default)]
    pub arch: String,
    /// 安装根目录（Java 即 JAVA_HOME）
    pub home: String,
    pub source: RuntimeSource,
    #[serde(default)]
    pub installed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    /// mise 中的完整版本标识（仅托管），如 temurin-jre-21.0.13+9.0.LTS / 22.23.4
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mise_version: Option<String>,
    /// 安装时请求的版本（用于「更新到最新」），如 temurin-jre-21 / 22 / latest
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<String>,
    /// 需前置到 PATH 的目录；为空时使用 `<home>/bin`
    #[serde(default)]
    pub bin_paths: Vec<String>,
    /// 额外环境变量（如 JAVA_HOME / GOROOT），不含 PATH
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

/// 通用名称别名
pub type Runtime = JavaRuntime;

impl JavaRuntime {
    /// 实际生效的 bin 目录列表
    pub fn effective_bin_paths(&self) -> Vec<PathBuf> {
        if self.bin_paths.is_empty() {
            vec![Path::new(&self.home).join("bin")]
        } else {
            self.bin_paths.iter().map(PathBuf::from).collect()
        }
    }

    /// 实际生效的环境变量（Java 未记录时补 JAVA_HOME）
    pub fn effective_env(&self) -> BTreeMap<String, String> {
        let mut env = self.env.clone();
        if self.tool == "java" && !env.contains_key("JAVA_HOME") {
            env.insert("JAVA_HOME".into(), self.home.clone());
        }
        env.remove("PATH");
        env
    }

    /// 在该运行环境的 bin 目录中查找可执行文件
    pub fn find_executable(&self, name: &str) -> Option<PathBuf> {
        self.effective_bin_paths().into_iter().find_map(|dir| {
            let candidates = if cfg!(windows) {
                vec![dir.join(format!("{name}.exe")), dir.join(format!("{name}.cmd")), dir.join(name)]
            } else {
                vec![dir.join(name)]
            };
            candidates.into_iter().find(|p| p.is_file())
        })
    }
}

/// 版本探测结果
#[derive(Debug, Clone, Default)]
pub struct ProbedJava {
    pub version: String,
    pub major: u32,
    pub vendor: String,
}

/// 运行环境注册表（纯文件存储，无内存状态）
#[derive(Debug, Clone)]
pub struct RuntimeRegistry {
    base: PathBuf,
}

impl RuntimeRegistry {
    pub fn new<P: AsRef<Path>>(data_dir: P) -> Self {
        Self {
            base: data_dir.as_ref().join("runtimes"),
        }
    }

    /// 运行环境根目录：`<data_dir>/runtimes`
    pub fn base(&self) -> &Path {
        &self.base
    }

    /// 兼容旧接口：Java 根目录 `<data_dir>/runtimes/java`
    pub fn root(&self) -> PathBuf {
        self.base.join("java")
    }

    fn tool_dir(&self, tool: &str) -> Result<PathBuf> {
        validate_tool_name(tool)?;
        Ok(self.base.join(tool))
    }

    pub fn ensure_dirs(&self) -> Result<()> {
        std::fs::create_dir_all(self.base.join("java"))?;
        Ok(())
    }

    fn scan(&self) -> Result<Vec<(PathBuf, JavaRuntime)>> {
        let mut out = Vec::new();
        if !self.base.exists() {
            return Ok(out);
        }
        for tool_entry in std::fs::read_dir(&self.base)? {
            let tool_entry = tool_entry?;
            if !tool_entry.file_type()?.is_dir() {
                continue;
            }
            for entry in std::fs::read_dir(tool_entry.path())? {
                let entry = entry?;
                if !entry.file_type()?.is_dir() {
                    continue;
                }
                let meta = entry.path().join(RUNTIME_META_FILE);
                let Ok(data) = std::fs::read(&meta) else { continue };
                match serde_json::from_slice::<JavaRuntime>(&data) {
                    Ok(rt) => out.push((entry.path(), rt)),
                    Err(e) => tracing::warn!(path = %meta.display(), error = %e, "跳过无效的 runtime.json"),
                }
            }
        }
        Ok(out)
    }

    /// 列出所有运行环境：系统 Java（如可用）在前，其余按工具、主版本降序、ID 排序
    pub fn list(&self) -> Result<Vec<JavaRuntime>> {
        let mut items = Vec::new();
        if let Some(system) = detect_system_runtime() {
            items.push(system);
        }
        let mut stored: Vec<JavaRuntime> = self.scan()?.into_iter().map(|(_, r)| r).collect();
        stored.sort_by(|a, b| {
            tool_rank(&a.tool)
                .cmp(&tool_rank(&b.tool))
                .then_with(|| a.tool.cmp(&b.tool))
                .then_with(|| b.major.cmp(&a.major))
                .then_with(|| a.id.cmp(&b.id))
        });
        items.extend(stored);
        Ok(items)
    }

    fn locate(&self, id: &str) -> Result<Option<(PathBuf, JavaRuntime)>> {
        Ok(self.scan()?.into_iter().find(|(_, r)| r.id == id))
    }

    /// 获取单个运行环境（ID 全局唯一）
    pub fn get(&self, id: &str) -> Result<JavaRuntime> {
        if id == SYSTEM_RUNTIME_ID {
            return detect_system_runtime().ok_or_else(|| ServiceError::NotFound(format!("runtime {id}")));
        }
        self.locate(id)?
            .map(|(_, r)| r)
            .ok_or_else(|| ServiceError::NotFound(format!("runtime {id}")))
    }

    /// 落盘运行环境元数据；同 ID 已属于其他工具时拒绝
    pub fn save(&self, runtime: &JavaRuntime) -> Result<()> {
        validate_runtime_id(&runtime.id)?;
        if let Some((_, existing)) = self.locate(&runtime.id)? {
            if existing.tool != runtime.tool {
                return Err(ServiceError::AlreadyExists(format!(
                    "runtime {} ({})",
                    runtime.id, existing.tool
                )));
            }
        }
        let dir = self.tool_dir(&runtime.tool)?.join(&runtime.id);
        std::fs::create_dir_all(&dir)?;
        let tmp = dir.join(format!("{RUNTIME_META_FILE}.tmp"));
        std::fs::write(&tmp, serde_json::to_vec_pretty(runtime)?)?;
        std::fs::rename(tmp, dir.join(RUNTIME_META_FILE))?;
        Ok(())
    }

    /// 删除运行环境登记（托管安装的文件由 mise 卸载）
    pub fn remove(&self, id: &str) -> Result<()> {
        if id == SYSTEM_RUNTIME_ID {
            return Err(ServiceError::PolicyViolation("system runtime cannot be removed".into()));
        }
        let (dir, _) = self
            .locate(id)?
            .ok_or_else(|| ServiceError::NotFound(format!("runtime {id}")))?;
        std::fs::remove_dir_all(dir)?;
        Ok(())
    }

    /// 解析某 Java 运行环境下的 java 可执行文件
    pub fn java_binary(&self, id: &str) -> Result<(JavaRuntime, PathBuf)> {
        let runtime = self.get(id)?;
        let bin = runtime
            .find_executable("java")
            .or_else(|| java_binary_in(Path::new(&runtime.home)))
            .ok_or_else(|| ServiceError::SpawnFailed(format!("java executable not found in runtime {id}")))?;
        Ok((runtime, bin))
    }
}

/// 列表排序用：常用工具靠前
fn tool_rank(tool: &str) -> u8 {
    match tool {
        "java" => 0,
        "node" => 1,
        "python" => 2,
        "go" => 3,
        _ => 9,
    }
}

/// 工具名：mise registry 名称，仅 `[a-z0-9._-]`，长度 1..=64
pub fn validate_tool_name(tool: &str) -> Result<()> {
    let ok = !tool.is_empty()
        && tool.len() <= 64
        && tool.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && tool
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
        && !tool.contains("..");
    if ok {
        Ok(())
    } else {
        Err(ServiceError::PolicyViolation(format!("invalid tool name: {tool}")))
    }
}

/// 运行环境 ID：小写字母数字开头，仅 `[a-z0-9._-]`，长度 1..=64，且不得为保留字
pub fn validate_runtime_id(id: &str) -> Result<()> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && !RESERVED_IDS.contains(&id)
        && id.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'))
        && !id.contains("..");
    if valid {
        Ok(())
    } else {
        Err(ServiceError::PolicyViolation(format!("invalid runtime id: {id}")))
    }
}

fn java_exe_name() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

/// 在 JAVA_HOME 下查找 java 可执行文件
pub fn java_binary_in(home: &Path) -> Option<PathBuf> {
    let bin = home.join("bin").join(java_exe_name());
    bin.is_file().then_some(bin)
}

/// 在解压目录中定位 JAVA_HOME（兼容 `jdk-xx/` 与 macOS `jdk-xx/Contents/Home/`）
pub fn locate_java_home(extracted: &Path) -> Option<PathBuf> {
    let mut candidates = vec![extracted.to_path_buf()];
    if let Ok(entries) = std::fs::read_dir(extracted) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                candidates.push(p.join("Contents").join("Home"));
                candidates.push(p);
            }
        }
    }
    candidates.into_iter().find(|c| java_binary_in(c).is_some())
}

/// 执行 `java -XshowSettings:properties -version` 探测版本信息
pub fn probe_java(java_bin: &Path) -> Option<ProbedJava> {
    let output = std::process::Command::new(java_bin)
        .args(["-XshowSettings:properties", "-version"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stderr);
    let prop = |key: &str| -> Option<String> {
        text.lines().find_map(|line| {
            let (k, v) = line.trim().split_once(" = ")?;
            (k == key).then(|| v.trim().to_string())
        })
    };
    let version = prop("java.runtime.version").or_else(|| prop("java.version"))?;
    let spec = prop("java.specification.version").unwrap_or_else(|| version.clone());
    Some(ProbedJava {
        major: parse_major(&spec),
        version,
        vendor: prop("java.vendor").unwrap_or_default(),
    })
}

/// "1.8" -> 8，"17" -> 17，"21.0.1" -> 21
pub fn parse_major(spec: &str) -> u32 {
    let mut parts = spec.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty());
    match parts.next().and_then(|s| s.parse::<u32>().ok()) {
        Some(1) => parts.next().and_then(|s| s.parse().ok()).unwrap_or(1),
        Some(n) => n,
        None => 0,
    }
}

/// 递归统计目录大小（不跟随符号链接）
pub fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len();
            }
        }
    }
    total
}

/// 探测系统 Java：优先 JAVA_HOME，其次 PATH 中的 java
pub fn detect_system_runtime() -> Option<JavaRuntime> {
    let home = std::env::var_os("JAVA_HOME")
        .map(PathBuf::from)
        .filter(|h| java_binary_in(h).is_some())
        .or_else(|| {
            let path = std::env::var_os("PATH")?;
            std::env::split_paths(&path).find_map(|dir| {
                let bin = dir.join(java_exe_name());
                if !bin.is_file() {
                    return None;
                }
                let real = bin.canonicalize().unwrap_or(bin);
                real.parent()?.parent().map(Path::to_path_buf)
            })
        })?;
    let bin = java_binary_in(&home)?;
    let probed = probe_java(&bin).unwrap_or_default();
    Some(JavaRuntime {
        id: SYSTEM_RUNTIME_ID.to_string(),
        tool: "java".into(),
        name: format!(
            "系统 Java {}",
            if probed.major > 0 { probed.major.to_string() } else { "?".into() }
        ),
        major: probed.major,
        version: probed.version,
        vendor: probed.vendor,
        image_type: String::new(),
        arch: adoptium_arch().unwrap_or_default().to_string(),
        home: home.to_string_lossy().into_owned(),
        source: RuntimeSource::System,
        installed_at: None,
        size_bytes: None,
        mise_version: None,
        spec: None,
        bin_paths: Vec::new(),
        env: BTreeMap::new(),
    })
}

/// 当前平台在 Adoptium 中的架构名
pub fn adoptium_arch() -> Option<&'static str> {
    match std::env::consts::ARCH {
        "x86_64" => Some("x64"),
        "aarch64" => Some("aarch64"),
        "arm" => Some("arm"),
        "powerpc64" => Some("ppc64le"),
        "s390x" => Some("s390x"),
        _ => None,
    }
}

/// 当前平台在 Adoptium 中的操作系统名
pub fn adoptium_os() -> Option<&'static str> {
    match std::env::consts::OS {
        "linux" => Some("linux"),
        "macos" => Some("mac"),
        "windows" => Some("windows"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str, tool: &str) -> JavaRuntime {
        JavaRuntime {
            id: id.into(),
            tool: tool.into(),
            name: "Test".into(),
            major: 17,
            version: "17.0.1".into(),
            vendor: String::new(),
            image_type: String::new(),
            arch: String::new(),
            home: "/nonexistent".into(),
            source: RuntimeSource::Custom,
            installed_at: None,
            size_bytes: None,
            mise_version: None,
            spec: None,
            bin_paths: Vec::new(),
            env: BTreeMap::new(),
        }
    }

    #[test]
    fn major_parsing() {
        assert_eq!(parse_major("1.8"), 8);
        assert_eq!(parse_major("17"), 17);
        assert_eq!(parse_major("21.0.13"), 21);
        assert_eq!(parse_major(""), 0);
    }

    #[test]
    fn runtime_id_rules() {
        assert!(validate_runtime_id("temurin-21-jre").is_ok());
        assert!(validate_runtime_id("system").is_err());
        assert!(validate_runtime_id("tasks").is_err());
        assert!(validate_runtime_id("../x").is_err());
        assert!(validate_runtime_id("A").is_err());
        assert!(validate_runtime_id("").is_err());
        assert!(validate_tool_name("node").is_ok());
        assert!(validate_tool_name("../etc").is_err());
    }

    #[test]
    fn save_list_remove_multi_tool() {
        let dir = tempfile::TempDir::new().unwrap();
        let reg = RuntimeRegistry::new(dir.path());
        reg.save(&sample("custom-test", "java")).unwrap();
        reg.save(&sample("node-22", "node")).unwrap();
        let list = reg.list().unwrap();
        assert!(list.iter().any(|r| r.id == "custom-test"));
        assert!(list.iter().any(|r| r.id == "node-22" && r.tool == "node"));
        // 同 ID 不同工具冲突
        assert!(reg.save(&sample("node-22", "python")).is_err());
        assert_eq!(reg.get("custom-test").unwrap().major, 17);
        assert!(reg.java_binary("custom-test").is_err());
        assert_eq!(reg.get("custom-test").unwrap().effective_env()["JAVA_HOME"], "/nonexistent");
        reg.remove("custom-test").unwrap();
        assert!(reg.get("custom-test").is_err());
    }

    #[test]
    fn legacy_json_defaults_to_java() {
        let json = r#"{"id":"x","name":"x","major":8,"version":"8","home":"/j","source":"managed"}"#;
        let rt: JavaRuntime = serde_json::from_str(json).unwrap();
        assert_eq!(rt.tool, "java");
        assert_eq!(rt.effective_bin_paths(), vec![PathBuf::from("/j/bin")]);
    }
}
