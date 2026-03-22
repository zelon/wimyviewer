use base64::Engine;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const SUPPORTED_EXTENSIONS: &[&str] =
    &["jpg", "jpeg", "png", "bmp", "ico", "psd", "gif", "webp"];

#[tauri::command]
pub async fn select_folder(app: AppHandle) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .pick_folder(move |result| {
            let _ = tx.send(result);
        });
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv().ok().flatten().map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub fn load_directory(dir_path: String) -> Result<Vec<String>, String> {
    let mut paths: Vec<String> = std::fs::read_dir(&dir_path)
        .map_err(|e| format!("디렉토리 읽기 실패: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let ext = path.extension()?.to_str()?.to_lowercase();
            if SUPPORTED_EXTENSIONS.contains(&ext.as_str()) {
                Some(path.to_string_lossy().to_string())
            } else {
                None
            }
        })
        .collect();

    paths.sort();
    Ok(paths)
}

/// PSD 파일을 base64 PNG로 변환하여 반환
/// (JPG/PNG 등 표준 포맷은 JS에서 asset:// 프로토콜로 직접 로드)
#[tauri::command]
pub fn prepare_psd(path: String) -> Result<String, String> {
    let png_bytes = crate::decoder::decode_psd(&path)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&png_bytes))
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("파일 삭제 실패: {}", e))
}

#[tauri::command]
pub fn rename_file(old_path: String, new_name: String) -> Result<String, String> {
    let old = std::path::Path::new(&old_path);
    let parent = old
        .parent()
        .ok_or_else(|| "상위 디렉토리를 찾을 수 없습니다".to_string())?;
    let new_path = parent.join(&new_name);
    std::fs::rename(&old, &new_path).map_err(|e| format!("파일 이름 변경 실패: {}", e))?;
    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn show_in_explorer(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn()
        .map_err(|e| format!("탐색기 열기 실패: {}", e))?;
    Ok(())
}
