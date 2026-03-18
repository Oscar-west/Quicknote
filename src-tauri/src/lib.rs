mod db;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn get_or_create_overlay(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window("overlay") {
        return Ok(window);
    }

    WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("src/overlay.html".into()))
        .title("Quicknote Capture")
        .inner_size(450.0, 450.0)
        .decorations(false)
        .always_on_top(true)
        .center()
        .skip_taskbar(true)
        .visible(false)
        .resizable(false)
        .build()
}

fn toggle_overlay(app: &tauri::AppHandle) {
    match get_or_create_overlay(app) {
        Ok(window) => {
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("summon", ());
        }
        Err(e) => eprintln!("Failed to toggle overlay: {e}"),
    }
}

#[tauri::command]
async fn hide_capture_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overlay") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:quicknote.db", db::get_migrations())
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // --- System Tray ---
            let open_i = MenuItem::with_id(app, "open", "Open Ideas", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Quicknote")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // --- Main window: hide on close instead of exiting ---
            if let Some(main_window) = app.get_webview_window("main") {
                let main_window_clone = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_window_clone.hide();
                    }
                });

            }

            // --- Global Shortcut: Ctrl+Alt+N ---
            let hotkey = Shortcut::new(
                Some(Modifiers::ALT | Modifiers::CONTROL),
                Code::KeyN,
            );

            app.global_shortcut().on_shortcut(hotkey, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    toggle_overlay(app);
                }
            })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![hide_capture_overlay])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
