// The information of "About Marky": the macOS About panel (menu.rs) and, on Linux, the About
// section of the settings window (src/app/Settings.svelte).
use serde::Serialize;

pub const COPYRIGHT: &str = "Copyright © 2026 iammerlijn";
pub const LICENSE: &str = "GPL-3.0";
pub const REPOSITORY: &str = "https://github.com/iammerlijn/marky";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct About {
    pub name: String,
    pub version: String,
    pub copyright: String,
    pub license: String,
    pub repository: String,
}

// The name and the version come from tauri.conf.json.
pub fn about(package: &tauri::PackageInfo) -> About {
    About {
        name: package.name.clone(),
        version: package.version.to_string(),
        copyright: COPYRIGHT.into(),
        license: LICENSE.into(),
        repository: REPOSITORY.into(),
    }
}

// macOS shows only the name, the version, the copyright, the credits and the icon (the app
// icon when it is not set). So the license and the links go in the credits.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn metadata(about: About) -> tauri::menu::AboutMetadata<'static> {
    let credits = format!(
        "License: {}\nSource code: {}\nReport a problem: {}/issues",
        about.license, about.repository, about.repository
    );
    tauri::menu::AboutMetadata {
        name: Some(about.name),
        version: Some(about.version),
        copyright: Some(about.copyright),
        credits: Some(credits),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> About {
        About {
            name: "Marky".into(),
            version: "1.2.3".into(),
            copyright: COPYRIGHT.into(),
            license: LICENSE.into(),
            repository: REPOSITORY.into(),
        }
    }

    #[test]
    fn the_about_panel_has_the_version_the_copyright_the_license_and_the_links() {
        let metadata = metadata(sample());
        assert_eq!(metadata.name.as_deref(), Some("Marky"));
        assert_eq!(metadata.version.as_deref(), Some("1.2.3"));
        assert_eq!(metadata.copyright.as_deref(), Some(COPYRIGHT));
        let credits = metadata.credits.unwrap();
        assert!(credits.contains("License: GPL-3.0"));
        assert!(credits.contains("https://github.com/iammerlijn/marky\n"));
        assert!(credits.contains("https://github.com/iammerlijn/marky/issues"));
    }
}
