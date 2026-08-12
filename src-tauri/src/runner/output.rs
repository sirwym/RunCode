use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::AsyncReadExt;

/// 每路输出（stdout/stderr）的字节上限
pub const MAX_OUTPUT_BYTES: usize = 1024 * 1024; // 1MB

/// 读取管道到 Vec<u8>，累计到 max_bytes 后停止。
/// 返回 (读取到的字节, 是否被截断)。
pub async fn read_until_limit<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut R,
    max_bytes: usize,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut buf = Vec::with_capacity(8 * 1024);
    let mut chunk = [0u8; 8 * 1024];
    let mut truncated = false;

    loop {
        let n = reader.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        let remaining = max_bytes.saturating_sub(buf.len());
        if remaining == 0 {
            truncated = true;
            break;
        }
        let take = n.min(remaining);
        buf.extend_from_slice(&chunk[..take]);
        if take < n {
            truncated = true;
            break;
        }
    }

    Ok((buf, truncated))
}

/// 读取管道到共享缓冲区，用于超时后仍能获取已读数据。
///
/// 与 read_until_limit 的区别：缓冲区由调用方通过 Arc<Mutex<Vec<u8>>> 提供，
/// 即使读取 future 被 drop（超时），调用方仍能从共享缓冲区获取部分数据。
/// 每次 read 后立即释放锁，不跨 await 持有。
pub async fn read_until_limit_shared<R: tokio::io::AsyncRead + Unpin + Send>(
    mut reader: R,
    max_bytes: usize,
    buf: Arc<Mutex<Vec<u8>>>,
    truncated: Arc<AtomicBool>,
) {
    let mut chunk = [0u8; 8 * 1024];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let mut state = buf.lock().unwrap();
                let remaining = max_bytes.saturating_sub(state.len());
                if remaining == 0 {
                    truncated.store(true, Ordering::Relaxed);
                    break;
                }
                let take = n.min(remaining);
                state.extend_from_slice(&chunk[..take]);
                if take < n {
                    truncated.store(true, Ordering::Relaxed);
                    break;
                }
            }
        }
    }
}
