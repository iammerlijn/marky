// macOS: at start, look for a newer release (the `latest.json` of the GitHub releases, see
// tauri.conf.json). When there is one, ask the user, then download and install it. The plugin
// checks the update with the public key in tauri.conf.json, not with an Apple signature.
// Marky does not restart: windows can have unsaved changes. The new version opens at the next start.
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

pub fn check_in_background(app: &AppHandle) {
    // A dev build has no release to compare with.
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Offline, or no release: no message.
        if let Err(error) = check(&app).await {
            eprintln!("marky: update check failed: {error}");
        }
    });
}

async fn check(app: &AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };
    let install = app
        .dialog()
        .message(format!(
            "Marky {} is available. You have {}.\n\nMarky uses the new version the next time it starts.",
            update.version, update.current_version
        ))
        .title("Update Marky")
        .buttons(MessageDialogButtons::OkCancelCustom("Install".into(), "Later".into()))
        .blocking_show();
    if !install {
        return Ok(());
    }
    if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
        app.dialog()
            .message(format!("Marky could not install the update.\n\n{error}"))
            .kind(MessageDialogKind::Error)
            .blocking_show();
        return Err(error);
    }
    Ok(())
}
