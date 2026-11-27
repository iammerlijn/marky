// The macOS menu bar. The default menu of Tauri has "Close Window" on Cmd+W, but in Marky
// Cmd+W closes the tab. The File items send the same actions as the shortcuts in the page.
// Linux has no menu bar: the page handles Ctrl+O, Ctrl+S and the other shortcuts.
use tauri::menu::{CheckMenuItem, Menu, MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub const ACTIONS: [(&str, &str, &str); 6] = [
    ("new-tab", "New Tab", "CmdOrCtrl+T"),
    ("new-window", "New Window", "CmdOrCtrl+N"),
    ("open", "Open…", "CmdOrCtrl+O"),
    ("save", "Save", "CmdOrCtrl+S"),
    ("close-tab", "Close Tab", "CmdOrCtrl+W"),
    ("toggle-raw", "Markdown Source", "CmdOrCtrl+Shift+M"),
];

// The Go menu. The page also handles the other shortcuts for these actions (src/app/keys.ts).
pub const GO: [(&str, &str, &str); 4] = [
    ("back", "Back", "CmdOrCtrl+["),
    ("forward", "Forward", "CmdOrCtrl+]"),
    ("previous-tab", "Previous Tab", "CmdOrCtrl+Alt+Left"),
    ("next-tab", "Next Tab", "CmdOrCtrl+Alt+Right"),
];

pub const QUIT: &str = "quit";
pub const WARN_BEFORE_QUIT: &str = "warn-before-quit";

pub fn build<R: Runtime>(app: &AppHandle<R>, warn_before_quit: bool) -> tauri::Result<Menu<R>> {
    let warn = CheckMenuItem::with_id(
        app,
        WARN_BEFORE_QUIT,
        "Warn Before Quitting",
        true,
        warn_before_quit,
        None::<&str>,
    )?;
    // Not the default quit item: it ends the app at once, without the unsaved-changes check of
    // the windows. See quit() in lib.rs.
    let quit = MenuItem::with_id(app, QUIT, "Quit Marky", true, Some("CmdOrCtrl+Q"))?;
    let marky = SubmenuBuilder::new(app, "Marky")
        .about(None)
        .separator()
        .item(&warn)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;
    let mut file = SubmenuBuilder::new(app, "File");
    for (id, label, accelerator) in ACTIONS {
        file = file.item(&MenuItem::with_id(app, id, label, true, Some(accelerator))?);
    }
    let mut go = SubmenuBuilder::new(app, "Go");
    for (id, label, accelerator) in GO {
        go = go.item(&MenuItem::with_id(app, id, label, true, Some(accelerator))?);
    }
    // Undo and Redo stay out: the editor handles Cmd+Z itself.
    let edit = SubmenuBuilder::new(app, "Edit")
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .fullscreen()
        .build()?;
    MenuBuilder::new(app)
        .items(&[&marky, &file.build()?, &edit, &go.build()?, &window])
        .build()
}

#[cfg(test)]
mod tests {
    // On macOS, muda can make menu items only on the main thread, and `cargo test` runs each
    // test on another thread (also with --test-threads=1). The macOS app builds the menu on the
    // main thread in `setup`.
    #[test]
    #[cfg_attr(
        target_os = "macos",
        ignore = "muda makes macOS menu items only on the main thread"
    )]
    fn the_menu_builds_with_the_saved_quit_setting() {
        let app = tauri::test::mock_app();
        for warn in [true, false] {
            let menu = super::build(app.handle(), warn).unwrap();
            assert_eq!(menu.items().unwrap().len(), 5);
            let go = menu.items().unwrap()[3].as_submenu().unwrap().clone();
            assert_eq!(go.text().unwrap(), "Go");
            for (id, _, _) in super::GO {
                assert!(go.get(id).is_some());
            }
            let marky = menu.items().unwrap()[0].as_submenu().unwrap().clone();
            let item = marky.get(super::WARN_BEFORE_QUIT).unwrap();
            assert_eq!(
                item.as_check_menuitem().unwrap().is_checked().unwrap(),
                warn
            );
            assert!(marky.get(super::QUIT).is_some());
        }
    }

    #[test]
    fn each_action_has_a_unique_id_and_shortcut() {
        let all: Vec<_> = super::ACTIONS.iter().chain(super::GO.iter()).collect();
        let ids: std::collections::HashSet<_> = all.iter().map(|(id, _, _)| id).collect();
        let keys: std::collections::HashSet<_> = all.iter().map(|(_, _, key)| key).collect();
        assert_eq!(ids.len(), all.len());
        assert_eq!(keys.len(), all.len());
    }
}
