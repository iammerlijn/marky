// The macOS menu bar. The default menu of Tauri has "Close Window" on Cmd+W, but in Marky
// Cmd+W closes the tab. The File items send the same actions as the shortcuts in the page.
// Linux has no menu bar: the page handles Ctrl+O, Ctrl+S and the other shortcuts.
use tauri::menu::{Menu, MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

pub const ACTIONS: [(&str, &str, &str); 6] = [
    ("new-tab", "New Tab", "CmdOrCtrl+T"),
    ("new-window", "New Window", "CmdOrCtrl+N"),
    ("open", "Open…", "CmdOrCtrl+O"),
    ("save", "Save", "CmdOrCtrl+S"),
    ("close-tab", "Close Tab", "CmdOrCtrl+W"),
    ("toggle-raw", "Markdown Source", "CmdOrCtrl+Shift+M"),
];

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let marky = SubmenuBuilder::new(app, "Marky")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let mut file = SubmenuBuilder::new(app, "File");
    for (id, label, accelerator) in ACTIONS {
        file = file.item(&MenuItem::with_id(app, id, label, true, Some(accelerator))?);
    }
    // Undo and Redo stay out: the editor handles Cmd+Z itself.
    let edit = SubmenuBuilder::new(app, "Edit").cut().copy().paste().select_all().build()?;
    let window = SubmenuBuilder::new(app, "Window").minimize().fullscreen().build()?;
    MenuBuilder::new(app).items(&[&marky, &file.build()?, &edit, &window]).build()
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_menu_builds() {
        let app = tauri::test::mock_app();
        let menu = super::build(app.handle()).unwrap();
        assert_eq!(menu.items().unwrap().len(), 4);
    }
}
