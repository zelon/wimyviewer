use base64::Engine;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const SUPPORTED_EXTENSIONS: &[&str] =
    &["jpg", "jpeg", "png", "bmp", "ico", "psd", "gif", "webp"];

#[tauri::command]
pub async fn select_file(app: AppHandle) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("이미지", SUPPORTED_EXTENSIONS)
        .pick_file(move |result| {
            let _ = tx.send(result);
        });
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv().ok().flatten().map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()}

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
pub fn get_startup_file() -> Option<String> {
    std::env::args().nth(1).filter(|arg| {
        let path = std::path::Path::new(arg);
        path.is_file()
            && path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| SUPPORTED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
                .unwrap_or(false)
    })
}

#[tauri::command]
pub fn rotate_and_save(path: String, degrees: i32) -> Result<String, String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if ext == "psd" {
        return Err("PSD 파일은 회전 저장을 지원하지 않습니다".to_string());
    }

    let fmt = image::ImageFormat::from_extension(&ext)
        .ok_or_else(|| format!("지원하지 않는 이미지 형식: {ext}"))?;

    let img = image::open(&path).map_err(|e| format!("이미지 열기 실패: {e}"))?;

    let rotated = match ((degrees % 360) + 360) % 360 {
        90 => img.rotate90(),
        180 => img.rotate180(),
        270 => img.rotate270(),
        _ => img,
    };

    // 원본 포맷으로 인코딩 후 std::fs::write 로 명시적으로 파일에 씁니다
    let mut file_buf = Vec::new();
    rotated
        .write_to(&mut std::io::Cursor::new(&mut file_buf), fmt)
        .map_err(|e| format!("인코딩 실패: {e}"))?;
    std::fs::write(&path, &file_buf)
        .map_err(|e| format!("파일 쓰기 실패: {e} (경로: {path})"))?;

    // JS 캐시용 PNG base64 반환 (브라우저 캐시 우회)
    let mut png_buf = Vec::new();
    rotated
        .write_to(
            &mut std::io::Cursor::new(&mut png_buf),
            image::ImageFormat::Png,
        )
        .map_err(|e| format!("PNG 인코딩 실패: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&png_buf))
}

#[tauri::command]
pub fn show_in_explorer(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", path))
        .spawn()
        .map_err(|e| format!("탐색기 열기 실패: {}", e))?;
    Ok(())
}
