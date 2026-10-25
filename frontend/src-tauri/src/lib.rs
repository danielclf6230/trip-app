#[tauri::command]
fn app_update_platform() -> &'static str {
    if cfg!(target_os = "android") {
        "android"
    } else if cfg!(any(target_os = "windows", target_os = "macos")) {
        "desktop"
    } else {
        "unsupported"
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_update_platform])
        .setup(|app| {
            #[cfg(target_os = "android")]
            app.handle().plugin(tauri_plugin_opener::init())?;
            #[cfg(any(target_os = "windows", target_os = "macos"))]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
