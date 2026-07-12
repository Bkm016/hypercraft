use std::collections::HashMap;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use futures::Stream;
use tokio::sync::Mutex as AsyncMutex;

/// 简单的滑动窗口限流器（基于内存，按 key 计数）。
#[derive(Debug)]
pub struct RateLimiter {
    limit: usize,
    window: Duration,
    buckets: AsyncMutex<HashMap<String, Vec<Instant>>>,
    sweep_threshold: usize,
}

impl RateLimiter {
    pub fn new(limit: usize, window: Duration) -> Self {
        Self {
            limit,
            window,
            buckets: AsyncMutex::new(HashMap::new()),
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
            let valid_count = entry
                .iter()
                .filter(|t| now.duration_since(**t) < self.window)
                .count();
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

/// 按 key 限制同时持有的流式连接数；permit Drop 时自动释放。
#[derive(Debug)]
pub struct StreamConcurrencyLimiter {
    max_per_key: usize,
    counts: Mutex<HashMap<String, usize>>,
}

/// 持有一个流式连接槽位，离开作用域后自动归还。
pub struct StreamPermit {
    key: String,
    limiter: Arc<StreamConcurrencyLimiter>,
}

/// 将 permit 绑定到 stream 生命周期，流结束或客户端断开时释放。
pub struct StreamWithPermit<S> {
    inner: S,
    _permit: StreamPermit,
}

impl StreamConcurrencyLimiter {
    pub fn new(max_per_key: usize) -> Arc<Self> {
        Arc::new(Self {
            max_per_key: max_per_key.max(1),
            counts: Mutex::new(HashMap::new()),
        })
    }

    /// 尝试占用一个槽位；超限返回 None。
    pub fn try_acquire(self: &Arc<Self>, key: impl Into<String>) -> Option<StreamPermit> {
        let key = key.into();
        let mut counts = self.counts.lock().ok()?;
        let entry = counts.entry(key.clone()).or_insert(0);
        if *entry >= self.max_per_key {
            return None;
        }
        *entry += 1;
        Some(StreamPermit {
            key,
            limiter: Arc::clone(self),
        })
    }

    /// 当前 key 占用数（测试与观测用）。
    pub fn active_count(&self, key: &str) -> usize {
        self.counts
            .lock()
            .ok()
            .and_then(|counts| counts.get(key).copied())
            .unwrap_or(0)
    }
}

impl Drop for StreamPermit {
    fn drop(&mut self) {
        if let Ok(mut counts) = self.limiter.counts.lock() {
            if let Some(count) = counts.get_mut(&self.key) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    counts.remove(&self.key);
                }
            }
        }
    }
}

impl StreamConcurrencyLimiter {
    /// 包装 stream，确保连接存活期间占用 permit。
    pub fn guard_stream<S>(stream: S, permit: StreamPermit) -> StreamWithPermit<S> {
        StreamWithPermit {
            inner: stream,
            _permit: permit,
        }
    }
}

impl<S: Stream> Stream for StreamWithPermit<S> {
    type Item = S::Item;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        // StreamPermit 仅用于 Drop 释放槽位，永不移动 inner。
        let this = unsafe { self.get_unchecked_mut() };
        let inner = unsafe { Pin::new_unchecked(&mut this.inner) };
        inner.poll_next(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_permit_enforces_and_releases() {
        let limiter = StreamConcurrencyLimiter::new(2);
        let a = limiter.try_acquire("user:svc").expect("first");
        let b = limiter.try_acquire("user:svc").expect("second");
        assert!(limiter.try_acquire("user:svc").is_none());
        assert_eq!(limiter.active_count("user:svc"), 2);
        drop(a);
        assert_eq!(limiter.active_count("user:svc"), 1);
        let c = limiter.try_acquire("user:svc").expect("after release");
        drop(b);
        drop(c);
        assert_eq!(limiter.active_count("user:svc"), 0);
    }

    #[test]
    fn stream_keys_are_isolated() {
        let limiter = StreamConcurrencyLimiter::new(1);
        let _a = limiter.try_acquire("sse:u1:s1").unwrap();
        assert!(limiter.try_acquire("sse:u1:s1").is_none());
        assert!(limiter.try_acquire("sse:u1:s2").is_some());
        assert!(limiter.try_acquire("ws:u1:s1").is_some());
    }
}
