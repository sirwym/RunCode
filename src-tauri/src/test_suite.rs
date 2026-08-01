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
        Self::validate_suite_id(suite_id)?;
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
        Self::validate_suite_id(suite_id)?;
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

    /// 批量添加用例（清单只读一次 + 只写一次，O(N) 而非 O(N²)）。
    ///
    /// cases: Vec<(name, input, expected, strict)>
    /// 返回 (成功数, 跳过原因列表)
    pub fn add_cases_batch(
        base: &Path,
        suite_id: &str,
        cases: Vec<(String, Vec<u8>, Vec<u8>, bool)>,
    ) -> Result<(usize, Vec<String>), AppError> {
        Self::validate_suite_id(suite_id)?;
        // 1. 一次性 load 清单
        let mut manifest = Self::load(base, suite_id)?;
        // 2. 计算现有总量
        let mut current_total: u64 = manifest
            .cases
            .iter()
            .map(|c| c.input_size + c.expected_size)
            .sum();

        let mut imported = 0;
        let mut skipped = Vec::new();

        for (name, input, expected, strict) in cases {
            let input_size = input.len() as u64;
            let expected_size = expected.len() as u64;

            // 3. 批量校验：单文件大小 + 总量
            if let Err(e) = Self::check_single_file(input_size) {
                skipped.push(format!("{}: {e}", name));
                continue;
            }
            if let Err(e) = Self::check_single_file(expected_size) {
                skipped.push(format!("{}: {e}", name));
                continue;
            }
            let new_total = current_total + input_size + expected_size;
            if new_total > MAX_TOTAL_BYTES {
                skipped.push(format!("{}: 超出套件总量上限", name));
                continue;
            }

            // 4. 写文件
            let case_id = format!("tc_{}", Uuid::new_v4().simple());
            fs::write(Self::case_input_path(base, suite_id, &case_id), &input)?;
            fs::write(Self::case_expected_path(base, suite_id, &case_id), &expected)?;

            // 5. 更新内存清单
            manifest.cases.push(CaseMeta {
                id: case_id,
                name,
                input_size,
                expected_size,
                strict,
            });
            current_total = new_total;
            imported += 1;
        }

        // 6. 一次写入清单（仅在至少有一个成功导入时）
        if imported > 0 {
            manifest.updated_at = now_ts();
            Self::save_manifest(base, &manifest)?;
        }

        Ok((imported, skipped))
    }

    /// 更新用例（inline 数据）。检查单文件 + 总量上限。
    ///
    /// 注意：必须先做所有大小检查再写入文件，避免部分成功部分失败导致
    /// 磁盘内容与清单不一致。总量计算基于「现有总量 - 旧 input - 旧 expected
    /// + 新 input + 新 expected」。
    pub fn update_case(
        base: &Path,
        suite_id: &str,
        case_id: &str,
        name: Option<String>,
        input: Option<String>,
        expected: Option<String>,
        strict: Option<bool>,
    ) -> Result<CaseMeta, AppError> {
        Self::validate_suite_id(suite_id)?;
        Self::validate_case_id(case_id)?;
        let mut manifest = Self::load(base, suite_id)?;

        // 用索引定位用例，避免可变借用与后续不可变借用冲突
        let meta_idx = manifest
            .cases
            .iter()
            .position(|c| c.id == case_id)
            .ok_or_else(|| AppError::Other {
                detail: "用例不存在".into(),
            })?;

        // 读取旧的 input/expected 大小（用于总量计算）
        let (old_input_size, old_expected_size) = {
            let meta = &manifest.cases[meta_idx];
            (meta.input_size, meta.expected_size)
        };

        // 阶段 1：单文件大小检查（先做所有检查，再写入）
        if let Some(s) = &input {
            Self::check_single_file(s.len() as u64)?;
        }
        if let Some(s) = &expected {
            Self::check_single_file(s.len() as u64)?;
        }

        // 阶段 2：总量检查
        // 新总量 = 现有总量 - 当前用例旧 input - 旧 expected + 新 input + 新 expected
        let current_total: u64 = manifest
            .cases
            .iter()
            .map(|c| c.input_size + c.expected_size)
            .sum();
        let new_input_size = input
            .as_ref()
            .map(|s| s.len() as u64)
            .unwrap_or(old_input_size);
        let new_expected_size = expected
            .as_ref()
            .map(|s| s.len() as u64)
            .unwrap_or(old_expected_size);
        let new_total =
            current_total - old_input_size - old_expected_size + new_input_size + new_expected_size;
        if new_total > MAX_TOTAL_BYTES {
            return Err(AppError::Other {
                detail: format!(
                    "整批超限: {} bytes > {} bytes (200MB)",
                    new_total, MAX_TOTAL_BYTES
                ),
            });
        }

        // 阶段 3：所有检查通过，开始写入文件 + 更新清单
        let meta = &mut manifest.cases[meta_idx];
        // name / strict 不影响大小，直接更新
        if let Some(n) = name {
            meta.name = n;
        }
        if let Some(s) = strict {
            meta.strict = s;
        }
        if let Some(input) = input {
            let input_bytes = input.as_bytes();
            fs::write(Self::case_input_path(base, suite_id, case_id), input_bytes)?;
            meta.input_size = input_bytes.len() as u64;
        }
        if let Some(expected) = expected {
            let expected_bytes = expected.as_bytes();
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
        Self::validate_suite_id(suite_id)?;
        Self::validate_case_id(case_id)?;
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
        Self::validate_suite_id(suite_id)?;
        Self::validate_case_id(case_id)?;
        let manifest = Self::load(base, suite_id)?;
        let meta = manifest
            .cases
            .iter()
            .find(|c| c.id == case_id)
            .ok_or_else(|| AppError::Other {
                detail: "用例不存在".into(),
            })?;

        let input_raw = read_prefix(&Self::case_input_path(base, suite_id, case_id), PREVIEW_BYTES)?;
        let expected_raw = read_prefix(&Self::case_expected_path(base, suite_id, case_id), PREVIEW_BYTES)?;

        let input_preview = preview_string(&input_raw, meta.input_size);
        let expected_preview = preview_string(&expected_raw, meta.expected_size);

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

    /// 批量获取所有用例预览（清单只读一次，预览只读前 4KB，避免大样例全量读入）
    pub fn get_all_previews(base: &Path, suite_id: &str) -> Result<Vec<CasePreview>, AppError> {
        Self::validate_suite_id(suite_id)?;
        let manifest = Self::load(base, suite_id)?;
        let mut previews = Vec::with_capacity(manifest.cases.len());
        for case in &manifest.cases {
            let input_raw = read_prefix(&Self::case_input_path(base, suite_id, &case.id), PREVIEW_BYTES)?;
            let expected_raw = read_prefix(&Self::case_expected_path(base, suite_id, &case.id), PREVIEW_BYTES)?;
            previews.push(CasePreview {
                id: case.id.clone(),
                name: case.name.clone(),
                input_size: case.input_size,
                expected_size: case.expected_size,
                strict: case.strict,
                input_preview: preview_string(&input_raw, case.input_size),
                expected_preview: preview_string(&expected_raw, case.expected_size),
                is_large: case.input_size >= INLINE_THRESHOLD
                    || case.expected_size >= INLINE_THRESHOLD,
            });
        }
        Ok(previews)
    }

    /// 读取用例完整输入（运行时使用，不截断）
    pub fn read_case_input(base: &Path, suite_id: &str, case_id: &str) -> Result<Vec<u8>, AppError> {
        Self::validate_suite_id(suite_id)?;
        Self::validate_case_id(case_id)?;
        fs::read(Self::case_input_path(base, suite_id, case_id))
            .map_err(AppError::from)
    }

    /// 读取用例完整期望输出（运行时使用，不截断）
    pub fn read_case_expected(
        base: &Path,
        suite_id: &str,
        case_id: &str,
    ) -> Result<Vec<u8>, AppError> {
        Self::validate_suite_id(suite_id)?;
        Self::validate_case_id(case_id)?;
        fs::read(Self::case_expected_path(base, suite_id, case_id))
            .map_err(AppError::from)
    }

    /// 删除整个套件
    pub fn delete(base: &Path, suite_id: &str) -> Result<(), AppError> {
        Self::validate_suite_id(suite_id)?;
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

    /// 校验 suite_id 是否为合法 UUID（防止路径穿越）
    /// suite_id 由 create() 用 Uuid::new_v4().to_string() 生成，标准带连字符格式
    fn validate_suite_id(suite_id: &str) -> Result<(), AppError> {
        if Uuid::parse_str(suite_id).is_err() {
            return Err(AppError::Other {
                detail: format!("非法 suite_id 格式: {suite_id}"),
            });
        }
        Ok(())
    }

    /// 校验 case_id 是否为合法格式（tc_ + simple UUID，防止路径穿越）
    /// case_id 由 add_case*() 用 format!("tc_{}", Uuid::new_v4().simple()) 生成
    fn validate_case_id(case_id: &str) -> Result<(), AppError> {
        let rest = case_id.strip_prefix("tc_").ok_or_else(|| AppError::Other {
            detail: format!("非法 case_id 格式（缺少 tc_ 前缀）: {case_id}"),
        })?;
        if Uuid::parse_str(rest).is_err() {
            return Err(AppError::Other {
                detail: format!("非法 case_id 格式: {case_id}"),
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

fn preview_string(raw: &[u8], full_size: u64) -> String {
    if (full_size as usize) <= PREVIEW_BYTES {
        String::from_utf8_lossy(raw).into_owned()
    } else {
        let mut s = String::from_utf8_lossy(&raw[..PREVIEW_BYTES.min(raw.len())]).into_owned();
        s.push_str("\n... (已截断，共 ");
        s.push_str(&format!("{}", full_size));
        s.push_str(" bytes)");
        s
    }
}

/// 只读取文件前 max_bytes 字节（避免大文件全量读入内存）
fn read_prefix(path: &Path, max_bytes: usize) -> Result<Vec<u8>, AppError> {
    use std::io::Read;
    let mut file = fs::File::open(path).map_err(AppError::from)?;
    let mut buf = vec![0u8; max_bytes];
    let n = file.read(&mut buf).map_err(AppError::from)?;
    buf.truncate(n);
    Ok(buf)
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

    // ===== get_all_previews 测试 =====

    #[test]
    fn get_all_previews_empty_suite() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        let previews = TestSuite::get_all_previews(base, &suite_id).unwrap();
        assert!(previews.is_empty());
    }

    #[test]
    fn get_all_previews_returns_all_cases_in_manifest_order() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        let m1 = TestSuite::add_case(base, &suite_id, "c1".into(), "1".into(), "2".into(), false).unwrap();
        let m2 = TestSuite::add_case(base, &suite_id, "c2".into(), "3".into(), "4".into(), true).unwrap();
        let m3 = TestSuite::add_case(base, &suite_id, "c3".into(), "5".into(), "6".into(), false).unwrap();

        let previews = TestSuite::get_all_previews(base, &suite_id).unwrap();
        assert_eq!(previews.len(), 3);
        // 顺序与 manifest.cases 一致（push 顺序）
        assert_eq!(previews[0].id, m1.id);
        assert_eq!(previews[1].id, m2.id);
        assert_eq!(previews[2].id, m3.id);

        // 预览内容正确
        assert_eq!(previews[0].input_preview, "1");
        assert_eq!(previews[0].expected_preview, "2");
        assert!(!previews[0].is_large);
        assert!(!previews[0].strict);

        assert_eq!(previews[1].input_preview, "3");
        assert_eq!(previews[1].expected_preview, "4");
        assert!(previews[1].strict);
    }

    #[test]
    fn get_all_previews_truncates_large_files() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        // 输入大于 INLINE_THRESHOLD（10KB），且远大于 PREVIEW_BYTES（4KB）
        let big_input = "A".repeat((INLINE_THRESHOLD + 1024) as usize);
        let big_expected = "B".repeat((INLINE_THRESHOLD + 1024) as usize);
        let _m = TestSuite::add_case(
            base,
            &suite_id,
            "big".into(),
            big_input,
            big_expected,
            false,
        )
        .unwrap();

        let previews = TestSuite::get_all_previews(base, &suite_id).unwrap();
        assert_eq!(previews.len(), 1);
        let p = &previews[0];
        assert!(p.is_large);
        // 预览包含截断标记
        assert!(p.input_preview.contains("已截断"));
        assert!(p.expected_preview.contains("已截断"));
        // 预览本身不超过 PREVIEW_BYTES + 标记长度
        // （PREVIEW_BYTES = 4096，加上"... (已截断，共 N bytes)" 尾巴）
        assert!(p.input_preview.len() < PREVIEW_BYTES + 100);
    }

    #[test]
    fn get_all_previews_only_reads_prefix_not_full_file() {
        // 验证大样例预览不读完整文件：通过时间或 IO 次数难以直接验证，
        // 这里通过断言预览长度上限来间接确认。
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        let big = "Z".repeat((PREVIEW_BYTES * 10) as usize); // 40KB
        let _m = TestSuite::add_case(base, &suite_id, "big".into(), big, "ok".into(), false).unwrap();

        let previews = TestSuite::get_all_previews(base, &suite_id).unwrap();
        // 输入预览应被截断到 4KB + 标记，而不是完整 40KB
        assert!(previews[0].input_preview.len() < PREVIEW_BYTES + 100);
        // 期望输出小，应完整返回
        assert_eq!(previews[0].expected_preview, "ok");
    }

    // ===== add_cases_batch 测试 =====

    #[test]
    fn add_cases_batch_imports_multiple_cases() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        let cases = vec![
            ("c1".to_string(), b"1".to_vec(), b"2".to_vec(), false),
            ("c2".to_string(), b"3".to_vec(), b"4".to_vec(), true),
            ("c3".to_string(), b"5".to_vec(), b"6".to_vec(), false),
        ];
        let (imported, skipped) = TestSuite::add_cases_batch(base, &suite_id, cases).unwrap();
        assert_eq!(imported, 3);
        assert!(skipped.is_empty());

        // 验证 manifest 已更新（只写一次）
        let manifest = TestSuite::load(base, &suite_id).unwrap();
        assert_eq!(manifest.cases.len(), 3);
        assert_eq!(manifest.cases[0].name, "c1");
        assert_eq!(manifest.cases[1].name, "c2");
        assert_eq!(manifest.cases[2].name, "c3");
        assert!(manifest.cases[1].strict);

        // 文件确实写入
        let previews = TestSuite::get_all_previews(base, &suite_id).unwrap();
        assert_eq!(previews.len(), 3);
        assert_eq!(previews[0].input_preview, "1");
        assert_eq!(previews[2].expected_preview, "6");
    }

    #[test]
    fn add_cases_batch_skips_oversized_files() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        let big = vec![b'x'; (MAX_SINGLE_FILE_BYTES + 1) as usize];
        let normal = b"normal".to_vec();

        let cases = vec![
            ("ok1".to_string(), normal.clone(), normal.clone(), false),
            ("big_input".to_string(), big.clone(), normal.clone(), false),
            ("big_expected".to_string(), normal.clone(), big.clone(), false),
            ("ok2".to_string(), normal.clone(), normal.clone(), false),
        ];
        let (imported, skipped) = TestSuite::add_cases_batch(base, &suite_id, cases).unwrap();
        assert_eq!(imported, 2);
        assert_eq!(skipped.len(), 2);
        assert!(skipped[0].contains("big_input"));
        assert!(skipped[1].contains("big_expected"));

        // manifest 只有 2 个用例
        let manifest = TestSuite::load(base, &suite_id).unwrap();
        assert_eq!(manifest.cases.len(), 2);
        assert_eq!(manifest.cases[0].name, "ok1");
        assert_eq!(manifest.cases[1].name, "ok2");
    }

    #[test]
    fn add_cases_batch_skips_when_exceeding_total_limit() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        // 先添加一个 30MB 用例（< 50MB 单文件上限）
        let thirty_mb = vec![b'A'; 30 * 1024 * 1024];
        TestSuite::add_case_from_bytes(base, &suite_id, "near".into(), &thirty_mb, b"", false).unwrap();

        // 再批量添加：6 个 30MB 会让总量达到 30+6*30=210MB > 200MB，
        // 但只有最后 1 个会超出（30+5*30=180MB OK, 30+6*30=210MB 超出）。
        // 第 6 个跳过后，第 7 个小用例仍可导入（因为只在内存清单累计，不会再加 30MB）。
        // 注意：第 6 个跳过不会增加 current_total。
        let another_30mb = vec![b'B'; 30 * 1024 * 1024];
        let cases = vec![
            ("b1".to_string(), another_30mb.clone(), b"".to_vec(), false),
            ("b2".to_string(), another_30mb.clone(), b"".to_vec(), false),
            ("b3".to_string(), another_30mb.clone(), b"".to_vec(), false),
            ("b4".to_string(), another_30mb.clone(), b"".to_vec(), false),
            ("b5".to_string(), another_30mb.clone(), b"".to_vec(), false),
            ("will_exceed".to_string(), another_30mb.clone(), b"".to_vec(), false),
            ("small_ok".to_string(), b"ok".to_vec(), b"ok".to_vec(), false),
        ];
        let (imported, skipped) = TestSuite::add_cases_batch(base, &suite_id, cases).unwrap();
        assert_eq!(imported, 6); // 5 个 30MB + 1 个 small_ok
        assert_eq!(skipped.len(), 1);
        assert!(skipped[0].contains("will_exceed"));

        let manifest = TestSuite::load(base, &suite_id).unwrap();
        assert_eq!(manifest.cases.len(), 7); // 1 (near) + 6 (imported)
        assert_eq!(manifest.cases[0].name, "near");
        assert_eq!(manifest.cases[6].name, "small_ok");
    }

    #[test]
    fn add_cases_batch_does_not_write_manifest_when_all_skipped() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        // 先记下原 manifest 的 updated_at
        let original = TestSuite::load(base, &suite_id).unwrap();
        let original_ts = original.updated_at;

        // 等待 1 秒，确保 updated_at 若被写会变化
        std::thread::sleep(std::time::Duration::from_secs(1));

        // 全部超限，应跳过且不写 manifest
        let big = vec![b'x'; (MAX_SINGLE_FILE_BYTES + 1) as usize];
        let cases = vec![
            ("big1".to_string(), big.clone(), b"".to_vec(), false),
            ("big2".to_string(), big.clone(), b"".to_vec(), false),
        ];
        let (imported, skipped) = TestSuite::add_cases_batch(base, &suite_id, cases).unwrap();
        assert_eq!(imported, 0);
        assert_eq!(skipped.len(), 2);

        // manifest 未被写入（updated_at 不变）
        let after = TestSuite::load(base, &suite_id).unwrap();
        assert_eq!(after.updated_at, original_ts);
        assert!(after.cases.is_empty());
    }

    #[test]
    fn add_cases_batch_partial_import_with_running_total() {
        // 验证批量导入使用累计总量校验：即使每个用例单独不超单文件上限和总量上限，
        // 累加后超出总量上限的后续用例也会被跳过。
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        // 30MB 单文件：不超 50MB 单文件上限
        // 6 个 30MB = 180MB < 200MB 总量上限 OK
        // 第 7 个 30MB：180+30=210MB > 200MB 跳过
        let thirty_mb = vec![b'A'; 30 * 1024 * 1024];
        let cases = vec![
            ("c1".to_string(), thirty_mb.clone(), b"".to_vec(), false),
            ("c2".to_string(), thirty_mb.clone(), b"".to_vec(), false),
            ("c3".to_string(), thirty_mb.clone(), b"".to_vec(), false),
            ("c4".to_string(), thirty_mb.clone(), b"".to_vec(), false),
            ("c5".to_string(), thirty_mb.clone(), b"".to_vec(), false),
            ("c6".to_string(), thirty_mb.clone(), b"".to_vec(), false),
            ("should_skip".to_string(), thirty_mb.clone(), b"".to_vec(), false),
        ];
        let (imported, skipped) = TestSuite::add_cases_batch(base, &suite_id, cases).unwrap();
        assert_eq!(imported, 6);
        assert_eq!(skipped.len(), 1);
        assert!(skipped[0].contains("should_skip"));

        let manifest = TestSuite::load(base, &suite_id).unwrap();
        assert_eq!(manifest.cases.len(), 6);
        assert_eq!(manifest.cases[5].name, "c6");
    }

    // ===== update_case 总量检查测试 =====

    #[test]
    fn update_case_respects_total_limit() {
        // 验证 update_case 会检查总量上限：
        // 先填满到接近 200MB，再 update 一个用例使其变大，应被拒绝。
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        // 用例 A：30MB input + 30MB expected = 60MB
        let thirty_mb = vec![b'A'; 30 * 1024 * 1024];
        let case_a = TestSuite::add_case_from_bytes(
            base,
            &suite_id,
            "a".into(),
            &thirty_mb,
            &thirty_mb,
            false,
        )
        .unwrap();
        // 用例 B：30MB input + 30MB expected = 60MB，总量 120MB
        let case_b = TestSuite::add_case_from_bytes(
            base,
            &suite_id,
            "b".into(),
            &thirty_mb,
            &thirty_mb,
            false,
        )
        .unwrap();
        // 用例 C：30MB input + 30MB expected = 60MB，总量 180MB
        let _case_c = TestSuite::add_case_from_bytes(
            base,
            &suite_id,
            "c".into(),
            &thirty_mb,
            &thirty_mb,
            false,
        )
        .unwrap();

        // 现在总量 180MB。把用例 A 的 input 从 30MB 改成 40MB：
        // 新总量 = 180 - 30 + 40 = 190MB < 200MB，应该成功。
        let forty_mb = vec![b'B'; 40 * 1024 * 1024];
        let big_input = String::from_utf8_lossy(&forty_mb).into_owned();
        TestSuite::update_case(
            base,
            &suite_id,
            &case_a.id,
            None,
            Some(big_input),
            None,
            None,
        )
        .unwrap();

        // 现在总量 190MB。把用例 B 的 input 从 30MB 改成 50MB：
        // 新总量 = 190 - 30 + 50 = 210MB > 200MB，应该失败。
        let fifty_mb = vec![b'C'; 50 * 1024 * 1024];
        let too_big_input = String::from_utf8_lossy(&fifty_mb).into_owned();
        let result = TestSuite::update_case(
            base,
            &suite_id,
            &case_b.id,
            None,
            Some(too_big_input),
            None,
            None,
        );
        assert!(result.is_err());
        let err = result.unwrap_err();
        match err {
            AppError::Other { detail } => assert!(detail.contains("整批超限")),
            other => panic!("expected AppError::Other, got {other:?}"),
        }

        // 验证用例 B 的 input 未被写入（仍是 30MB 'A'）
        let manifest = TestSuite::load(base, &suite_id).unwrap();
        let case_b_meta = manifest
            .cases
            .iter()
            .find(|c| c.id == case_b.id)
            .unwrap();
        assert_eq!(case_b_meta.input_size, 30 * 1024 * 1024);
    }

    #[test]
    fn update_case_atomic_on_total_limit_exceeded() {
        // 验证 update_case 在总量超限时不会部分写入：
        // 同时更新 input 和 expected，其中 expected 会让总量超限，
        // 应该整体失败，input 也不应被写入。
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        // 用例 A：30MB input + 30MB expected = 60MB
        let thirty_mb = vec![b'A'; 30 * 1024 * 1024];
        let case_a = TestSuite::add_case_from_bytes(
            base,
            &suite_id,
            "a".into(),
            &thirty_mb,
            &thirty_mb,
            false,
        )
        .unwrap();
        // 用例 B：30MB input + 30MB expected = 60MB，总量 120MB
        let _case_b = TestSuite::add_case_from_bytes(
            base,
            &suite_id,
            "b".into(),
            &thirty_mb,
            &thirty_mb,
            false,
        )
        .unwrap();
        // 用例 C：30MB input + 30MB expected = 60MB，总量 180MB
        let _case_c = TestSuite::add_case_from_bytes(
            base,
            &suite_id,
            "c".into(),
            &thirty_mb,
            &thirty_mb,
            false,
        )
        .unwrap();

        // 现在总量 180MB。同时更新用例 A 的 input（小）和 expected（50MB）：
        // 新总量 = 180 - 30 - 30 + 1 + 50 = 171MB... 等等，这没超限。
        // 重新设计：input 改成小值（1 byte），expected 改成 90MB
        // 新总量 = 180 - 30 - 30 + 1 + 90 = 211MB > 200MB，应失败
        let ninety_mb = vec![b'Z'; 90 * 1024 * 1024];
        let too_big_expected = String::from_utf8_lossy(&ninety_mb).into_owned();
        let result = TestSuite::update_case(
            base,
            &suite_id,
            &case_a.id,
            None,
            Some("x".into()), // 小 input
            Some(too_big_expected),
            None,
        );
        assert!(result.is_err());

        // 验证 input 未被写入（仍是 30MB 'A'，而不是 'x'）
        let input_bytes = TestSuite::read_case_input(base, &suite_id, &case_a.id).unwrap();
        assert_eq!(input_bytes.len(), 30 * 1024 * 1024);
        assert_eq!(input_bytes[0], b'A');
    }

    // ===== UUID 校验 / 路径穿越防护测试 =====

    #[test]
    fn rejects_path_traversal_suite_id() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        // 各种路径穿越尝试
        let malicious_ids = [
            "../../../etc/passwd",
            "..\\..\\..\\windows",
            "/etc/passwd",
            "\\windows\\system32",
            "..",
            ".",
            "",
            "abc/../def",
        ];
        for bad in malicious_ids {
            let result = TestSuite::load(base, bad);
            assert!(result.is_err(), "load 应拒绝非法 suite_id: {bad}");
            let err = result.unwrap_err();
            match err {
                AppError::Other { detail } => assert!(
                    detail.contains("非法 suite_id"),
                    "错误信息应包含「非法 suite_id」: {detail}"
                ),
                other => panic!("expected AppError::Other, got {other:?} for id={bad}"),
            }
        }

        // delete 也要校验
        let result = TestSuite::delete(base, "../../../etc");
        assert!(result.is_err());

        // get_all_previews 也要校验
        let result = TestSuite::get_all_previews(base, "..");
        assert!(result.is_err());

        // 合法的 suite_id 仍然可用
        let _ = TestSuite::load(base, &suite_id).unwrap();
    }

    #[test]
    fn rejects_path_traversal_case_id() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        let malicious_ids = [
            "../../../etc/passwd",
            "..\\..\\..\\windows",
            "/etc/passwd",
            "..",
            "tc_../../etc",     // 有 tc_ 前缀但后续非法
            "tc_",              // 空 UUID
            "tc_not-a-uuid",    // 格式不对
            "abc",              // 缺少 tc_ 前缀
        ];
        for bad in malicious_ids {
            let result = TestSuite::get_case_preview(base, &suite_id, bad);
            assert!(result.is_err(), "get_case_preview 应拒绝非法 case_id: {bad}");

            let result = TestSuite::read_case_input(base, &suite_id, bad);
            assert!(result.is_err(), "read_case_input 应拒绝非法 case_id: {bad}");

            let result = TestSuite::read_case_expected(base, &suite_id, bad);
            assert!(result.is_err(), "read_case_expected 应拒绝非法 case_id: {bad}");

            let result = TestSuite::remove_case(base, &suite_id, bad);
            assert!(result.is_err(), "remove_case 应拒绝非法 case_id: {bad}");
        }
    }

    #[test]
    fn accepts_valid_uuid_suite_and_case_ids() {
        // 验证合法的 suite_id（标准 UUID）和 case_id（tc_ + simple UUID）能通过校验
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();
        // create 返回的 suite_id 是标准 UUID 格式
        assert!(Uuid::parse_str(&suite_id).is_ok());

        let meta = TestSuite::add_case(base, &suite_id, "t".into(), "1".into(), "2".into(), false).unwrap();
        // case_id 格式 tc_ + simple UUID
        assert!(meta.id.starts_with("tc_"));
        let uuid_part = &meta.id[3..];
        assert!(Uuid::parse_str(uuid_part).is_ok());

        // 合法 ID 的各种操作应成功
        let _ = TestSuite::get_case_preview(base, &suite_id, &meta.id).unwrap();
        let _ = TestSuite::read_case_input(base, &suite_id, &meta.id).unwrap();
        let _ = TestSuite::read_case_expected(base, &suite_id, &meta.id).unwrap();
    }
}
