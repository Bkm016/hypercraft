use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// 简单的滑动窗口限流器（基于内存，按 key 计数）。
#[derive(Debug)]
pub struct RateLimiter {
    limit: usize,
    window: Duration,
    buckets: Mutex<HashMap<String, Vec<Instant>>>,
    sweep_threshold: usize,
}

impl RateLimiter {
    pub fn new(limit: usize, window: Duration) -> Self {
        Self {
            limit,
            window,
            buckets: Mutex::new(HashMap::new()),
            sweep_threshold: 1024,
        }
    }

    /// 返回是否允许当前请求；超限返回 false。
    pub async fn allow(&self, key: &str) -> bool {
        let now = Instant::now();
        let key_owned = key.to_string();
        let mut buckets = self.buckets.lock().await;
        let entry = buckets.entry(key_owned.clone()).or_default();
        entry.retain(|t| now.duration_since(*t) < self.window);
        let allowed = if entry.len() >= self.limit {
            false
        } else {
            entry.push(now);
            true
        };
        // 清理空桶，避免无限增长
        if entry.is_empty() {
            buckets.remove(&key_owned);
        }
        // 当 bucket 过多时触发全量清理
        if buckets.len() > self.sweep_threshold {
            buckets.retain(|_, times| {
                times.retain(|t| now.duration_since(*t) < self.window);
                !times.is_empty()
            });
        }
        allowed
    }

    /// 检查是否超限（不记录）
    pub async fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let buckets = self.buckets.lock().await;
        if let Some(entry) = buckets.get(key) {
            let valid_count = entry.iter().filter(|t| now.duration_since(**t) < self.window).count();
            valid_count < self.limit
        } else {
            true
        }
    }

    /// 记录一次访问（不检查限制）
    pub async fn record(&self, key: &str) {
        let now = Instant::now();
        let key_owned = key.to_string();
        let mut buckets = self.buckets.lock().await;
        let entry = buckets.entry(key_owned.clone()).or_default();
        entry.retain(|t| now.duration_since(*t) < self.window);
        entry.push(now);
        // 清理空桶
        if entry.is_empty() {
            buckets.remove(&key_owned);
        }
        // 定期全量清理
        if buckets.len() > self.sweep_threshold {
            buckets.retain(|_, times| {
                times.retain(|t| now.duration_since(*t) < self.window);
                !times.is_empty()
            });
        }
    }
}
