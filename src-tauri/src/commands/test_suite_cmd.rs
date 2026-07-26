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
    let manifest = TestSuite::load(&base, &suite_id)?;
    let mut previews = Vec::with_capacity(manifest.cases.len());
    for case in &manifest.cases {
        let preview = TestSuite::get_case_preview(&base, &suite_id, &case.id)?;
        previews.push(preview);
    }
    Ok(previews)
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
