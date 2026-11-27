# Install Marky

Instructions for an AI agent that installs Marky for a user. Use the files of the latest release: https://github.com/iammerlijn/marky/releases. Build from source only when there is no release, or to build a changed version. Ask the user before you install system packages or tools.

## Linux (Flatpak file)

You do not need Node, Rust or `flatpak-builder`. The file is for x86_64.

1. Install `flatpak` with the package manager of the system, if it is not installed. Examples:

   ```sh
   sudo apt-get install flatpak   # Debian, Ubuntu
   sudo dnf install flatpak       # Fedora
   sudo pacman -S flatpak         # Arch
   ```

2. Add the Flathub remote for the user. Marky gets the GNOME 51 runtime from it.

   ```sh
   flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
   ```

3. Download the `.flatpak` file of the latest release, and install it:

   ```sh
   flatpak install --user -y Marky_<version>_x86_64.flatpak
   ```

4. Check the install:

   ```sh
   flatpak info --user io.github.iammerlijn.Marky
   ```

To update, download the new file and install it again.

## Linux (build from source)

The build runs in the Flatpak SDK, so you do not need Node or Rust on the host.

1. Install `flatpak`, `flatpak-builder` and `git`, and add the Flathub remote (step 2 above). The build gets the GNOME 51 SDK and the Rust and Node SDK extensions from Flathub.
2. Get the source and build. The first build downloads the SDK and its extensions (about 5 GB on disk) and compiles the Rust backend, so it can take 10 minutes or more.

   ```sh
   git clone https://github.com/iammerlijn/marky.git
   cd marky
   packaging/flatpak/build.sh
   ```

   `build.sh` builds the Flatpak offline and installs it for this user as `io.github.iammerlijn.Marky`.

To update, run `git pull` and `packaging/flatpak/build.sh` again.

## Linux (after the install)

Marky is now in the app menu, and in "Open With" for markdown files. To open a file from the command line:

```sh
flatpak run --file-forwarding io.github.iammerlijn.Marky @@ notes.md @@
```

Marky has no filesystem permission. It gets files only through the file dialog, "Open With" and `--file-forwarding`. Without `--file-forwarding`, Marky cannot read the file.

To remove Marky:

```sh
flatpak uninstall --user io.github.iammerlijn.Marky
```

## macOS (DMG)

You do not need Node, Rust or Xcode. The DMG works on Apple Silicon and Intel Macs.

1. Download the `.dmg` file of the latest release.
2. Open the DMG and drag Marky to the Applications folder.
3. Open Marky. Apple did not notarize the app, so macOS says that it cannot check it. Tell the user to go to System Settings > Privacy & Security and click "Open Anyway". This is necessary one time only.

   Another way, after the user agrees: remove the download mark from the app.

   ```sh
   xattr -dr com.apple.quarantine /Applications/Marky.app
   ```

To update, download the new DMG and replace the app. To remove Marky, delete `/Applications/Marky.app`.

## macOS (build from source)

Use this only when there is no release, or to build a changed version.

1. Install the Xcode Command Line Tools: `xcode-select --install`.
2. Install Node and Rust in the versions of `mise.toml`. With [mise](https://mise.jdx.dev), run `mise install` in the repo.
3. Build the app:

   ```sh
   git clone https://github.com/iammerlijn/marky.git
   cd marky
   npm ci
   npx tauri build --bundles app
   ```

4. Copy the app to the Applications folder:

   ```sh
   cp -R src-tauri/target/release/bundle/macos/Marky.app /Applications/
   ```

To update, run `git pull`, then the steps 3 and 4 again. To remove Marky, delete `/Applications/Marky.app`.

## Notes

- Marky allows one open instance. If Marky is open, a new start opens the file in the open window and exits at once. This is not an error.
- For development and tests, see the README.
