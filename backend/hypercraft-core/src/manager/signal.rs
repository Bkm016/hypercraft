//! 信号处理：向服务进程发送系统信号。

use super::*;
use sysinfo::{Pid, System};

impl ServiceManager {
    /// 发送信号（如 Ctrl+C 对应的 INT），失败则返回 NotRunning。
    pub async fn send_signal(&self, id: &str, signal: sysinfo::Signal) -> Result<()> {
        let pid = self
            .read_pid(id)?
            .ok_or_else(|| ServiceError::NotRunning(id.to_string()))?;
        
        let mut sys = System::new();
        sys.refresh_process(Pid::from(pid as usize));
        
        if let Some(process) = sys.process(Pid::from(pid as usize)) {
            if process.kill_with(signal).unwrap_or(false) {
                return Ok(());
            }
            if process.kill() {
                return Ok(());
            }
            return Err(ServiceError::Other("signal not delivered".into()));
        }
        
        Err(ServiceError::NotRunning(id.to_string()))
    }
}
