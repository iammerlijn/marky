mod cli;
mod files;
mod settings;
// Used only on macOS.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod menu;
mod watcher;

use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use watcher::Watchers;

// Files to open: from the command line, from a second `marky` command and from "Open With".
// The frontend takes them when it is ready and after each `open-files` event.
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

// The focused window, or else the first window.
fn target_window(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    let focused = windows.values().find(|w| w.is_focused().unwrap_or(false));
    focused.or_else(|| windows.get("main")).or_else(|| windows.values().next()).cloned()
}

fn add_pending(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    app.state::<PendingFiles>().0.lock().unwrap().extend(paths);
    if let Some(window) = target_window(app) {
        let _ = window.emit_to(window.label(), "open-files", ());
        let _ = window.set_focus();
    }
}

// The settings and the path of their file (settings.rs).
struct AppSettings {
    path: PathBuf,
    settings: Mutex<settings::Settings>,
}

// The menu item changes its check mark itself. Save the new value.
fn toggle_warn_before_quit(app: &AppHandle) {
    let state = app.state::<AppSettings>();
    let mut settings = state.settings.lock().unwrap();
    settings.warn_before_quit = !settings.warn_before_quit;
    let _ = settings::save(&state.path, &settings);
}

// Cmd+Q: ask first when the setting is on. Then close each window through its normal close
// path, so that each window asks about its unsaved changes. The app ends when the last window
// closes. Cancel in a window keeps the app open.
fn quit(app: &AppHandle) {
    let warn = app.state::<AppSettings>().settings.lock().unwrap().warn_before_quit;
    if !warn {
        return close_all_windows(app);
    }
    let handle = app.clone();
    app.dialog()
        .message("Quit Marky?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Quit".into(), "Cancel".into()))
        .show(move |confirmed| {
            if confirmed {
                close_all_windows(&handle);
            }
        });
}

fn close_all_windows(app: &AppHandle) {
    for window in app.webview_windows().values() {
        let _ = window.close();
    }
}

#[tauri::command]
fn open_file(path: String) -> Result<files::Opened, String> {
    files::open(Path::new(&path))
}

#[tauri::command]
fn save_file(path: String, text: String, expected_version: String) -> Result<String, files::SaveError> {
    files::save(Path::new(&path), &text, &expected_version)
}

#[tauri::command]
fn create_file(path: String, text: String) -> Result<String, String> {
    files::create(Path::new(&path), &text)
}

#[tauri::command]
fn watch(app: AppHandle, window: Window, watchers: State<Watchers>, path: String) -> Result<(), String> {
    watcher::watch(app, &watchers, window.label(), path).map_err(|e| e.to_string())
}

#[tauri::command]
fn unwatch(window: Window, watchers: State<Watchers>, path: String) {
    watcher::unwatch(&watchers, window.label(), &path)
}

// Each window has its own tabs. Async: a window must not be made on the main thread of a command.
#[tauri::command]
async fn new_window(app: AppHandle) -> Result<(), String> {
    static NEXT: AtomicUsize = AtomicUsize::new(2);
    let label = format!("window-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    WebviewWindowBuilder::new(&app, label, WebviewUrl::default())
        .title("Marky")
        .inner_size(1000.0, 800.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

static STARTED: OnceLock<Instant> = OnceLock::new();

// For dev/measure-app.sh: prints the time since the process start when MARKY_BENCH is set.
#[tauri::command]
fn bench_mark(label: String) {
    if std::env::var_os("MARKY_BENCH").is_some() {
        let ms = STARTED.get().map_or(0, |start| start.elapsed().as_millis());
        eprintln!("marky-bench {label} {ms}");
    }
}

#[tauri::command]
fn take_pending_files(pending: State<PendingFiles>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    STARTED.get_or_init(Instant::now);
    let cwd = std::env::current_dir().unwrap_or_default();
    let initial = cli::files(std::env::args(), &cwd);
    tauri::Builder::default()
        // Must be the first plugin. A second `marky notes.md` opens a tab in this window.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            add_pending(app, cli::files(args, Path::new(&cwd)));
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let path = app.path().app_config_dir()?.join("settings.json");
            let loaded = settings::load(&path);
            #[cfg(target_os = "macos")]
            app.set_menu(menu::build(app.handle(), loaded.warn_before_quit)?)?;
            app.manage(AppSettings { path, settings: Mutex::new(loaded) });
            Ok(())
        })
        // The quit items are for the app. Each other menu item sends its action to the focused window.
        .on_menu_event(|app, event| match event.id().as_ref() {
            menu::QUIT => quit(app),
            menu::WARN_BEFORE_QUIT => toggle_warn_before_quit(app),
            action => {
                if let Some(window) = target_window(app) {
                    let _ = window.emit_to(window.label(), "menu", action.to_string());
                }
            }
        })
        .manage(Watchers::default())
        .manage(PendingFiles(Mutex::new(initial)))
        .invoke_handler(tauri::generate_handler![open_file, save_file, create_file, watch, unwatch, new_window, take_pending_files, bench_mark])
        .build(tauri::generate_context!())
        .expect("error while building Marky")
        .run(|_app, _event| {
            // macOS: "Open With" and a drop on the Dock icon.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths = urls.iter().filter_map(|url| url.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned());
                add_pending(_app, paths.collect());
            }
        });
}
