// Open and save (design document, section 4.1).
use serde::Serialize;
use std::fs::{self, File};
use std::hash::{DefaultHasher, Hasher};
use std::ffi::CString;
use std::io::{ErrorKind, Write};
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

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
    let temp = write_temp(&target, text, true).map_err(io)?;
    let replaced = replace_if_unchanged(&temp, &target, expected_version);
    // After a swap, the temporary path has the old file, or Marky's text after a conflict.
    let _ = fs::remove_file(&temp);
    replaced?;
    sync_folder(&target);
    Ok(version_of(text.as_bytes()))
}

// Save As: write a new file, or replace a file that the user chose in the save dialog.
pub fn create(path: &Path, text: &str) -> Result<String, String> {
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let temp = write_temp(&target, text, target.exists()).map_err(|e| e.to_string())?;
    if let Err(e) = fs::rename(&temp, &target) {
        let _ = fs::remove_file(&temp);
        return Err(e.to_string());
    }
    sync_folder(&target);
    Ok(version_of(text.as_bytes()))
}

// Atomic write: write a temporary file next to the file, then rename it over the file.
// A crash leaves the old file or the new file, never half of a file. With `replaces`, the
// temporary file gets the owner, permissions and extended attributes of the file.
fn write_temp(target: &Path, text: &str, replaces: bool) -> std::io::Result<PathBuf> {
    let dir = target.parent().expect("a file has a parent folder");
    let name = target.file_name().expect("a file has a name").to_string_lossy();
    if replaces && !writable(target) {
        return Err(std::io::Error::new(ErrorKind::PermissionDenied, "The file is read-only."));
    }
    let temp = dir.join(format!(".{name}.marky-{}.tmp", std::process::id()));
    let written = (|| {
        let mut file = File::create_new(&temp)?;
        file.write_all(text.as_bytes())?;
        if replaces {
            copy_metadata(target, &file)?;
        }
        file.sync_all()
    })();
    match written {
        Ok(()) => Ok(temp),
        Err(e) => {
            let _ = fs::remove_file(&temp);
            Err(e)
        }
    }
}

// Another app can replace the file after the version check. Swap the two files in one step,
// then check the file that came out: if it is not the expected version, swap back. A file
// system that cannot swap gets a second check just before a usual rename.
fn replace_if_unchanged(temp: &Path, target: &Path, expected_version: &str) -> Result<(), SaveError> {
    let io = |e: std::io::Error| SaveError::Io(e.to_string());
    match exchange(temp, target) {
        Ok(()) => {
            if version(temp).ok().as_deref() == Some(expected_version) {
                return Ok(());
            }
            exchange(temp, target).map_err(io)?;
            Err(SaveError::Conflict)
        }
        Err(e) if matches!(e.raw_os_error(), Some(libc::EINVAL | libc::ENOSYS | libc::ENOTSUP)) || e.kind() == ErrorKind::Unsupported => {
            if version(target).map_err(io)? != expected_version {
                return Err(SaveError::Conflict);
            }
            fs::rename(temp, target).map_err(io)
        }
        Err(e) => Err(io(e)),
    }
}

fn c_path(path: &Path) -> std::io::Result<CString> {
    CString::new(path.as_os_str().as_bytes()).map_err(|_| ErrorKind::InvalidInput.into())
}

fn check(result: libc::c_int) -> std::io::Result<()> {
    if result == 0 { Ok(()) } else { Err(std::io::Error::last_os_error()) }
}

#[cfg(target_os = "linux")]
fn exchange(a: &Path, b: &Path) -> std::io::Result<()> {
    let (a, b) = (c_path(a)?, c_path(b)?);
    check(unsafe { libc::renameat2(libc::AT_FDCWD, a.as_ptr(), libc::AT_FDCWD, b.as_ptr(), libc::RENAME_EXCHANGE) })
}

#[cfg(target_os = "macos")]
fn exchange(a: &Path, b: &Path) -> std::io::Result<()> {
    let (a, b) = (c_path(a)?, c_path(b)?);
    check(unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_SWAP) })
}

// The write permission of the user. On Unix, a rename can replace a read-only file.
fn writable(path: &Path) -> bool {
    c_path(path).is_ok_and(|p| unsafe { libc::access(p.as_ptr(), libc::W_OK) } == 0)
}

// The owner, the permissions and the extended attributes (macOS Finder tags, Linux ACLs and
// SELinux labels) of the old file. An attribute that the user cannot set is not copied.
fn copy_metadata(from: &Path, to: &File) -> std::io::Result<()> {
    let metadata = fs::metadata(from)?;
    let own = to.metadata()?;
    if (metadata.uid(), metadata.gid()) != (own.uid(), own.gid()) {
        std::os::unix::fs::fchown(to, Some(metadata.uid()), Some(metadata.gid()))
            .map_err(|_| std::io::Error::new(ErrorKind::PermissionDenied, "Marky cannot keep the owner of the file."))?;
    }
    to.set_permissions(metadata.permissions())?;
    copy_attributes(from, to);
    Ok(())
}

#[cfg(target_os = "linux")]
fn copy_attributes(from: &Path, to: &File) {
    // The size first, then the bytes.
    fn bytes(get: impl Fn(*mut libc::c_void, usize) -> isize) -> Option<Vec<u8>> {
        let mut buffer = vec![0; usize::try_from(get(std::ptr::null_mut(), 0)).ok()?];
        let size = usize::try_from(get(buffer.as_mut_ptr().cast(), buffer.len())).ok()?;
        buffer.truncate(size);
        Some(buffer)
    }
    let Ok(from) = c_path(from) else { return };
    let Some(names) = bytes(|p, n| unsafe { libc::listxattr(from.as_ptr(), p.cast(), n) }) else { return };
    for name in names.split(|&b| b == 0).filter(|n| !n.is_empty()) {
        let Ok(name) = CString::new(name) else { continue };
        if let Some(value) = bytes(|p, n| unsafe { libc::getxattr(from.as_ptr(), name.as_ptr(), p, n) }) {
            unsafe { libc::fsetxattr(to.as_raw_fd(), name.as_ptr(), value.as_ptr().cast(), value.len(), 0) };
        }
    }
}

#[cfg(target_os = "macos")]
fn copy_attributes(from: &Path, to: &File) {
    let Ok(from) = File::open(from) else { return };
    let flags = libc::COPYFILE_ACL | libc::COPYFILE_XATTR;
    unsafe { libc::fcopyfile(from.as_raw_fd(), to.as_raw_fd(), std::ptr::null_mut(), flags) };
}

// Make the rename durable.
fn sync_folder(target: &Path) {
    if let Ok(folder) = File::open(target.parent().expect("a file has a parent folder")) {
        let _ = folder.sync_all();
    }
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
    fn a_change_by_another_app_just_before_the_rename_is_a_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "a.md", "theirs\n");
        let temp = file(&dir, "temp", "mine\n");
        let expected = version_of(b"old\n");
        assert_eq!(replace_if_unchanged(&temp, &path, &expected), Err(SaveError::Conflict));
        assert_eq!(fs::read_to_string(&path).unwrap(), "theirs\n");
    }

    #[test]
    fn save_refuses_a_read_only_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "a.md", "old\n");
        let opened = open(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        assert!(matches!(save(&path, "new\n", &opened.version), Err(SaveError::Io(m)) if m.contains("read-only")));
        assert_eq!(fs::read_to_string(&path).unwrap(), "old\n");
    }

    #[test]
    fn save_keeps_the_extended_attributes() {
        let dir = tempfile::tempdir_in(env!("CARGO_MANIFEST_DIR")).unwrap();
        let path = file(&dir, "a.md", "old\n");
        let (c, name) = (c_path(&path).unwrap(), CString::new("user.marky-test").unwrap());
        assert_eq!(unsafe { set_attribute(&c, &name, b"value") }, 0, "the file system has no extended attributes");
        save(&path, "new\n", &open(&path).unwrap().version).unwrap();
        let mut value = [0u8; 16];
        let size = unsafe { get_attribute(&c, &name, &mut value) };
        assert_eq!(&value[..size.max(0) as usize], b"value");
    }

    #[cfg(target_os = "linux")]
    unsafe fn set_attribute(path: &CString, name: &CString, value: &[u8]) -> i32 {
        unsafe { libc::setxattr(path.as_ptr(), name.as_ptr(), value.as_ptr().cast(), value.len(), 0) }
    }

    #[cfg(target_os = "linux")]
    unsafe fn get_attribute(path: &CString, name: &CString, value: &mut [u8]) -> isize {
        unsafe { libc::getxattr(path.as_ptr(), name.as_ptr(), value.as_mut_ptr().cast(), value.len()) }
    }

    #[cfg(target_os = "macos")]
    unsafe fn set_attribute(path: &CString, name: &CString, value: &[u8]) -> i32 {
        unsafe { libc::setxattr(path.as_ptr(), name.as_ptr(), value.as_ptr().cast(), value.len(), 0, 0) }
    }

    #[cfg(target_os = "macos")]
    unsafe fn get_attribute(path: &CString, name: &CString, value: &mut [u8]) -> isize {
        unsafe { libc::getxattr(path.as_ptr(), name.as_ptr(), value.as_mut_ptr().cast(), value.len(), 0, 0) }
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
