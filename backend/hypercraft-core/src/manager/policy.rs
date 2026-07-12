use super::*;
use crate::{validate_web_upstream_url, WebConfig};
use std::path::{Component, Path};

impl ServiceManager {
    /// 策略校验：命令 & 工作目录白名单。
    pub(super) fn enforce_policy(&self, manifest: &ServiceManifest) -> Result<()> {
        // 命令白名单：裸名仅匹配裸名；含路径时必须与路径型条目规范化后精确相等
        if let Some(allowed) = &self.allowed_commands {
            if !is_command_allowed(&manifest.command, allowed) {
                return Err(ServiceError::PolicyViolation(format!(
                    "command not allowed: {}",
                    manifest.command
                )));
            }
        }

        // cwd 白名单：必须在 data_dir 或配置的前缀下
        if let Some(cwd) = &manifest.cwd {
            // 特殊值 "*" 表示无限制
            if !self.allowed_cwd_roots.iter().any(|p| p.as_os_str() == "*") {
                let cwd_path = PathBuf::from(cwd);
                let canonical = cwd_path
                    .canonicalize()
                    .map_err(|_| ServiceError::PolicyViolation("cwd not accessible".into()))?;
                let mut ok = canonical.starts_with(&self.data_dir);
                if !ok {
                    for root in &self.allowed_cwd_roots {
                        if canonical.starts_with(root) {
                            ok = true;
                            break;
                        }
                    }
                }
                if !ok {
                    return Err(ServiceError::PolicyViolation(format!(
                        "cwd not allowed: {}",
                        canonical.display()
                    )));
                }
            }
        }

        if let Some(web) = &manifest.web {
            self.validate_web_upstream(web)?;
        }
        Ok(())
    }

    /// Web 上游地址必须限定为宿主机本地地址，避免代理能力被滥用。
    fn validate_web_upstream(&self, web: &WebConfig) -> Result<()> {
        if !web.enabled {
            return Ok(());
        }

        if web.upstream.trim().is_empty() {
            return Err(ServiceError::PolicyViolation(
                "web upstream is required when web is enabled".into(),
            ));
        }
        validate_web_upstream_url(&web.upstream)?;
        Ok(())
    }
}

/// 裸命令名：无路径分隔符，且不是 `.` / `..`。
/// 兼容既有 `HC_ALLOWED_COMMANDS=java.exe,node.exe` 仅写文件名的配置。
fn is_bare_command(command: &str) -> bool {
    !command.is_empty()
        && command != "."
        && command != ".."
        && !command.contains('/')
        && !command.contains('\\')
}

/// 命令名比较：Windows 忽略大小写，其它平台区分大小写。
fn command_names_equal(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

/// 规范化命令路径：优先 canonicalize；文件不存在时对绝对路径做词法规范化。
/// 相对路径（含 `./`、`../`、带目录段）一律视为不可信，返回 None。
fn normalize_command_path(command: &str) -> Option<PathBuf> {
    let path = Path::new(command);
    if !path.is_absolute() {
        return None;
    }
    if let Ok(canonical) = path.canonicalize() {
        return Some(canonical);
    }
    Some(lexical_normalize(path))
}

/// 不依赖文件存在的路径规范化，去掉 `.` 并折叠可解析的 `..`。
fn lexical_normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push(Component::ParentDir.as_os_str());
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        a.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
    } else {
        a == b
    }
}

/// 判断命令是否命中白名单。
///
/// - 裸名命令只能匹配裸名白名单条目，避免 `/tmp/java` 靠 basename 放行。
/// - 含路径的命令只能匹配路径型白名单条目，且规范化后必须精确相等。
fn is_command_allowed(command: &str, allowed: &HashSet<String>) -> bool {
    if is_bare_command(command) {
        return allowed
            .iter()
            .any(|entry| is_bare_command(entry) && command_names_equal(command, entry));
    }

    let Some(cmd_norm) = normalize_command_path(command) else {
        return false;
    };
    allowed.iter().any(|entry| {
        if is_bare_command(entry) {
            return false;
        }
        normalize_command_path(entry)
            .map(|entry_norm| paths_equal(&cmd_norm, &entry_norm))
            .unwrap_or(false)
    })
}
