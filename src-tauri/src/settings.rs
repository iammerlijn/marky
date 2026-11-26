// App settings of the settings window, in settings.json in the app config folder. The backend
// owns them, because it sets the theme and handles Cmd+Q before a page loads.
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    // Ask before Cmd+Q quits Marky.
    pub warn_before_quit: bool,
    pub theme: Theme,
}

impl Default for Settings {
    fn default() -> Self {
        Self { warn_before_quit: true, theme: Theme::System }
    }
}

// System follows the operating system. The page reads the same value (src/app/theme.ts).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

// The appearance of the native windows: the title bar, the dialogs and, on macOS, the
// `prefers-color-scheme` of the web views.
pub fn native_theme(theme: Theme) -> Option<tauri::Theme> {
    match theme {
        Theme::System => None,
        Theme::Light => Some(tauri::Theme::Light),
        Theme::Dark => Some(tauri::Theme::Dark),
    }
}

// A missing or invalid file gives the defaults.
pub fn load(path: &Path) -> Settings {
    fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
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
        assert_eq!(load(&dir.path().join("settings.json")), Settings { warn_before_quit: true, theme: Theme::System });
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
        let settings = Settings { warn_before_quit: false, theme: Theme::Dark };
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), settings);
    }

    #[test]
    fn a_file_without_the_field_uses_the_default_for_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, "{}").unwrap();
        assert!(load(&path).warn_before_quit);
        assert_eq!(load(&path).theme, Theme::System);
    }

    #[test]
    fn the_theme_is_a_lowercase_word_in_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"warnBeforeQuit": false, "theme": "light"}"#).unwrap();
        assert_eq!(load(&path), Settings { warn_before_quit: false, theme: Theme::Light });
    }

    #[test]
    fn system_gives_no_native_theme() {
        assert_eq!(native_theme(Theme::System), None);
        assert_eq!(native_theme(Theme::Light), Some(tauri::Theme::Light));
        assert_eq!(native_theme(Theme::Dark), Some(tauri::Theme::Dark));
    }
}
