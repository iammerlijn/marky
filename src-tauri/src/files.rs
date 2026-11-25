// Open and save (design document, section 4.1).
use serde::Serialize;
use std::fs::{self, File};
use std::hash::{DefaultHasher, Hasher};
use std::io::{ErrorKind, Write};
use std::path::Path;

#[derive(Debug, Serialize, PartialEq)]
pub struct Opened {
    pub text: String,
    pub version: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", content = "message")]
pub enum SaveError {
    // The file changed on disk after the last read or save.
    Conflict,
    Io(String),
}

// A hash of the content of the file. When the version changes, the file changed on disk.
// The modification time is not used: other apps can keep it, and some file systems store it
// in full seconds. The hash is the same for each run of the same build of Marky.
pub fn version_of(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    hasher.write(bytes);
    format!("{:016x}-{}", hasher.finish(), bytes.len())
}

pub fn version(path: &Path) -> std::io::Result<String> {
    fs::read(path).map(|bytes| version_of(&bytes))
}

pub fn open(path: &Path) -> Result<Opened, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    // The version of the bytes that were read, not of the file a moment later.
    let version = version_of(&bytes);
    let text = String::from_utf8(bytes).map_err(|_| "The file is not UTF-8 text.".to_string())?;
    Ok(Opened { text, version })
}

pub fn save(path: &Path, text: &str, expected_version: &str) -> Result<String, SaveError> {
    let io = |e: std::io::Error| SaveError::Io(e.to_string());
    // Write to the target of a symlink, so that the link stays.
    let target = match fs::canonicalize(path) {
        Ok(target) => target,
        Err(e) if e.kind() == ErrorKind::NotFound => return Err(SaveError::Conflict),
        Err(e) => return Err(io(e)),
    };
    if version(&target).map_err(io)? != expected_version {
        return Err(SaveError::Conflict);
    }
    let permissions = fs::metadata(&target).map_err(io)?.permissions();
    write_atomic(&target, text, Some(permissions)).map_err(io)?;
    version(&target).map_err(io)
}

// Save As: write a new file, or replace a file that the user chose in the save dialog.
pub fn create(path: &Path, text: &str) -> Result<String, String> {
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let permissions = fs::metadata(&target).ok().map(|m| m.permissions());
    write_atomic(&target, text, permissions).map_err(|e| e.to_string())?;
    version(&target).map_err(|e| e.to_string())
}

// Atomic write: write a temporary file next to the file, then rename it over the file.
// A crash leaves the old file or the new file, never half of a file.
fn write_atomic(target: &Path, text: &str, permissions: Option<fs::Permissions>) -> std::io::Result<()> {
    let dir = target.parent().expect("a file has a parent folder");
    let name = target.file_name().expect("a file has a name").to_string_lossy();
    let temp = dir.join(format!(".{name}.marky-{}.tmp", std::process::id()));
    let written = (|| {
        let mut file = File::create_new(&temp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        if let Some(permissions) = permissions {
            fs::set_permissions(&temp, permissions)?;
        }
        fs::rename(&temp, target)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temp);
        return written;
    }
    // Make the rename durable.
    if let Ok(folder) = File::open(dir) {
        let _ = folder.sync_all();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::{symlink, PermissionsExt};

    fn file(dir: &tempfile::TempDir, name: &str, text: &str) -> std::path::PathBuf {
        let path = dir.path().join(name);
        fs::write(&path, text).unwrap();
        path
    }

    #[test]
    fn open_returns_text_and_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "a.md", "# Title\n");
        let opened = open(&path).unwrap();
        assert_eq!(opened.text, "# Title\n");
        assert_eq!(opened.version, version(&path).unwrap());
    }

    #[test]
    fn save_stops_with_a_conflict_when_another_app_keeps_the_size_and_the_modification_time() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "a.md", "aaaa");
        let opened = open(&path).unwrap();
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        fs::write(&path, "bbbb").unwrap();
        File::options().write(true).open(&path).unwrap().set_modified(modified).unwrap();
        assert_eq!(save(&path, "mine", &opened.version), Err(SaveError::Conflict));
        assert_eq!(fs::read_to_string(&path).unwrap(), "bbbb");
    }

    #[test]
    fn open_refuses_a_file_that_is_not_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("latin1.md");
        fs::write(&path, b"caf\xe9\n").unwrap();
        assert!(open(&path).unwrap_err().contains("UTF-8"));
        assert_eq!(fs::read(&path).unwrap(), b"caf\xe9\n");
    }

    #[test]
    fn save_writes_the_text_and_returns_the_new_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "a.md", "old\n");
        let opened = open(&path).unwrap();
        let new_version = save(&path, "new\n", &opened.version).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new\n");
        assert_eq!(new_version, version(&path).unwrap());
    }

    #[test]
    fn save_stops_with_a_conflict_when_the_file_changed_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "a.md", "old\n");
        let opened = open(&path).unwrap();
        fs::write(&path, "changed by another app, longer\n").unwrap();
        assert_eq!(save(&path, "mine\n", &opened.version), Err(SaveError::Conflict));
        assert_eq!(fs::read_to_string(&path).unwrap(), "changed by another app, longer\n");
    }

    #[test]
    fn save_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "a.md", "old\n");
        save(&path, "new\n", &open(&path).unwrap().version).unwrap();
        let names: Vec<_> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec!["a.md"]);
    }

    #[test]
    fn save_keeps_the_file_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "a.md", "old\n");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        save(&path, "new\n", &open(&path).unwrap().version).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o640);
    }

    #[test]
    fn save_through_a_symlink_writes_the_target_and_keeps_the_link() {
        let dir = tempfile::tempdir().unwrap();
        let target = file(&dir, "target.md", "old\n");
        let link = dir.path().join("link.md");
        symlink(&target, &link).unwrap();
        save(&link, "new\n", &open(&link).unwrap().version).unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&target).unwrap(), "new\n");
    }

    #[test]
    fn save_to_a_read_only_folder_fails_and_keeps_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "a.md", "old\n");
        let opened = open(&path).unwrap();
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o555)).unwrap();
        let result = save(&path, "new\n", &opened.version);
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(result, Err(SaveError::Io(_))));
        assert_eq!(fs::read_to_string(&path).unwrap(), "old\n");
    }

    #[test]
    fn save_of_a_deleted_file_is_a_conflict_and_does_not_create_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "a.md", "old\n");
        let opened = open(&path).unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(save(&path, "new\n", &opened.version), Err(SaveError::Conflict));
        assert!(!path.exists());
    }

    #[test]
    fn create_writes_a_new_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new.md");
        let version = create(&path, "# New\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "# New\n");
        assert_eq!(version, super::version(&path).unwrap());
        let names: Vec<_> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec!["new.md"]);
    }

    #[test]
    fn create_replaces_a_chosen_file_and_keeps_its_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "old.md", "old\n");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        create(&path, "new\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new\n");
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn create_in_a_missing_folder_fails() {
        let dir = tempfile::tempdir().unwrap();
        assert!(create(&dir.path().join("missing/new.md"), "x").is_err());
    }
}
