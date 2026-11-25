mod cli;
mod files;
// Used only on macOS.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod menu;
mod watcher;

use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window};
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
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            _app.set_menu(menu::build(_app.handle())?)?;
            Ok(())
        })
        // A menu item sends its action to the focused window.
        .on_menu_event(|app, event| {
            if let Some(window) = target_window(app) {
                let _ = window.emit_to(window.label(), "menu", event.id().0.clone());
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
