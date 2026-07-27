use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::test_suite::{CaseMeta, CasePreview, TestSuite, TestSuiteManifest};

/// 获取 app data 目录作为测试套件存储根目录
fn base_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Other {
            detail: format!("获取数据目录失败: {e}"),
        })
}

/// 创建新测试套件
#[tauri::command]
pub async fn create_test_suite(
    app: AppHandle,
    doc_path: Option<String>,
) -> Result<String, AppError> {
    let base = base_dir(&app)?;
    TestSuite::create(&base, doc_path)
}

/// 加载套件清单
#[tauri::command]
pub async fn load_test_suite(
    app: AppHandle,
    suite_id: String,
) -> Result<TestSuiteManifest, AppError> {
    let base = base_dir(&app)?;
    TestSuite::load(&base, &suite_id)
}

/// 添加测试用例
#[tauri::command]
pub async fn add_test_case(
    app: AppHandle,
    suite_id: String,
    name: String,
    input: String,
    expected: String,
    strict: bool,
) -> Result<CaseMeta, AppError> {
    let base = base_dir(&app)?;
    TestSuite::add_case(&base, &suite_id, name, input, expected, strict)
}

/// 更新测试用例（传 None 的字段不修改）
#[tauri::command]
pub async fn update_test_case(
    app: AppHandle,
    suite_id: String,
    case_id: String,
    name: Option<String>,
    input: Option<String>,
    expected: Option<String>,
    strict: Option<bool>,
) -> Result<CaseMeta, AppError> {
    let base = base_dir(&app)?;
    TestSuite::update_case(&base, &suite_id, &case_id, name, input, expected, strict)
}

/// 删除测试用例
#[tauri::command]
pub async fn remove_test_case(
    app: AppHandle,
    suite_id: String,
    case_id: String,
) -> Result<(), AppError> {
    let base = base_dir(&app)?;
    TestSuite::remove_case(&base, &suite_id, &case_id)
}

/// 获取单个用例预览
#[tauri::command]
pub async fn get_case_preview(
    app: AppHandle,
    suite_id: String,
    case_id: String,
) -> Result<CasePreview, AppError> {
    let base = base_dir(&app)?;
    TestSuite::get_case_preview(&base, &suite_id, &case_id)
}

/// 批量获取套件内所有用例预览（前端加载时一次性获取）
#[tauri::command]
pub async fn get_all_case_previews(
    app: AppHandle,
    suite_id: String,
) -> Result<Vec<CasePreview>, AppError> {
    let base = base_dir(&app)?;
    // spawn_blocking：预览涉及同步文件 IO，避免阻塞 tokio runtime
    tokio::task::spawn_blocking(move || TestSuite::get_all_previews(&base, &suite_id))
        .await
        .map_err(|e| AppError::Other {
            detail: format!("预览任务失败: {e}"),
        })?
}

/// 删除整个套件
#[tauri::command]
pub async fn delete_test_suite(
    app: AppHandle,
    suite_id: String,
) -> Result<(), AppError> {
    let base = base_dir(&app)?;
    TestSuite::delete(&base, &suite_id)
}

/// 获取用例完整期望输出（用于 diff Modal 按需加载，不截断）
#[tauri::command]
pub async fn get_case_full_expected(
    app: AppHandle,
    suite_id: String,
    case_id: String,
) -> Result<String, AppError> {
    let base = base_dir(&app)?;
    let bytes = TestSuite::read_case_expected(&base, &suite_id, &case_id)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// 按 doc_path 查找套件，未找到则创建。用于多 tab 场景。
#[tauri::command]
pub async fn find_or_create_suite_by_doc_path(
    app: AppHandle,
    doc_path: String,
) -> Result<String, AppError> {
    let base = base_dir(&app)?;
    if let Some(id) = TestSuite::find_by_doc_path(&base, &doc_path) {
        return Ok(id);
    }
    TestSuite::create(&base, Some(doc_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// 模拟 get_case_full_expected 的核心逻辑（绕开 AppHandle）
    fn read_full_expected(base: &std::path::Path, suite_id: &str, case_id: &str) -> Result<String, AppError> {
        let bytes = TestSuite::read_case_expected(base, suite_id, case_id)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    #[test]
    fn read_full_expected_ascii() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();
        let _m = TestSuite::add_case(
            base,
            &suite_id,
            "c1".into(),
            "hello\nworld\n".into(),
            "ok".into(),
            false,
        )
        .unwrap();

        let s = read_full_expected(base, &suite_id, &_m.id).unwrap();
        assert_eq!(s, "ok");
    }

    #[test]
    fn read_full_expected_non_utf8_lossy() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();
        // 写入非 UTF-8 字节序列
        let non_utf8: Vec<u8> = vec![0xFF, 0xFE, b'h', b'i'];
        let _m = TestSuite::add_case_from_bytes(
            base,
            &suite_id,
            "c1".into(),
            b"input",
            &non_utf8,
            false,
        )
        .unwrap();

        // 不应 panic，lossy 转换成功
        let s = read_full_expected(base, &suite_id, &_m.id).unwrap();
        // lossy 转换：无效字节变成 U+FFFD
        assert!(s.contains('\u{FFFD}'));
        assert!(s.contains("hi"));
    }

    #[test]
    fn read_full_expected_nonexistent_case_returns_err() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        let result = read_full_expected(base, &suite_id, "nonexistent-id");
        assert!(result.is_err());
    }

    #[test]
    fn read_full_expected_large_file() {
        // 5MB expected：验证大文件可完整读取（不截断）
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();
        let big = "A".repeat(5 * 1024 * 1024);
        let _m = TestSuite::add_case(
            base,
            &suite_id,
            "big".into(),
            "in".into(),
            big.clone(),
            false,
        )
        .unwrap();

        let s = read_full_expected(base, &suite_id, &_m.id).unwrap();
        assert_eq!(s.len(), 5 * 1024 * 1024);
        assert_eq!(s, big);
    }
}
