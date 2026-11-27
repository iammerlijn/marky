mod about;
mod cli;
mod files;
mod grants;
mod settings;
// Used only on macOS.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod menu;
#[cfg(target_os = "macos")]
mod terminate;
#[cfg(target_os = "macos")]
mod update;
mod watcher;

use grants::Grants;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::{
    AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window,
};
use tauri_plugin_dialog::{DialogExt, FilePath, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use watcher::Watchers;

// Files to open: from the command line, from a second `marky` command and from "Open With".
// The frontend takes them when it is ready and after each `open-files` event.
#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

// The label of the settings window. It has no tabs, so files and menu actions go to an editor window.
const SETTINGS_WINDOW: &str = "settings";

// True when `closed` was the last editor window. Then the settings window closes too, so that
// Marky quits as before: the app ends when the last window closes.
fn last_editor_closed<'a>(closed: &str, labels: impl IntoIterator<Item = &'a str>) -> bool {
    closed != SETTINGS_WINDOW
        && labels
            .into_iter()
            .all(|label| label == SETTINGS_WINDOW || label == closed)
}

// The focused editor window, or else the first window.
fn target_window(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    let mut editors = windows.values().filter(|w| w.label() != SETTINGS_WINDOW);
    let focused = editors.clone().find(|w| w.is_focused().unwrap_or(false));
    focused
        .or_else(|| windows.get("main"))
        .or_else(|| editors.next())
        .cloned()
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

#[tauri::command]
fn get_settings(state: State<AppSettings>) -> settings::Settings {
    state.settings.lock().unwrap().clone()
}

// From the settings window. Nothing changes when the save fails: the settings window then
// shows the old values again. All windows get the new settings, so that they change the theme at once.
#[tauri::command]
fn set_settings(
    app: AppHandle,
    state: State<AppSettings>,
    settings: settings::Settings,
) -> Result<(), String> {
    settings::save_and_set(
        &state.path,
        &mut state.settings.lock().unwrap(),
        settings.clone(),
    )
    .map_err(|e| e.to_string())?;
    app.set_theme(settings::native_theme(settings.theme));
    let _ = app.emit("settings-changed", &settings);
    Ok(())
}

#[tauri::command]
fn about(app: AppHandle) -> about::About {
    about::about(app.package_info())
}

// A click on a link in the document (src/editor/plugins/links.ts). The page is not trusted, so
// only web and mail links open: a link must not start another app.
fn openable_link(url: &str) -> Option<tauri::Url> {
    let url = tauri::Url::parse(url).ok()?;
    matches!(url.scheme(), "http" | "https" | "mailto").then_some(url)
}

#[tauri::command]
fn open_link(app: AppHandle, url: String) -> Result<(), String> {
    let link =
        openable_link(&url).ok_or_else(|| format!("Marky does not open this link: {url}"))?;
    app.opener()
        .open_url(link.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}

// One settings window: a second Cmd/Ctrl+, selects it.
fn show_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) {
        window.unminimize()?;
        return window.set_focus();
    }
    // Linux shows the About section too (src/app/Settings.svelte). The page then sets the height
    // to its content (src/app/settings.ts).
    let height = if cfg!(target_os = "macos") {
        192.0
    } else {
        226.0
    };
    WebviewWindowBuilder::new(
        app,
        SETTINGS_WINDOW,
        WebviewUrl::App("settings.html".into()),
    )
    .title("Settings")
    .inner_size(480.0, height)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    // The page shows the window when it is ready (src/app/settings.ts).
    .visible(false)
    .build()?;
    Ok(())
}

// Linux: Ctrl+, in the page. Async: a window must not be made on the main thread of a command.
#[tauri::command]
async fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings(&app).map_err(|e| e.to_string())
}

// Cmd+Q: ask first when the setting is on. Then close each window through its normal close
// path, so that each window asks about its unsaved changes. The app ends when the last window
// closes. Cancel in a window keeps the app open.
fn quit(app: &AppHandle) {
    let warn = app
        .state::<AppSettings>()
        .settings
        .lock()
        .unwrap()
        .warn_before_quit;
    if !warn {
        return close_all_windows(app);
    }
    let handle = app.clone();
    app.dialog()
        .message("Quit Marky?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit".into(),
            "Cancel".into(),
        ))
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

// Linux: Ctrl+Q in the page. There is no "Quit Marky?" question and no setting for it. Each
// window still asks about its unsaved changes, and the next start reopens the tabs.
#[tauri::command]
fn quit_app(app: AppHandle) {
    close_all_windows(&app)
}

// The file commands accept only the paths that the user gave to the window (grants.rs).
#[tauri::command]
fn open_file<R: Runtime>(
    window: Window<R>,
    grants: State<Grants>,
    path: String,
) -> Result<files::Opened, String> {
    grants.check_open(window.label(), Path::new(&path))?;
    files::open(Path::new(&path))
}

#[tauri::command]
fn save_file<R: Runtime>(
    window: Window<R>,
    grants: State<Grants>,
    path: String,
    text: String,
    expected_version: String,
) -> Result<String, files::SaveError> {
    grants
        .check(window.label(), Path::new(&path))
        .map_err(files::SaveError::Io)?;
    files::save(Path::new(&path), &text, &expected_version)
}

#[tauri::command]
fn create_file<R: Runtime>(
    window: Window<R>,
    grants: State<Grants>,
    path: String,
    text: String,
) -> Result<String, String> {
    grants.check(window.label(), Path::new(&path))?;
    files::create(Path::new(&path), &text)
}

#[tauri::command]
fn watch<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    grants: State<Grants>,
    watchers: State<Watchers>,
    path: String,
) -> Result<(), String> {
    grants.check(window.label(), Path::new(&path))?;
    watcher::watch(app, &watchers, window.label(), path).map_err(|e| e.to_string())
}

#[tauri::command]
fn unwatch<R: Runtime>(
    window: Window<R>,
    grants: State<Grants>,
    watchers: State<Watchers>,
    path: String,
) -> Result<(), String> {
    grants.check(window.label(), Path::new(&path))?;
    watcher::unwatch(&watchers, window.label(), &path);
    Ok(())
}

// The files that the dialogs show, and the files that a drop opens.
const MARKDOWN: &[&str] = &["md", "markdown", "mdx", "txt"];

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| MARKDOWN.contains(&ext.to_lowercase().as_str()))
}

// The dialogs are in the backend, so that the backend knows the path that the user chose.
// The dialog commands are async: a dialog must not block the main thread.
fn granted(window: &Window, grants: &Grants, chosen: Option<FilePath>) -> Option<String> {
    let path = chosen?.into_path().ok()?;
    grants.grant(window.label(), &path);
    Some(path.to_string_lossy().into_owned())
}

// `path`: a file to show in the dialog, for a Recent file that the window has no grant for.
#[tauri::command]
async fn open_dialog(
    window: Window,
    grants: State<'_, Grants>,
    path: Option<String>,
) -> Result<Option<String>, ()> {
    let mut dialog = window
        .dialog()
        .file()
        .add_filter("Markdown", MARKDOWN)
        .set_parent(&window);
    if let Some(path) = path.as_deref().map(Path::new) {
        if let Some(folder) = path.parent() {
            dialog = dialog.set_directory(folder);
        }
        if let Some(name) = path.file_name() {
            dialog = dialog.set_file_name(name.to_string_lossy());
        }
    }
    Ok(granted(&window, &grants, dialog.blocking_pick_file()))
}

// Save As. The user can choose a file that exists: the dialog asks before it is replaced.
#[tauri::command]
async fn save_dialog(window: Window, grants: State<'_, Grants>) -> Result<Option<String>, ()> {
    let chosen = window
        .dialog()
        .file()
        .add_filter("Markdown", MARKDOWN)
        .set_file_name("Untitled.md")
        .set_parent(&window)
        .blocking_save_file();
    Ok(granted(&window, &grants, chosen))
}

// Each window has its own tabs. Async: a window must not be made on the main thread of a command.
#[tauri::command]
async fn new_window(app: AppHandle) -> Result<(), String> {
    static NEXT: AtomicUsize = AtomicUsize::new(2);
    let label = format!("window-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let builder = WebviewWindowBuilder::new(&app, label, WebviewUrl::default())
        .title("Marky")
        .inner_size(1000.0, 800.0)
        // The frontend shows the window when the document is ready (src/app/main.ts).
        .visible(false);
    // The same title bar as the first window (tauri.conf.json): the tabs are in it.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 20.0));
    builder.build().map_err(|e| e.to_string())?;
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

// The window that takes the files gets the grants for them.
#[tauri::command]
fn take_pending_files(
    window: Window,
    grants: State<Grants>,
    pending: State<PendingFiles>,
) -> Vec<String> {
    let paths = std::mem::take(&mut *pending.0.lock().unwrap());
    for path in &paths {
        grants.grant(window.label(), Path::new(path));
    }
    paths
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
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                update::check_in_background(app.handle());
            }
            let config = app.path().app_config_dir()?;
            app.manage(Grants::load(config.join("grants.json")));
            let path = config.join("settings.json");
            let loaded = settings::load(&path);
            app.set_theme(settings::native_theme(loaded.theme));
            #[cfg(target_os = "macos")]
            app.set_menu(menu::build(app.handle())?)?;
            // Quit from the Dock uses the same path as Cmd+Q.
            #[cfg(target_os = "macos")]
            terminate::install(app.handle());
            app.manage(AppSettings {
                path,
                settings: Mutex::new(loaded),
            });
            Ok(())
        })
        // The quit and settings items are for the app. Each other menu item sends its action to the
        // focused editor window. Cmd+W in the settings window closes it.
        .on_menu_event(|app, event| match event.id().as_ref() {
            menu::QUIT => quit(app),
            menu::SETTINGS => {
                let _ = show_settings(app);
            }
            action => {
                let settings = app
                    .get_webview_window(SETTINGS_WINDOW)
                    .filter(|w| w.is_focused().unwrap_or(false));
                if let Some(settings) = settings.filter(|_| action == "close-tab") {
                    let _ = settings.close();
                    return;
                }
                if let Some(window) = target_window(app) {
                    let _ = window.emit_to(window.label(), "menu", action.to_string());
                }
            }
        })
        .on_window_event(|window, event| {
            // A drop grants the markdown files to the window, then the window opens them. Not
            // the drop event of Tauri: the page can get that before this grant.
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let grants = window.state::<Grants>();
                let dropped: Vec<String> = paths
                    .iter()
                    .filter(|path| is_markdown(path))
                    .map(|path| {
                        grants.grant(window.label(), path);
                        path.to_string_lossy().into_owned()
                    })
                    .collect();
                let _ = window.emit_to(window.label(), "dropped-files", dropped);
            }
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<Grants>().close_window(window.label());
                let app = window.app_handle();
                let windows = app.webview_windows();
                if last_editor_closed(window.label(), windows.keys().map(String::as_str))
                    && let Some(settings) = windows.get(SETTINGS_WINDOW)
                {
                    let _ = settings.close();
                }
            }
        })
        .manage(Watchers::default())
        .manage(PendingFiles(Mutex::new(initial)))
        .invoke_handler(tauri::generate_handler![
            quit_app,
            open_file,
            save_file,
            create_file,
            watch,
            unwatch,
            new_window,
            take_pending_files,
            open_dialog,
            save_dialog,
            bench_mark,
            get_settings,
            set_settings,
            about,
            open_link,
            open_settings
        ])
        .build(tauri::generate_context!())
        .expect("error while building Marky")
        .run(|_app, _event| {
            // macOS: "Open With" and a drop on the Dock icon.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned());
                add_pending(_app, paths.collect());
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder, mock_context, noop_assets};
    use tauri::webview::InvokeRequest;

    // A call as from JavaScript in the page: `invoke(cmd, args)`.
    fn invoke(
        window: &WebviewWindow<tauri::test::MockRuntime>,
        cmd: &str,
        args: serde_json::Value,
    ) -> Result<(), serde_json::Value> {
        get_ipc_response(
            window,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: InvokeBody::from(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .map(|_| ())
    }

    #[test]
    fn the_file_commands_reject_a_path_that_the_window_did_not_get() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("notes.md");
        std::fs::write(&file, "text\n").unwrap();
        let app = mock_builder()
            .manage(Grants::load(dir.path().join("grants.json")))
            .manage(Watchers::default())
            .invoke_handler(tauri::generate_handler![
                open_file,
                save_file,
                create_file,
                watch,
                unwatch
            ])
            .build(mock_context(noop_assets()))
            .unwrap();
        let main = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let other = WebviewWindowBuilder::new(&app, "window-2", Default::default())
            .build()
            .unwrap();
        let path = json!({ "path": file });
        let calls = [
            ("open_file", path.clone()),
            (
                "save_file",
                json!({ "path": file, "text": "new\n", "expectedVersion": "x" }),
            ),
            ("create_file", json!({ "path": file, "text": "new\n" })),
            ("watch", path.clone()),
            ("unwatch", path.clone()),
        ];
        for (cmd, args) in &calls {
            assert!(invoke(&main, cmd, args.clone()).is_err(), "{cmd}");
        }
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "text\n");

        app.state::<Grants>().grant("main", &file);
        assert!(invoke(&main, "open_file", path.clone()).is_ok());
        assert!(invoke(&main, "watch", path.clone()).is_ok());
        // The grant of the first window is not for the second window.
        for (cmd, args) in &calls {
            assert!(invoke(&other, cmd, args.clone()).is_err(), "{cmd}");
        }
    }

    #[test]
    fn only_web_and_mail_links_open() {
        assert!(openable_link("https://example.com/a?b=1").is_some());
        assert!(openable_link("http://example.com").is_some());
        assert!(openable_link("mailto:someone@example.com").is_some());
        assert!(openable_link("file:///etc/passwd").is_none());
        assert!(openable_link("javascript:alert(1)").is_none());
        assert!(openable_link("x-apple.systempreferences:com.apple.preference").is_none());
        assert!(openable_link("notes.md").is_none());
    }

    #[test]
    fn a_drop_opens_only_markdown_files() {
        assert!(is_markdown(Path::new("/home/user/notes.md")));
        assert!(is_markdown(Path::new("/home/user/README.MD")));
        assert!(is_markdown(Path::new("/home/user/todo.txt")));
        assert!(!is_markdown(Path::new("/home/user/photo.png")));
        assert!(!is_markdown(Path::new("/home/user/md")));
        assert!(!is_markdown(Path::new("/home/user")));
    }

    #[test]
    fn the_settings_window_closes_with_the_last_editor_window() {
        // The closed window can still be in the list, or not.
        assert!(last_editor_closed("main", ["main", "settings"]));
        assert!(last_editor_closed("main", ["settings"]));
        assert!(last_editor_closed("window-2", ["window-2"]));
        assert!(!last_editor_closed(
            "main",
            ["main", "window-2", "settings"]
        ));
        // Closing the settings window itself does nothing more.
        assert!(!last_editor_closed("settings", ["main", "settings"]));
        assert!(!last_editor_closed("settings", ["settings"]));
    }
}
