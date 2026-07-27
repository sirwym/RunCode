use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;
use zip::ZipArchive;

use crate::error::AppError;
use crate::test_suite::{TestSuite, MAX_SINGLE_FILE_BYTES, MAX_TOTAL_BYTES};

/// Unix 文件类型掩码与符号链接
const S_IFMT: u32 = 0o170_000;
const S_IFLNK: u32 = 0o120_000;

/// 导入结果
#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    /// 成功导入数量
    pub imported: usize,
    /// 跳过的文件及原因
    pub skipped: Vec<String>,
}

/// 一对配对文件
struct Pair {
    name: String,
    input_path: PathBuf,
    expected_path: PathBuf,
}

/// 从文件夹导入测试用例。
///
/// 递归遍历文件夹（不跟随符号链接），按配对规则匹配输入/输出文件。
pub fn import_from_directory(
    base: &Path,
    suite_id: &str,
    dir_path: &Path,
    strict: bool,
) -> Result<ImportResult, AppError> {
    // 收集所有文件（跳过符号链接和目录）
    let mut files: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(dir_path).follow_links(false) {
        let entry = entry.map_err(|e| AppError::Other {
            detail: format!("遍历文件夹失败: {e}"),
        })?;
        if entry.file_type().is_symlink() {
            continue;
        }
        if entry.file_type().is_file() {
            files.push(entry.path().to_path_buf());
        }
    }

    let pairs = pair_directory_files(&files);
    import_pairs(base, suite_id, strict, &pairs)
}

/// 从 ZIP 文件导入测试用例。
///
/// 安全检查：
/// - 拒绝 `..` 和绝对路径
/// - 拒绝符号链接条目
/// - 单文件 50MB 上限
/// - 解压总量 200MB 上限
pub fn import_from_zip(
    base: &Path,
    suite_id: &str,
    zip_path: &Path,
    strict: bool,
) -> Result<ImportResult, AppError> {
    let file = fs::File::open(zip_path)?;
    let mut archive = ZipArchive::new(file).map_err(|e| AppError::Other {
        detail: format!("打开 ZIP 失败: {e}"),
    })?;

    // 第一次遍历：收集文件名（basename）→ 索引，安全检查
    let mut file_map: HashMap<String, usize> = HashMap::new();
    let mut total_size: u64 = 0;

    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| AppError::Other {
            detail: format!("读取 ZIP 条目失败: {e}"),
        })?;

        let name = entry.name().to_string();

        // 安全检查：路径不能包含 .. 或为绝对路径
        check_zip_path(&name)?;

        // 检查符号链接（Unix 模式位）
        if let Some(mode) = entry.unix_mode() {
            if (mode & S_IFMT) == S_IFLNK {
                return Err(AppError::Other {
                    detail: format!("ZIP 包含符号链接，已拒绝: {name}"),
                });
            }
        }

        if entry.is_dir() {
            continue;
        }

        // 单文件大小检查
        let size = entry.size();
        if size > MAX_SINGLE_FILE_BYTES {
            return Err(AppError::Other {
                detail: format!(
                    "ZIP 内文件超限: {name} ({} bytes > 50MB)",
                    size
                ),
            });
        }
        total_size += size;
        if total_size > MAX_TOTAL_BYTES {
            return Err(AppError::Other {
                detail: "ZIP 解压总量超限 (200MB)".into(),
            });
        }

        // 只保留 basename（去掉路径前缀），与文件夹导入行为一致
        let basename = Path::new(&name)
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or(name);
        file_map.insert(basename, i);
    }

    // 配对
    let pairs = pair_filename_map(&file_map);

    // 第二次遍历：读取配对文件内容，收集后批量导入
    let mut cases = Vec::with_capacity(pairs.len());
    let mut skipped = Vec::new();

    for pair in &pairs {
        let input_key = pair.input_path.to_string_lossy().into_owned();
        let expected_key = pair.expected_path.to_string_lossy().into_owned();
        let input_idx = *file_map.get(&input_key).unwrap();
        let expected_idx = *file_map.get(&expected_key).unwrap();

        let mut input_buf = Vec::new();
        let mut expected_buf = Vec::new();

        {
            let mut entry = archive.by_index(input_idx).map_err(|e| AppError::Other {
                detail: format!("读取 ZIP 条目失败: {e}"),
            })?;
            entry.read_to_end(&mut input_buf)?;
        }
        {
            let mut entry = archive
                .by_index(expected_idx)
                .map_err(|e| AppError::Other {
                    detail: format!("读取 ZIP 条目失败: {e}"),
                })?;
            entry.read_to_end(&mut expected_buf)?;
        }

        cases.push((pair.name.clone(), input_buf, expected_buf, strict));
    }

    // 批量导入：清单只读一次 + 只写一次
    let (imported, batch_skipped) = TestSuite::add_cases_batch(base, suite_id, cases)?;
    skipped.extend(batch_skipped);

    Ok(ImportResult { imported, skipped })
}

/// 从配对列表导入（文件夹导入用）
fn import_pairs(
    base: &Path,
    suite_id: &str,
    strict: bool,
    pairs: &[Pair],
) -> Result<ImportResult, AppError> {
    // 先读取所有配对文件内容（文件读取失败在此阶段跳过，不进入批量导入）
    let mut cases = Vec::with_capacity(pairs.len());
    let mut skipped = Vec::new();

    for pair in pairs {
        let input = match fs::read(&pair.input_path) {
            Ok(b) => b,
            Err(e) => {
                skipped.push(format!("{}: 读取输入失败: {e}", pair.name));
                continue;
            }
        };
        let expected = match fs::read(&pair.expected_path) {
            Ok(b) => b,
            Err(e) => {
                skipped.push(format!("{}: 读取期望失败: {e}", pair.name));
                continue;
            }
        };
        cases.push((pair.name.clone(), input, expected, strict));
    }

    // 批量导入：清单只读一次 + 只写一次
    let (imported, batch_skipped) = TestSuite::add_cases_batch(base, suite_id, cases)?;
    skipped.extend(batch_skipped);

    Ok(ImportResult { imported, skipped })
}

/// 对文件夹中的文件进行配对。
///
/// 配对规则（优先级递减）：
/// 1. `{name}.in` + `{name}.out`
/// 2. `{name}.in` + `{name}.ans`
/// 3. `input{N}.txt` + `output{N}.txt`
fn pair_directory_files(files: &[PathBuf]) -> Vec<Pair> {
    // basename → 路径
    let mut map: HashMap<String, PathBuf> = HashMap::new();
    for f in files {
        if let Some(name) = f.file_name() {
            let key = name.to_string_lossy().into_owned();
            map.insert(key, f.clone());
        }
    }
    pair_by_rules(&map)
}

/// 对 ZIP 文件名映射进行配对。
fn pair_filename_map(file_map: &HashMap<String, usize>) -> Vec<Pair> {
    // 构造 basename → 路径（这里路径用 basename 字符串模拟）
    let mut name_map: HashMap<String, PathBuf> = HashMap::new();
    for key in file_map.keys() {
        name_map.insert(key.clone(), PathBuf::from(key));
    }
    pair_by_rules(&name_map)
}

/// 通用配对逻辑
fn pair_by_rules(map: &HashMap<String, PathBuf>) -> Vec<Pair> {
    let mut pairs = Vec::new();
    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();

    // 规则 1+2: {name}.in + {name}.out 或 {name}.ans
    let in_files: Vec<String> = map
        .keys()
        .filter(|k| k.ends_with(".in"))
        .cloned()
        .collect();

    for in_name in &in_files {
        let stem = in_name.strip_suffix(".in").unwrap();
        let out_name = format!("{stem}.out");
        let ans_name = format!("{stem}.ans");

        if let Some(out_path) = map.get(&out_name) {
            if !used.contains(&out_name) {
                pairs.push(Pair {
                    name: stem.to_string(),
                    input_path: map.get(in_name).unwrap().clone(),
                    expected_path: out_path.clone(),
                });
                used.insert(in_name.clone());
                used.insert(out_name);
                continue;
            }
        }
        if let Some(ans_path) = map.get(&ans_name) {
            if !used.contains(&ans_name) {
                pairs.push(Pair {
                    name: stem.to_string(),
                    input_path: map.get(in_name).unwrap().clone(),
                    expected_path: ans_path.clone(),
                });
                used.insert(in_name.clone());
                used.insert(ans_name);
            }
        }
    }

    // 规则 3: input{N}.txt + output{N}.txt
    let input_txt_files: Vec<String> = map
        .keys()
        .filter(|k| k.starts_with("input") && k.ends_with(".txt"))
        .cloned()
        .collect();

    for input_name in &input_txt_files {
        if used.contains(input_name) {
            continue;
        }
        let n = input_name
            .strip_prefix("input")
            .unwrap()
            .strip_suffix(".txt")
            .unwrap();
        let output_name = format!("output{n}.txt");
        if let Some(output_path) = map.get(&output_name) {
            if !used.contains(&output_name) {
                pairs.push(Pair {
                    name: format!("Case {n}"),
                    input_path: map.get(input_name).unwrap().clone(),
                    expected_path: output_path.clone(),
                });
                used.insert(input_name.clone());
                used.insert(output_name);
            }
        }
    }

    pairs
}

/// 检查 ZIP 内路径安全性：拒绝 `..` 和绝对路径
fn check_zip_path(name: &str) -> Result<(), AppError> {
    if name.starts_with('/') || name.starts_with('\\') {
        return Err(AppError::Other {
            detail: format!("ZIP 包含绝对路径，已拒绝: {name}"),
        });
    }
    // 检查 .. 组件
    for component in Path::new(name).components() {
        if let std::path::Component::ParentDir = component {
            return Err(AppError::Other {
                detail: format!("ZIP 包含 .. 路径，已拒绝: {name}"),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn make_dir_with_pairs(base: &Path) {
        // case1.in / case1.out
        fs::write(base.join("case1.in"), "5\n").unwrap();
        fs::write(base.join("case1.out"), "10\n").unwrap();
        // case2.in / case2.ans
        fs::write(base.join("case2.in"), "3\n").unwrap();
        fs::write(base.join("case2.ans"), "6\n").unwrap();
        // input1.txt / output1.txt
        fs::write(base.join("input1.txt"), "100\n").unwrap();
        fs::write(base.join("output1.txt"), "200\n").unwrap();
        // 无配对的孤立文件
        fs::write(base.join("orphan.in"), "x\n").unwrap();
    }

    #[test]
    fn pair_directory_all_three_rules() {
        let tmp = TempDir::new().unwrap();
        make_dir_with_pairs(tmp.path());

        let files: Vec<PathBuf> = WalkDir::new(tmp.path())
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.path().to_path_buf())
            .collect();

        let pairs = pair_directory_files(&files);
        assert_eq!(pairs.len(), 3, "应配对 3 组");
        let names: Vec<&str> = pairs.iter().map(|p| p.name.as_str()).collect();
        assert!(names.contains(&"case1"));
        assert!(names.contains(&"case2"));
        assert!(names.contains(&"Case 1"));
    }

    #[test]
    fn import_from_directory_works() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();
        make_dir_with_pairs(base);

        let import_dir = base; // 直接用 base 目录导入
        let result = import_from_directory(base, &suite_id, import_dir, false).unwrap();
        assert_eq!(result.imported, 3, "应导入 3 条");

        let manifest = TestSuite::load(base, &suite_id).unwrap();
        assert_eq!(manifest.cases.len(), 3);
    }

    #[test]
    fn import_from_zip_works() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        // 创建 ZIP 文件
        let zip_path = base.join("test.zip");
        let zip_file = fs::File::create(&zip_path).unwrap();
        let mut zip_writer = zip::ZipWriter::new(zip_file);
        let options =
            zip::write::SimpleFileOptions::default();

        zip_writer.start_file("case1.in", options).unwrap();
        zip_writer.write_all(b"5\n").unwrap();
        zip_writer.start_file("case1.out", options).unwrap();
        zip_writer.write_all(b"10\n").unwrap();
        zip_writer.start_file("case2.in", options).unwrap();
        zip_writer.write_all(b"3\n").unwrap();
        zip_writer.start_file("case2.ans", options).unwrap();
        zip_writer.write_all(b"6\n").unwrap();
        zip_writer.start_file("input1.txt", options).unwrap();
        zip_writer.write_all(b"100\n").unwrap();
        zip_writer.start_file("output1.txt", options).unwrap();
        zip_writer.write_all(b"200\n").unwrap();
        zip_writer.finish().unwrap();

        let result = import_from_zip(base, &suite_id, &zip_path, false).unwrap();
        assert_eq!(result.imported, 3, "应导入 3 条");

        let manifest = TestSuite::load(base, &suite_id).unwrap();
        assert_eq!(manifest.cases.len(), 3);
    }

    #[test]
    fn zip_with_dotdot_rejected() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        let zip_path = base.join("evil.zip");
        let zip_file = fs::File::create(&zip_path).unwrap();
        let mut zip_writer = zip::ZipWriter::new(zip_file);
        let options = zip::write::SimpleFileOptions::default();

        zip_writer.start_file("../evil.txt", options).unwrap();
        zip_writer.write_all(b"evil").unwrap();
        zip_writer.finish().unwrap();

        let result = import_from_zip(base, &suite_id, &zip_path, false);
        assert!(result.is_err(), "应拒绝含 .. 的 ZIP");
    }

    #[test]
    fn zip_with_absolute_path_rejected() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        let zip_path = base.join("abs.zip");
        let zip_file = fs::File::create(&zip_path).unwrap();
        let mut zip_writer = zip::ZipWriter::new(zip_file);
        let options = zip::write::SimpleFileOptions::default();

        zip_writer.start_file("/etc/passwd", options).unwrap();
        zip_writer.write_all(b"evil").unwrap();
        zip_writer.finish().unwrap();

        let result = import_from_zip(base, &suite_id, &zip_path, false);
        assert!(result.is_err(), "应拒绝含绝对路径的 ZIP");
    }

    #[test]
    fn import_skips_unpaired_files() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        let suite_id = TestSuite::create(base, None).unwrap();

        // 只有 .in 没有 .out
        fs::write(base.join("lonely.in"), "x\n").unwrap();

        let result = import_from_directory(base, &suite_id, base, false).unwrap();
        assert_eq!(result.imported, 0, "无配对应导入 0 条");
    }
}
