<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/banner-dark.png">
  <img alt="Marky: a calm markdown editor that keeps your files clean." src="docs/images/banner-light.png">
</picture>

# Marky

Marky is a desktop markdown editor for macOS and Linux. It shows your file as a finished document: real tables, diagrams and collapsible sections, with no markdown syntax in the way. When you save, Marky writes only the lines that you edited. The rest of the file stays exactly as it was, so your git diffs stay clean.

Open a file, edit it, close it. There are no folders, no vaults and no setup.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/document-dark.png">
  <img alt="A markdown file open in Marky, with a table, a collapsible section and a diagram" src="docs/images/document-light.png">
</picture>

## Features

- **Clean saves.** Marky keeps the original text of each block that you did not edit. An edit in one table cell changes one line. A file that you open and save without edits does not change.
- **Real tables.** GFM tables show as grids with a header row, not as pipes and dashes.
- **Mermaid diagrams.** A ` ```mermaid ` block shows as a diagram. Click it to edit its source. Marky loads Mermaid only when a file has a diagram.
- **Collapsible sections.** Marky reads `<details>` and `+++` blocks and writes `<details>`.
- **Code blocks** with Shiki highlighting for about 55 languages, a language label and a copy button.
- **Front matter** shows as a properties panel above the document. You can edit the fields.
- **Markdown shortcuts while you type.** `# ` makes a heading, `- [ ] ` makes a task, and `/` opens a menu to insert a table, a diagram, a collapsible section, a code block or an image.
- **Tabs.** Keep several files open in one window. A dot shows unsaved edits. Marky reopens your tabs at the next start.
- **Changes on disk.** When another app changes an open file, Marky reloads it. If you have unsaved edits, Marky asks which version to keep.
- **Light and dark mode** follow the system setting. To use one theme always, choose Light or Dark in the settings (`Cmd+,` on macOS, `Ctrl+,` on Linux).
- **Small and fast.** The Flatpak download is about 6 MB.

### Outline

A thin rail at the left edge shows one dash for each heading. Hover over the rail to see all headings and go to one.

### Source view

`Cmd+Shift+M` (macOS) or `Ctrl+Shift+M` (Linux) shows the markdown source of the file. Press it again to go back to the document.

![The same file in the source view](docs/images/source.png)

### Large files

Marky limits the work for very large files, so that a file cannot use all the memory or stop the window.

| What | Limit | What Marky does |
|---|---|---|
| A file | more than 1,000,000 characters (about 1 MB) | Opens the file in the source view, with a message. **Show as Document** shows it as a document. That can take some seconds. A save writes the source exactly. |
| A file | more than 16 MB | Does not open the file, and shows an error. |
| A Mermaid diagram | more than 20,000 characters or 500 edges | Shows a message below the source and does not draw the diagram. |
| A code block | more than 100,000 characters | Shows the code without highlighting. |

## Keyboard shortcuts

Marky uses `Cmd` on macOS and `Ctrl` on Linux.

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+O` | Open a file |
| `Cmd/Ctrl+S` | Save |
| `Cmd/Ctrl+T` | New tab |
| `Cmd/Ctrl+W` | Close the tab |
| `Cmd/Ctrl+N` | New window |
| `Cmd/Ctrl+Shift+M` | Show or hide the markdown source |
| `Cmd/Ctrl+,` | Open the settings |

Back, forward and tab changes use other keys on Linux:

| Action | macOS | Linux |
|---|---|---|
| Back | `Cmd+[` | `Alt+Left` |
| Forward | `Cmd+]` | `Alt+Right` |
| Previous tab | `Cmd+Option+Left`, `Cmd+Shift+[`, `Ctrl+Shift+Tab` | `Ctrl+PageUp`, `Ctrl+Shift+Tab` |
| Next tab | `Cmd+Option+Right`, `Cmd+Shift+]`, `Ctrl+Tab` | `Ctrl+PageDown`, `Ctrl+Tab` |

Back and forward go to the places where you were before: a tab change, an opened file or a jump with the outline adds a place. Places of closed tabs are skipped.

You can also open a file from the command line (`marky notes.md`) or with "Open With" in your file manager.

## Install

Download the file for your system from the [latest release](https://github.com/iammerlijn/marky/releases/latest). Under "Assets":

- **macOS:** `Marky_<version>_universal.dmg`. One DMG works on Apple Silicon and Intel Macs.
- **Linux:** `Marky_<version>_x86_64.flatpak`.

### macOS

1. Open the DMG and drag Marky to the Applications folder.
2. Open Marky. Apple did not notarize the app, so macOS says that it cannot check it. Go to System Settings > Privacy & Security and click "Open Anyway". You do this one time only.

To update, download the new DMG and replace the app.

### Linux

Marky gets the GNOME runtime from Flathub:

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y Marky_<version>_x86_64.flatpak
```

To update, download the new file and install it again.

[llms-install.md](llms-install.md) has all the steps, also for a build from source.

## Build from source

Marky is a [Tauri 2](https://tauri.app) app with a Svelte 5 frontend and a [Milkdown](https://milkdown.dev) editor. The tool versions are in `mise.toml` (Node and Rust).

On Linux, install the system libraries of Tauri first:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

Then:

```sh
npm ci
npx tauri dev                    # run the app with live reload
npx tauri build --bundles dmg    # macOS package
npx tauri build --bundles deb    # Linux package
packaging/flatpak/build.sh       # build and install the Flatpak for this user
packaging/flatpak/update-sources.sh  # make the offline Flatpak sources again after a lockfile change
```

## Tests

```sh
npm run typecheck
npm test                         # unit and fidelity tests (Vitest)
(cd src-tauri && cargo test)     # Rust backend
npm run test:visual              # screenshot tests in the Playwright container
npm run test:e2e                 # app tests in a real window (Linux, needs tauri-driver)
tests/e2e/docker.sh              # app tests in a Debian container (Arch has no WebKitWebDriver)
```

The fidelity tests open and save each file in `tests/corpus/` and check that no line changes.

## Release

1. Set the new version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then update `Cargo.lock` with `(cd src-tauri && cargo update -p marky)`. Merge the change to `main`.
2. Tag the merge commit on `main` and push the tag. The tag must be `v` plus the version in `tauri.conf.json`:

   ```sh
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. The Release workflow builds the DMG and the Flatpak file, and attaches them to a draft release. If the tag and the version are not the same, the workflow stops.
4. Check the draft on the [releases page](https://github.com/iammerlijn/marky/releases), and publish it. Only then does the download link in [Install](#install) show the new files.

## Documentation

- [Style sheet](docs/style.md): the design rules of the UI
- [Known dependency advisories](docs/security-advisories.md): advisories that remain, and why they do not affect Marky

## License

Copyright (C) 2026 iammerlijn

Marky is free software under the [GNU General Public License v3.0](LICENSE). You can use, change and share it. If you share a changed version, you must share its source under the same license.
