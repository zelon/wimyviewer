mod commands;
mod decoder;

use commands::{delete_file, get_startup_file, load_directory, prepare_psd, rename_file, select_file, select_folder, show_in_explorer};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_startup_file,
            select_file,
            select_folder,
            load_directory,
            prepare_psd,
            delete_file,
            rename_file,
            show_in_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
