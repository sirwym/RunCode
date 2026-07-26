use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;

/// 硬上限（用户已确认）
pub const MAX_SINGLE_FILE_BYTES: u64 = 50 * 1024 * 1024; // 50MB
pub const MAX_TOTAL_BYTES: u64 = 200 * 1024 * 1024; // 200MB
/// 小样例阈值：<10KB 可 inline 编辑
pub const INLINE_THRESHOLD: u64 = 10 * 1024;

const SCHEMA_VERSION: u32 = 2;

/// 单个测试用例元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseMeta {
    pub id: String,
    pub name: String,
    pub input_size: u64,
    pub expected_size: u64,
    pub strict: bool,
}

/// 套件清单
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestSuiteManifest {
    pub suite_id: String,
    pub doc_path: Option<String>,
    pub cases: Vec<CaseMeta>,
    pub updated_at: u64,
    pub schema_version: u32,
}

/// 用例预览（前端展示用，截断大文件）
#[derive(Debug, Clone, Serialize)]
pub struct CasePreview {
    pub id: String,
    pub name: String,
    pub input_size: u64,
    pub expected_size: u64,
    pub strict: bool,
    /// 输入预览（最多 4KB）
    pub input_preview: String,
    /// 期望输出预览（最多 4KB）
    pub expected_preview: String,
    /// 是否为大样例（>= INLINE_THRESHOLD）
    pub is_large: bool,
}

const PREVIEW_BYTES: usize = 4 * 1024;

/// 文件型测试套件管理。
///
/// 存储结构：
/// ```text
/// {base_dir}/testcases/{suite_id}/
///   manifest.json
///   {case_id}.in
///   {case_id}.out
/// ```
///
/// 所有文件 IO 在此模块完成，前端只通过命令获取元数据和预览。
pub struct TestSuite;

impl TestSuite {
    /// 套件根目录
    fn suites_dir(base: &Path) -> PathBuf {
        base.join("testcases")
    }

    /// 单个套件目录
    fn suite_dir(base: &Path, suite_id: &str) -> PathBuf {
        Self::suites_dir(base).join(suite_id)
    }

    fn manifest_path(base: &Path, suite_id: &str) -> PathBuf {
        Self::suite_dir(base, suite_id).join("manifest.json")
    }

    fn case_input_path(base: &Path, suite_id: &str, case_id: &str) -> PathBuf {
        Self::suite_dir(base, suite_id).join(format!("{case_id}.in"))
    }

    fn case_expected_path(base: &Path, suite_id: &str, case_id: &str) -> PathBuf {
        Self::suite_dir(base, suite_id).join(format!("{case_id}.out"))
    }

    /// 创建新套件，返回 suite_id
    pub fn create(base: &Path, doc_path: Option<String>) -> Result<String, AppError> {
        let suite_id = Uuid::new_v4().to_string();
        let dir = Self::suite_dir(base, &suite_id);
        fs::create_dir_all(&dir)?;

        let manifest = TestSuiteManifest {
            suite_id: suite_id.clone(),
            doc_path,
            cases: vec![],
            updated_at: now_ts(),
            schema_version: SCHEMA_VERSION,
        };
        Self::save_manifest(base, &manifest)?;
        Ok(suite_id)
    }

    /// 按 doc_path 查找套件。返回匹配的 suite_id（未找到返回 None）。
    /// 用于多 tab 场景：每个文件路径关联独立测试套件。
    pub fn find_by_doc_path(base: &Path, doc_path: &str) -> Option<String> {
        let suites_dir = Self::suites_dir(base);
        let entries = fs::read_dir(&suites_dir).ok()?;
        for entry in entries.flatten() {
            let manifest_path = entry.path().join("manifest.json");
            if let Ok(raw) = fs::read_to_string(&manifest_path) {
                if let Ok(manifest) = serde_json::from_str::<TestSuiteManifest>(&raw) {
                    if manifest.doc_path.as_deref() == Some(doc_path) {
                        return Some(manifest.suite_id);
                    }
                }
            }
        }
        None
    }

    /// 加载套件清单
    pub fn load(base: &Path, suite_id: &str) -> Result<TestSuiteManifest, AppError> {
        let path = Self::manifest_path(base, suite_id);
        let raw = fs::read_to_string(&path).map_err(|e| AppError::Other {
            detail: format!("读取套件失败: {e}"),
        })?;
        let manifest: TestSuiteManifest = serde_json::from_str(&raw).map_err(|e| {
            AppError::Other {
                detail: format!("解析套件失败: {e}"),
            }
        })?;
        Ok(manifest)
    }

    /// 保存清单
    fn save_manifest(base: &Path, manifest: &TestSuiteManifest) -> Result<(), AppError> {
        let path = Self::manifest_path(base, &manifest.suite_id);
        let raw = serde_json::to_string_pretty(manifest)
            .map_err(|e| AppError::Other { detail: e.to_string() })?;
        fs::write(&path, raw)?;
        Ok(())
    }

    /// 添加用例（inline 数据）。检查单文件 + 总量上限。
    pub fn add_case(
        base: &Path,
        suite_id: &str,
        name: String,
        input: String,
        expected: String,
        strict: bool,
    ) -> Result<CaseMeta, AppError> {
        Self::add_case_from_bytes(
            base,
            suite_id,
            name,
            input.as_bytes(),
            expected.as_bytes(),
            strict,
        )
    }

    /// 添加用例（字节级）。导入大文件时避免 String 转换和 UTF-8 验证开销。
    pub fn add_case_from_bytes(
        base: &Path,
        suite_id: &str,
        name: String,
        input: &[u8],
        expected: &[u8],
        strict: bool,
    ) -> Result<CaseMeta, AppError> {
        Self::check_limits(base, suite_id, input.len() as u64, expected.len() as u64)?;

        let case_id = format!("tc_{}", Uuid::new_v4().simple());
        fs::write(Self::case_input_path(base, suite_id, &case_id), input)?;
        fs::write(
            Self::case_expected_path(base, suite_id, &case_id),
            expected,
        )?;

        let meta = CaseMeta {
            id: case_id,
            name,
            input_size: input.len() as u64,
            expected_size: expected.len() as u64,
            strict,
        };

        let mut manifest = Self::load(base, suite_id)?;
        manifest.cases.push(meta.clone());
        manifest.updated_at = now_ts();
        Self::save_manifest(base, &manifest)?;

        Ok(meta)
    }

    /// 更新用例（inline 数据）。检查单文件 + 总量上限。
    pub fn update_case(
        base: &Path,
        suite_id: &str,
        case_id: &str,
        name: Option<String>,
        input: Option<String>,
        expected: Option<String>,
        strict: Option<bool>,
    ) -> Result<CaseMeta, AppError> {
        let mut manifest = Self::load(base, suite_id)?;
        let meta = manifest
            .cases
            .iter_mut()
            .find(|c| c.id == case_id)
            .ok_or_else(|| AppError::Other {
                detail: "用例不存在".into(),
            })?;

        if let Some(n) = name {
            meta.name = n;
        }
        if let Some(s) = strict {
            meta.strict = s;
        }

        if let Some(input) = input {
            let input_bytes = input.as_bytes();
            Self::check_single_file(input_bytes.len() as u64)?;
            fs::write(Self::case_input_path(base, suite_id, case_id), input_bytes)?;
            meta.input_size = input_bytes.len() as u64;
        }
        if let Some(expected) = expected {
            let expected_bytes = expected.as_bytes();
            Self::check_single_file(expected_bytes.len() as u64)?;
            fs::write(
                Self::case_expected_path(base, suite_id, case_id),
                expected_bytes,
            )?;
            meta.expected_size = expected_bytes.len() as u64;
        }

        let meta = meta.clone();
        manifest.updated_at = now_ts();
        Self::save_manifest(base, &manifest)?;
        Ok(meta)
    }

    /// 删除用例
    pub fn remove_case(base: &Path, suite_id: &str, case_id: &str) -> Result<(), AppError> {
        let mut manifest = Self::load(base, suite_id)?;
        manifest.cases.retain(|c| c.id != case_id);
        manifest.updated_at = now_ts();
        Self::save_manifest(base, &manifest)?;

        let _ = fs::remove_file(Self::case_input_path(base, suite_id, case_id));
        let _ = fs::remove_file(Self::case_expected_path(base, suite_id, case_id));
        Ok(())
    }

    /// 获取用例预览（截断大文件到 4KB）
    pub fn get_case_preview(
        base: &Path,
        suite_id: &str,
        case_id: &str,
    ) -> Result<CasePreview, AppError> {
        let manifest = Self::load(base, suite_id)?;
        let meta = manifest
            .cases
            .iter()
            .find(|c| c.id == case_id)
            .ok_or_else(|| AppError::Other {
                detail: "用例不存在".into(),
            })?;

        let input_raw = fs::read(Self::case_input_path(base, suite_id, case_id))?;
        let expected_raw = fs::read(Self::case_expected_path(base, suite_id, case_id))?;

        let input_preview = preview_string(&input_raw);
        let expected_preview = preview_string(&expected_raw);

        Ok(CasePreview {
            id: meta.id.clone(),
            name: meta.name.clone(),
            input_size: meta.input_size,
            expected_size: meta.expected_size,
            strict: meta.strict,
            input_preview,
            expected_preview,
            is_large: meta.input_size >= INLINE_THRESHOLD
                || meta.expected_size >= INLINE_THRESHOLD,
        })
    }

    /// 读取用例完整输入（运行时使用，不截断）
    pub fn read_case_input(base: &Path, suite_id: &str, case_id: &str) -> Result<Vec<u8>, AppError> {
        fs::read(Self::case_input_path(base, suite_id, case_id))
            .map_err(AppError::from)
    }

    /// 读取用例完整期望输出（运行时使用，不截断）
    pub fn read_case_expected(
        base: &Path,
        suite_id: &str,
        case_id: &str,
    ) -> Result<Vec<u8>, AppError> {
        fs::read(Self::case_expected_path(base, suite_id, case_id))
            .map_err(AppError::from)
    }

    /// 删除整个套件
    pub fn delete(base: &Path, suite_id: &str) -> Result<(), AppError> {
        let dir = Self::suite_dir(base, suite_id);
        fs::remove_dir_all(&dir).map_err(AppError::from)
    }

    /// 检查单文件上限
    fn check_single_file(size: u64) -> Result<(), AppError> {
        if size > MAX_SINGLE_FILE_BYTES {
            return Err(AppError::Other {
                detail: format!(
                    "单文件超限: {} bytes > {} bytes (50MB)",
                    size, MAX_SINGLE_FILE_BYTES
                ),
            });
        }
        Ok(())
    }

    /// 检查单文件 + 总量上限
    fn check_limits(
        base: &Path,
        suite_id: &str,
        input_size: u64,
        expected_size: u64,
    ) -> Result<(), AppError> {
        Self::check_single_file(input_size)?;
        Self::check_single_file(expected_size)?;

        // 计算现有总量
        let manifest = Self::load(base, suite_id)?;
        let current_total: u64 = manifest
            .cases
            .iter()
            .map(|c| c.input_size + c.expected_size)
            .sum();
        let new_total = current_total + input_size + expected_size;
        if new_total > MAX_TOTAL_BYTES {
            return Err(AppError::Other {
                detail: format!(
                    "整批超限: {} bytes > {} bytes (200MB)",
                    new_total, MAX_TOTAL_BYTES
                ),
            });
        }
        Ok(())
    }
}

fn now_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn preview_string(raw: &[u8]) -> String {
    if raw.len() <= PREVIEW_BYTES {
        String::from_utf8_lossy(raw).into_owned()
    } else {
        let mut s = String::from_utf8_lossy(&raw[..PREVIEW_BYTES]).into_owned();
        s.push_str("\n... (已截断，共 ");
        s.push_str(&format!("{}", raw.len()));
        s.push_str(" bytes)");
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn create_and_load_suite() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();
        let manifest = TestSuite::load(base, &suite_id).unwrap();
        assert_eq!(manifest.suite_id, suite_id);
        assert!(manifest.cases.is_empty());
        assert_eq!(manifest.schema_version, 2);
    }

    #[test]
    fn add_and_preview_case() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        let meta = TestSuite::add_case(
            base,
            &suite_id,
            "样例1".into(),
            "5".into(),
            "10".into(),
            false,
        )
        .unwrap();
        assert_eq!(meta.name, "样例1");
        assert_eq!(meta.input_size, 1);

        let preview = TestSuite::get_case_preview(base, &suite_id, &meta.id).unwrap();
        assert_eq!(preview.input_preview, "5");
        assert_eq!(preview.expected_preview, "10");
        assert!(!preview.is_large);
    }

    #[test]
    fn update_case() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();
        let meta = TestSuite::add_case(
            base, &suite_id, "t".into(), "1".into(), "2".into(), false,
        )
        .unwrap();

        TestSuite::update_case(
            base,
            &suite_id,
            &meta.id,
            Some("t2".into()),
            Some("3".into()),
            Some("4".into()),
            Some(true),
        )
        .unwrap();

        let manifest = TestSuite::load(base, &suite_id).unwrap();
        let updated = manifest.cases.iter().find(|c| c.id == meta.id).unwrap();
        assert_eq!(updated.name, "t2");
        assert_eq!(updated.input_size, 1);
        assert!(updated.strict);

        let preview = TestSuite::get_case_preview(base, &suite_id, &meta.id).unwrap();
        assert_eq!(preview.input_preview, "3");
        assert_eq!(preview.expected_preview, "4");
    }

    #[test]
    fn remove_case() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();
        let meta = TestSuite::add_case(
            base, &suite_id, "t".into(), "1".into(), "2".into(), false,
        )
        .unwrap();

        TestSuite::remove_case(base, &suite_id, &meta.id).unwrap();
        let manifest = TestSuite::load(base, &suite_id).unwrap();
        assert!(manifest.cases.is_empty());
    }

    #[test]
    fn read_case_input_expected() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();
        let meta = TestSuite::add_case(
            base, &suite_id, "t".into(), "hello".into(), "world".into(), false,
        )
        .unwrap();

        let input = TestSuite::read_case_input(base, &suite_id, &meta.id).unwrap();
        let expected = TestSuite::read_case_expected(base, &suite_id, &meta.id).unwrap();
        assert_eq!(input, b"hello");
        assert_eq!(expected, b"world");
    }

    #[test]
    fn reject_oversized_single_file() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();
        let big = "x".repeat((MAX_SINGLE_FILE_BYTES + 1) as usize);
        let result = TestSuite::add_case(base, &suite_id, "big".into(), big, "".into(), false);
        assert!(result.is_err());
    }

    #[test]
    fn large_file_preview_truncated() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();
        let big_input = "x".repeat((INLINE_THRESHOLD + 1) as usize);
        let meta = TestSuite::add_case(
            base,
            &suite_id,
            "big".into(),
            big_input,
            "ok".into(),
            false,
        )
        .unwrap();

        let preview = TestSuite::get_case_preview(base, &suite_id, &meta.id).unwrap();
        assert!(preview.is_large);
        assert!(preview.input_preview.contains("已截断"));
    }

    #[test]
    fn find_by_doc_path_matches() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let path_a = "/tmp/a.cpp";
        let path_b = "/tmp/b.cpp";
        let suite_a = TestSuite::create(base, Some(path_a.into())).unwrap();
        let _suite_b = TestSuite::create(base, Some(path_b.into())).unwrap();

        let found = TestSuite::find_by_doc_path(base, path_a);
        assert_eq!(found, Some(suite_a));
    }

    #[test]
    fn find_by_doc_path_no_match_returns_none() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let _suite = TestSuite::create(base, Some("/tmp/a.cpp".into())).unwrap();
        assert!(TestSuite::find_by_doc_path(base, "/tmp/nonexistent.cpp").is_none());
    }

    #[test]
    fn find_by_doc_path_ignores_null_doc_path() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        // doc_path=None 的套件不应被匹配
        let _suite = TestSuite::create(base, None).unwrap();
        assert!(TestSuite::find_by_doc_path(base, "any").is_none());
    }
}
