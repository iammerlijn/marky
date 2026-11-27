// App settings that the menu changes, in settings.json in the app config folder. The backend
// owns them, because it builds the menu at start, before the page loads.
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    // Ask before Cmd+Q quits Marky.
    pub warn_before_quit: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            warn_before_quit: true,
        }
    }
}

// A missing or invalid file gives the defaults.
pub fn load(path: &Path) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, settings: &Settings) -> std::io::Result<()> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    fs::write(path, serde_json::to_string_pretty(settings)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_file_gives_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            load(&dir.path().join("settings.json")),
            Settings {
                warn_before_quit: true
            }
        );
    }

    #[test]
    fn an_invalid_file_gives_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, "not json").unwrap();
        assert_eq!(load(&path), Settings::default());
    }

    #[test]
    fn a_saved_setting_loads_again() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config/settings.json");
        save(
            &path,
            &Settings {
                warn_before_quit: false,
            },
        )
        .unwrap();
        assert_eq!(
            load(&path),
            Settings {
                warn_before_quit: false
            }
        );
    }

    #[test]
    fn a_file_without_the_field_uses_the_default_for_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, "{}").unwrap();
        assert!(load(&path).warn_before_quit);
    }
}
