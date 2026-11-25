// File watch (design document, sections 4.1 and 4.3).
use crate::files;
use notify::{Config, Event, EventKind, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct Changed {
    path: String,
    // None when the file is deleted or renamed.
    version: Option<String>,
}

#[derive(Default)]
pub struct Watchers(Mutex<HashMap<(String, String), Box<dyn Watcher + Send>>>);

// The Flatpak document portal sends no inotify events for changes by other apps.
fn is_portal(path: &Path) -> bool {
    path.starts_with("/run/user") && path.components().any(|c| c.as_os_str() == "doc")
}

// Sends `file-changed` to the window with the version on disk. The frontend ignores a version
// that it saved itself. Each window has its own watchers, so that one window cannot stop
// the watch of another window.
pub fn watch(app: AppHandle, watchers: &Watchers, window: &str, path: String) -> notify::Result<()> {
    let target = std::fs::canonicalize(&path)?;
    let name = target.file_name().map(|n| n.to_owned());
    let (reported, file, label) = (path.clone(), target.clone(), window.to_string());
    let handler = move |result: notify::Result<Event>| {
        let Ok(event) = result else { return };
        if matches!(event.kind, EventKind::Access(_)) || !event.paths.iter().any(|p| p.file_name() == name.as_deref()) {
            return;
        }
        let _ = app.emit_to(&label, "file-changed", Changed { path: reported.clone(), version: files::version(&file).ok() });
    };
    let mut watcher: Box<dyn Watcher + Send> = if is_portal(&target) {
        Box::new(PollWatcher::new(handler, Config::default().with_poll_interval(Duration::from_secs(1)))?)
    } else {
        Box::new(RecommendedWatcher::new(handler, Config::default())?)
    };
    // Watch the folder, not the file: an atomic save by another app replaces the file.
    let folder: PathBuf = target.parent().expect("a file has a parent folder").into();
    watcher.watch(&folder, RecursiveMode::NonRecursive)?;
    watchers.0.lock().unwrap().insert((window.to_string(), path), watcher);
    Ok(())
}

pub fn unwatch(watchers: &Watchers, window: &str, path: &str) {
    watchers.0.lock().unwrap().remove(&(window.to_string(), path.to_string()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portal_paths_use_polling() {
        assert!(is_portal(Path::new("/run/user/1000/doc/q_751ynALPcQE3i7xXCTeQ/test.md")));
        assert!(!is_portal(Path::new("/home/user/doc/test.md")));
        assert!(!is_portal(Path::new("/run/user/1000/test.md")));
    }
}
