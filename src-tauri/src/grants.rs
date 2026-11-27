// The paths that the user gave to a window: with the open or save dialog, on the command line,
// with "Open With" or with a drop. The file commands accept only these paths, so that a script
// in the page cannot read or write other files (issue 59).
//
// The grants of a window are only for that window, and they go when the window closes.
//
// The session and the Recent list open files again without a dialog, so the backend keeps the
// newest granted paths in a file. The rule for these kept paths: at start, Marky reads the file,
// and any window can open a path from it; the open then grants the path to that window. A grant
// during the run goes into the file only for the next start, so that one window cannot open the
// files of another window. A Recent file from another window then opens with the open dialog.
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

// More than the Recent list (8) and the tabs of a usual session.
const KEPT: usize = 100;

pub struct Grants {
    file: PathBuf,
    state: Mutex<State>,
}

struct State {
    windows: HashMap<String, HashSet<PathBuf>>,
    // From the file at start.
    kept: HashSet<PathBuf>,
    // For the file: the kept paths and the grants of this run, the newest first.
    newest: Vec<PathBuf>,
}

pub fn not_granted(path: &Path) -> String {
    format!("Marky has no permission for {}", path.display())
}

impl Grants {
    pub fn load(file: PathBuf) -> Self {
        let newest: Vec<PathBuf> = std::fs::read_to_string(&file)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Grants {
            file,
            state: Mutex::new(State {
                windows: HashMap::new(),
                kept: newest.iter().cloned().collect(),
                newest,
            }),
        }
    }

    pub fn grant(&self, window: &str, path: &Path) {
        let mut state = self.state.lock().unwrap();
        state
            .windows
            .entry(window.to_string())
            .or_default()
            .insert(path.to_path_buf());
        state.newest.retain(|p| p != path);
        state.newest.insert(0, path.to_path_buf());
        state.newest.truncate(KEPT);
        // A failed write loses only the new grants for the next start. The write goes to a
        // temporary file first, so that a stop during the write keeps the old file. The lock
        // is held, so no other grant writes the same temporary file.
        if let Ok(text) = serde_json::to_string(&state.newest) {
            if let Some(folder) = self.file.parent() {
                let _ = std::fs::create_dir_all(folder);
            }
            let temp = self.file.with_extension("json.tmp");
            if std::fs::write(&temp, text).is_ok() {
                let _ = std::fs::rename(&temp, &self.file);
            }
        }
    }

    pub fn check(&self, window: &str, path: &Path) -> Result<(), String> {
        let state = self.state.lock().unwrap();
        match state.windows.get(window) {
            Some(paths) if paths.contains(path) => Ok(()),
            _ => Err(not_granted(path)),
        }
    }

    // For an open: a path of the window, or a kept path, which then becomes a path of the window.
    pub fn check_open(&self, window: &str, path: &Path) -> Result<(), String> {
        if self.check(window, path).is_ok() {
            return Ok(());
        }
        if !self.state.lock().unwrap().kept.contains(path) {
            return Err(not_granted(path));
        }
        self.grant(window, path);
        Ok(())
    }

    pub fn close_window(&self, window: &str) {
        self.state.lock().unwrap().windows.remove(window);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grants(dir: &tempfile::TempDir) -> Grants {
        Grants::load(dir.path().join("grants.json"))
    }

    #[test]
    fn a_path_is_rejected_until_it_is_granted() {
        let dir = tempfile::tempdir().unwrap();
        let grants = grants(&dir);
        let path = Path::new("/home/user/notes.md");
        assert!(grants.check("main", path).is_err());
        assert!(grants.check_open("main", path).is_err());
        grants.grant("main", path);
        assert!(grants.check("main", path).is_ok());
        assert!(grants.check_open("main", path).is_ok());
    }

    #[test]
    fn only_the_exact_path_is_granted() {
        let dir = tempfile::tempdir().unwrap();
        let grants = grants(&dir);
        grants.grant("main", Path::new("/home/user/notes.md"));
        for other in [
            "/home/user/other.md",
            "/home/user",
            "/home/user/notes.md/x",
            "/home/user/../user/notes.md",
            "/etc/passwd",
        ] {
            assert!(grants.check("main", Path::new(other)).is_err(), "{other}");
        }
    }

    #[test]
    fn a_window_cannot_use_the_grant_of_another_window() {
        let dir = tempfile::tempdir().unwrap();
        let grants = grants(&dir);
        let path = Path::new("/home/user/notes.md");
        grants.grant("main", path);
        assert!(grants.check("window-2", path).is_err());
        assert!(grants.check_open("window-2", path).is_err());
    }

    #[test]
    fn the_grants_of_a_window_go_when_it_closes() {
        let dir = tempfile::tempdir().unwrap();
        let grants = grants(&dir);
        let path = Path::new("/home/user/notes.md");
        grants.grant("window-2", path);
        grants.close_window("window-2");
        assert!(grants.check("window-2", path).is_err());
    }

    #[test]
    fn a_kept_path_opens_again_after_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = Path::new("/home/user/notes.md");
        grants(&dir).grant("main", path);
        let restarted = grants(&dir);
        // Only an open gives the window the path: a save needs that open first.
        assert!(restarted.check("main", path).is_err());
        assert!(restarted.check_open("main", path).is_ok());
        assert!(restarted.check("main", path).is_ok());
        assert!(
            restarted
                .check_open("main", Path::new("/etc/passwd"))
                .is_err()
        );
    }

    #[test]
    fn only_the_newest_paths_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        let grants = grants(&dir);
        for i in 0..=KEPT {
            grants.grant("main", Path::new(&format!("/notes/{i}.md")));
        }
        let restarted = Grants::load(dir.path().join("grants.json"));
        assert!(
            restarted
                .check_open("main", Path::new("/notes/0.md"))
                .is_err()
        );
        assert!(
            restarted
                .check_open("main", Path::new("/notes/1.md"))
                .is_ok()
        );
        assert!(
            restarted
                .check_open("main", Path::new(&format!("/notes/{KEPT}.md")))
                .is_ok()
        );
    }

    #[test]
    fn a_grant_replaces_the_file_and_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let grants = grants(&dir);
        grants.grant("main", Path::new("/notes/a.md"));
        grants.grant("main", Path::new("/notes/b.md"));
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, ["grants.json"]);
        let restarted = Grants::load(dir.path().join("grants.json"));
        assert!(
            restarted
                .check_open("main", Path::new("/notes/a.md"))
                .is_ok()
        );
    }

    #[test]
    fn a_bad_grants_file_keeps_no_paths() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("grants.json"), "not json").unwrap();
        let grants = grants(&dir);
        assert!(grants.check_open("main", Path::new("/notes/a.md")).is_err());
    }
}
