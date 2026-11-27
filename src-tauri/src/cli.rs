// Files from the command line and from "open with": `marky notes.md`.
use std::path::Path;

pub fn files(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .map(|arg| cwd.join(arg).to_string_lossy().into_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths_become_absolute_and_options_are_skipped() {
        let args = ["marky", "notes.md", "--verbose", "/tmp/b.md"].map(String::from);
        assert_eq!(
            files(args, Path::new("/home/user")),
            vec!["/home/user/notes.md", "/tmp/b.md"]
        );
    }
}
