use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;

use crate::error::AppError;

const MAX_ENTRIES: usize = 10;

/// 最近文件条目。path 唯一，opened_at 为 UNIX 秒。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentEntry {
    pub path: String,
    pub name: String,
    pub opened_at: u64,
}

/// 最近文件持久化：JSON 存到 app_data_dir/recent_files.json，上限 10 条。
/// 按 path 去重，最新放头部。
pub struct RecentFiles;

impl RecentFiles {
    fn file_path(base: &Path) -> PathBuf {
        base.join("recent_files.json")
    }

    pub fn load(base: &Path) -> Result<Vec<RecentEntry>, AppError> {
        let p = Self::file_path(base);
        match fs::read_to_string(&p) {
            Ok(raw) => {
                let entries: Vec<RecentEntry> = serde_json::from_str(&raw).unwrap_or_default();
                Ok(entries)
            }
            Err(_) => Ok(Vec::new()),
        }
    }

    pub fn add(base: &Path, path: String, name: String) -> Result<(), AppError> {
        let mut entries = Self::load(base)?;
        entries.retain(|e| e.path != path);
        let opened_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        entries.insert(0, RecentEntry { path, name, opened_at });
        if entries.len() > MAX_ENTRIES {
            entries.truncate(MAX_ENTRIES);
        }
        Self::save(base, &entries)
    }

    pub fn remove(base: &Path, path: &str) -> Result<(), AppError> {
        let mut entries = Self::load(base)?;
        entries.retain(|e| e.path != path);
        Self::save(base, &entries)
    }

    pub fn clear(base: &Path) -> Result<(), AppError> {
        Self::save(base, &[])
    }

    fn save(base: &Path, entries: &[RecentEntry]) -> Result<(), AppError> {
        let raw = serde_json::to_string_pretty(entries).map_err(|e| AppError::Other {
            detail: format!("序列化最近文件失败: {e}"),
        })?;
        let file_path = Self::file_path(base);
        let parent = file_path.parent().ok_or_else(|| AppError::Other {
            detail: "无效路径".into(),
        })?;
        // 同目录临时文件 + persist(rename)，保证原子性
        let tmp = NamedTempFile::new_in(parent)?;
        fs::write(tmp.path(), &raw)?;
        tmp.persist(&file_path)
            .map_err(|e| AppError::Other {
                detail: format!("持久化最近文件失败: {e}"),
            })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn load_empty_returns_empty() {
        let tmp = TempDir::new().unwrap();
        let entries = RecentFiles::load(tmp.path()).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn add_and_load() {
        let tmp = TempDir::new().unwrap();
        RecentFiles::add(tmp.path(), "/a/b.cpp".into(), "b.cpp".into()).unwrap();
        let entries = RecentFiles::load(tmp.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "/a/b.cpp");
        assert_eq!(entries[0].name, "b.cpp");
    }

    #[test]
    fn add_deduplicates_by_path() {
        let tmp = TempDir::new().unwrap();
        RecentFiles::add(tmp.path(), "/a/b.cpp".into(), "b.cpp".into()).unwrap();
        RecentFiles::add(tmp.path(), "/a/b.cpp".into(), "b.cpp".into()).unwrap();
        let entries = RecentFiles::load(tmp.path()).unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn add_inserts_at_head() {
        let tmp = TempDir::new().unwrap();
        RecentFiles::add(tmp.path(), "/a.cpp".into(), "a.cpp".into()).unwrap();
        RecentFiles::add(tmp.path(), "/b.cpp".into(), "b.cpp".into()).unwrap();
        let entries = RecentFiles::load(tmp.path()).unwrap();
        assert_eq!(entries[0].path, "/b.cpp");
        assert_eq!(entries[1].path, "/a.cpp");
    }

    #[test]
    fn add_truncates_to_10() {
        let tmp = TempDir::new().unwrap();
        for i in 0..15 {
            RecentFiles::add(tmp.path(), format!("/{i}.cpp"), format!("{i}.cpp")).unwrap();
        }
        let entries = RecentFiles::load(tmp.path()).unwrap();
        assert_eq!(entries.len(), 10);
        assert_eq!(entries[0].path, "/14.cpp");
    }

    #[test]
    fn remove_by_path() {
        let tmp = TempDir::new().unwrap();
        RecentFiles::add(tmp.path(), "/a.cpp".into(), "a.cpp".into()).unwrap();
        RecentFiles::add(tmp.path(), "/b.cpp".into(), "b.cpp".into()).unwrap();
        RecentFiles::remove(tmp.path(), "/a.cpp").unwrap();
        let entries = RecentFiles::load(tmp.path()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "/b.cpp");
    }

    #[test]
    fn clear_empties_list() {
        let tmp = TempDir::new().unwrap();
        RecentFiles::add(tmp.path(), "/a.cpp".into(), "a.cpp".into()).unwrap();
        RecentFiles::clear(tmp.path()).unwrap();
        let entries = RecentFiles::load(tmp.path()).unwrap();
        assert!(entries.is_empty());
    }

    /// 回归测试：验证 persist 原子写成功替换原文件
    #[test]
    fn save_persists_atomically() {
        let tmp = TempDir::new().unwrap();
        // 先写入旧内容
        RecentFiles::add(tmp.path(), "/old.cpp".into(), "old.cpp".into()).unwrap();
        // 再写入新内容（触发 persist 替换原文件）
        RecentFiles::add(tmp.path(), "/new.cpp".into(), "new.cpp".into()).unwrap();
        let entries = RecentFiles::load(tmp.path()).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "/new.cpp");
        // 验证文件存在且可解析（persist 后状态正确）
        let file_path = tmp.path().join("recent_files.json");
        assert!(file_path.exists());
    }
}
