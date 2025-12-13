use super::*;

impl ServiceManager {
    /// 策略校验：命令 & 工作目录白名单。
    pub(super) fn enforce_policy(&self, manifest: &ServiceManifest) -> Result<()> {
        // 命令名白名单（仅文件名部分）
        if let Some(allowed) = &self.allowed_commands {
            let name = std::path::Path::new(&manifest.command)
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| ServiceError::PolicyViolation("invalid command".into()))?
                .to_string();
            if !allowed.contains(&name) {
                return Err(ServiceError::PolicyViolation(format!(
                    "command not allowed: {}",
                    name
                )));
            }
        }

        // cwd 白名单：必须在 data_dir 或配置的前缀下
        if let Some(cwd) = &manifest.cwd {
            // 特殊值 "*" 表示无限制
            if self.allowed_cwd_roots.iter().any(|p| p.as_os_str() == "*") {
                return Ok(());
            }
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
        Ok(())
    }
}
