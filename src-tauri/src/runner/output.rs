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
