// Flatpak file-access check (test plan, section 8). Throwaway code.
// Does in the sandbox what the Marky backend will do: read, atomic save, watch.
// Prints one line for each check. run.sh changes the file on the host after READY.
use notify::{RecursiveMode, Watcher};
use std::ffi::CString;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn report(name: &str, result: Result<String, String>) {
    match result {
        Ok(detail) => println!("ok    {name}: {detail}"),
        Err(detail) => println!("FAIL  {name}: {detail}"),
    }
}

// The document portal stores the real path of the file in this attribute.
fn host_path(path: &Path) -> Result<String, String> {
    let c_path = CString::new(path.as_os_str().as_encoded_bytes()).unwrap();
    let name = CString::new("user.document-portal.host-path").unwrap();
    let mut buf = vec![0u8; 4096];
    let n = unsafe { libc::getxattr(c_path.as_ptr(), name.as_ptr(), buf.as_mut_ptr().cast(), buf.len()) };
    if n < 0 {
        return Err(format!("no attribute ({})", std::io::Error::last_os_error()));
    }
    Ok(String::from_utf8_lossy(&buf[..n as usize]).trim_end_matches('\0').to_string())
}

fn atomic_save(path: &Path, text: &str) -> Result<String, String> {
    let mode = fs::metadata(path).map_err(|e| e.to_string())?.permissions().mode();
    let tmp = path.with_file_name(format!(".{}.marky-tmp", path.file_name().unwrap().to_string_lossy()));
    fs::write(&tmp, text).map_err(|e| format!("write temp file: {e}"))?;
    fs::set_permissions(&tmp, fs::Permissions::from_mode(mode)).map_err(|e| format!("set mode: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename: {e}")
    })?;
    let after = fs::metadata(path).map_err(|e| e.to_string())?.permissions().mode();
    Ok(format!("mode {:o} -> {:o}", mode & 0o777, after & 0o777))
}

fn main() {
    let path = std::env::args().nth(1).expect("usage: flatpak-access <file>");
    let path = Path::new(&path);
    println!("path  {}", path.display());
    report("host path", host_path(path));

    let text = fs::read_to_string(path);
    report("read", text.as_ref().map(|t| format!("{} bytes", t.len())).map_err(|e| e.to_string()));
    let text = text.unwrap_or_default();

    report("atomic save", atomic_save(path, &format!("{text}saved by atomic save\n")));
    report("in-place save", fs::write(path, format!("{text}saved in place\n")).map(|_| "ok".into()).map_err(|e| e.to_string()));

    // Watch the folder, not the file: an atomic save of another app replaces the file.
    let (tx, rx) = mpsc::channel();
    // WATCH=poll: check the modification time at an interval, for paths where inotify sees nothing.
    let mut watcher: Box<dyn Watcher> = if std::env::var("WATCH").as_deref() == Ok("poll") {
        let config = notify::Config::default().with_poll_interval(Duration::from_millis(500)).with_compare_contents(false);
        Box::new(notify::PollWatcher::new(tx, config).expect("poll watcher"))
    } else {
        Box::new(notify::recommended_watcher(tx).expect("watcher"))
    };
    let dir = path.parent().unwrap();
    report("watch folder", watcher.watch(dir, RecursiveMode::NonRecursive).map(|_| dir.display().to_string()).map_err(|e| e.to_string()));
    report("watch file", watcher.watch(path, RecursiveMode::NonRecursive).map(|_| "ok".into()).map_err(|e| e.to_string()));

    println!("READY");
    let end = Instant::now() + Duration::from_secs(6);
    let mut events = Vec::new();
    while let Some(left) = end.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(Ok(event)) if event.paths.iter().any(|p| p.file_name() == path.file_name()) => {
                events.push(format!("{:?}", event.kind))
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    report(
        "external change events",
        if events.is_empty() { Err("no events".into()) } else { Ok(format!("{} events: {}", events.len(), events.join(", "))) },
    );
    report("read after external change", fs::read_to_string(path).map(|t| t.lines().last().unwrap_or("").to_string()).map_err(|e| e.to_string()));
}
