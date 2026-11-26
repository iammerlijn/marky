# Marky: design document

Status: draft, 2026-11-25

## 1. Goal

Marky is an open-source desktop markdown editor for macOS and Linux. The look is inspired by the Linear document editor: calm typography, real tables and no visible markdown syntax.

Marky must:

- Show markdown as a finished document (full WYSIWYG). You do not see the markdown syntax.
- Show tables as real tables, not as pipes and dashes.
- Keep your files clean. If you do not edit a part of a file, Marky must not change that part when it saves.
- Start fast and use little memory.

### Not in v1

- Windows
- Sync, cloud storage or accounts
- Plugins from other people
- Export to PDF or HTML
- Collaboration or comments
- A file browser or a vault (Marky opens files, not folders)

## 2. Decisions

| Topic | Decision | Reason |
|---|---|---|
| Name | Marky | |
| Type | Desktop app, full WYSIWYG | |
| Platforms | macOS and Linux | |
| Shell | Tauri 2 | Small app (5–15 MB), one codebase, Rust backend |
| Editor | Milkdown (ProseMirror + remark) | Did not lose content in the fidelity test (section 3) |
| UI framework | Svelte 5 | Small bundle, fast startup. The UI outside the editor is small. |
| Code highlighting | Shiki | Same quality as VS Code |
| Diagrams | Mermaid, loaded only when a file contains a diagram | Mermaid is approximately 1–2 MB |
| Collapsibles | Read `+++` and `<details>`, write `<details>` | GitHub and most viewers render `<details>` |
| Front matter | Properties panel above the document. You can edit the fields. | |
| Raw mode | A shortcut shows the markdown source | An escape hatch when the WYSIWYG view is wrong |
| Tabs | One editor view, with one saved editor state for each tab | Less memory than one editor for each tab |
| Saving | Keep the original text of each block that you did not edit | Clean git diffs (section 5) |
| macOS package | `.dmg` | |
| Linux package | Flatpak | The GNOME runtime gives the same recent WebKitGTK version to all users |

## 3. Fidelity test (step 0, done)

**Question:** which editor changes a file less when you open it and save it without edits?

**Method:** 31 real `.md` files (10,096 lines) with tables, Mermaid, code blocks, `<details>` and nested lists. Each file was loaded in Tiptap 3.35 and Milkdown 7.23 and then saved without edits. The test counted the changed lines and the words that were lost.

| | Tiptap | Milkdown (default) | Milkdown (tuned) |
|---|---|---|---|
| Changed lines | 2,300 | 4,015 | **549** |
| Files with no change | 5 of 31 | 3 of 31 | **8 of 31** |
| Lost words | **135** | 1 | 1 |

**Tiptap deletes content:**

- `<details>`/`<summary>` blocks
- HTML comments (`<!-- ... -->`)
- Code blocks inside list items
- It also breaks HTML entities: `&mdash;` becomes `&amp;mdash;`

**Milkdown changes only the style:**

- Default: `-` bullets become `*`, and table columns get padding.
- Tuned settings: `bullet: '-'`, `emphasis: '_'`, `strong: '*'`, `listItemIndent: 'one'`, and `tablePipeAlign: false` for GFM. With these settings, the changes fell by 86%.
- What remains: table alignment (some files align their tables and some do not), and safe escapes (`~` becomes `\~`, a `#` at the start of a line becomes `\#`).
- The 1 lost word: `&mdash;` became `—`. The text is the same.

**Result:** Milkdown. The save design in section 5 removes the remaining changes.

**Also found:** Milkdown does not know `+++`. It keeps `+++` blocks as plain paragraphs. A custom plugin is necessary (section 6.3).

## 4. Architecture

```text
┌──────────────────────────── Marky window ────────────────────────────┐
│  Webview (WKWebView on macOS, WebKitGTK on Linux)                    │
│  ┌────────────┐  ┌───────────────────────────────────────────────┐   │
│  │ Svelte UI  │  │ Milkdown editor                               │   │
│  │ tab bar    │  │  plugins: tables, collapsible, mermaid,       │   │
│  │ outline    │  │           front matter, code block, raw mode  │   │
│  │ dialogs    │  │  save: block-preserving serializer            │   │
│  └─────┬──────┘  └──────────────────────┬────────────────────────┘   │
│        └──────────── Tauri IPC ─────────┘                            │
├──────────────────────────────────────────────────────────────────────┤
│  Rust backend                                                        │
│  read/write files (atomic) · file watcher (notify) · CLI args ·      │
│  "open with" / file association · recent files · window state        │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.1 Rust backend

The backend is small. It does only what the webview cannot do.

| Command | Function |
|---|---|
| `open_file(path)` | Read the file. Return the text and the version (a hash of the bytes that were read). |
| `save_file(path, text, expected_version)` | Write to a temporary file, then rename it (atomic write). If the file on disk does not have `expected_version`, stop and return a conflict. The rename swaps the two files in one step (`renameat2` on Linux, `renamex_np` on macOS) and checks the file that came out, so a change by another app just before the rename is also a conflict. The new file gets the owner, the permissions and the extended attributes (ACLs, Finder tags) of the old file. A read-only file is not saved. |
| `watch(path)` / `unwatch(path)` | Send an event when the file changes on disk. Ignore the events that Marky's own saves cause. For a document portal path (`/run/user/<uid>/doc/...`), use `notify::PollWatcher` (section 4.3). For other paths, use the inotify watcher. |
| CLI and "open with" | `marky notes.md` and the file manager open the file in a new tab of the open window. |

### 4.2 Frontend

- The Svelte UI contains the tab bar, the dialogs and the settings.
- The outline is a ProseMirror plugin (`src/editor/plugins/outline.ts`). A thin rail at the left edge shows one dash for each heading (`h1` to `h6`, also in collapsibles). Deeper headings have shorter dashes. The dash of the current section is darker and longer, and it updates while you scroll. The rail has a fixed position, so it takes no width from the document column.
- Hover over the rail to open a panel over the document, with one line for each heading. A click scrolls to the heading and puts the cursor there. The panel closes a short time after the mouse leaves it. With the keyboard: `Tab` to the rail, `Enter` opens the panel, arrow keys move, `Enter` goes to the heading, `Escape` closes. There is no shortcut.
- The list comes from the editor state of the active tab: again after a tab change, and a short time after an edit. There is no rail when the document has no headings, and in raw mode.
- There is one Milkdown editor view. Each tab keeps its own ProseMirror `EditorState`. When you change tabs, the app swaps the state into the view.
- Each tab stores: the path, the original text, the block map (section 5), the dirty flag and the version on disk.

### 4.3 Flatpak file access (step 2, done)

**Question:** in the Flatpak sandbox, can the backend open, save and watch a file?

**Method:** a small Rust program (`spikes/flatpak-access/`) with the same `std::fs` and `notify` calls as the backend, in a Flatpak with GNOME runtime 51. Files in the home folder and in `/tmp`. Another app changed each file in place and with an atomic replace.

| | Document portal (no permission) | `--filesystem=home` | `--filesystem=host` |
|---|---|---|---|
| Read, atomic save, in-place save, keep the file mode | Yes, in all locations | Home folder only | Home folder only. `/tmp` is not available. |
| inotify events for changes from other apps | **No** | Yes | Yes |
| `PollWatcher` events (interval 500 ms) | Yes | | |
| Same path after a restart ("reopen last session") | Yes | Yes | Yes |
| Real path of the file | `user.document-portal.host-path` attribute | The path | The path |

**Result:** use the document portal and ask for no filesystem permission. Files come from the file dialog and from "open with" (`Exec=... @@u %U @@` in the desktop file). Use `PollWatcher` for portal paths. Show the real path from the `user.document-portal.host-path` attribute in the tab and in recent files. The backend design does not change.

**Not tested yet:** the file dialog portal (the check used `--file-forwarding`, which uses the same document store) and "Save As" for a new file.

## 5. Save design: block preservation

**Problem:** after a round trip, the serializer writes some blocks in a different way, even when you did not edit them.

**Solution:** write the original text again for each block that you did not edit.

1. **Load:** parse the file with remark. Each top-level mdast node has a start and end position in the source. Store the source slice of each top-level block, and the whitespace between blocks.
2. **Map:** store the original top-level ProseMirror node of each block. Milkdown makes one top-level node for each top-level mdast node. A link definition (`[ref]: url`) has no node: Marky keeps its text at its original place.
3. **Compare:** at save, a top-level node that is equal to an original node is clean (the heading `id` is ignored, because the editor makes it from the text). This replaces the tracking of step maps: it is simpler, and an edit that you undo makes the block clean again. A longest-common-subsequence match finds the clean blocks in order. An equal node at a different place is a moved block.
4. **Save:**
   - Clean block → write its original source slice.
   - Dirty block or new block → serialize only this block with the tuned remark settings.
   - Edited table at its original place → keep the original line of each row that did not change, and the original delimiter row if the columns and their alignment did not change. Thus an edit in one cell changes one line.
   - Between two blocks that follow each other in the original file, write the original whitespace. This includes an edited block at its original place. In other places, write `\n\n`.
   - Keep the BOM and the line endings (CRLF or LF) of the file. New text uses the same line endings.
5. **No change:** if the result is the same as the original text, do not write the file.

A moved block stays clean, because its content did not change. The end of the file keeps its original final newline.

**Tests:**

- Fidelity corpus, load and save: 0 changed lines.
- Edit one block: only the lines of that block change.
- Delete, move and add a block: the lines of the other blocks do not change.

## 6. Content features

### 6.1 Tables

- GFM tables show as real grids: a header row, thin borders, cell padding and horizontal scroll when the table is wider than the page.
- Commands: add or remove a row or column, move a row or column, and set the column alignment.
- `Tab` moves to the next cell. `Tab` in the last cell adds a row.
- You can drag the column widths. Marky keeps the widths only in the editor, not in the file.

### 6.2 Mermaid

- A ```` ```mermaid ```` code block shows as a diagram.
- Click the diagram to show the source next to it. The diagram updates while you type, with a 300 ms delay.
- If the source has an error, show the error message below the last valid diagram.
- Load Mermaid only when the first diagram is visible.
- The diagram uses the same theme as the app (light or dark).

### 6.3 Collapsibles

- Read `<details><summary>Title</summary> … </details>`.
- Read `+++ Title` … `+++` (Linear syntax).
- Write `<details>` for new collapsibles and for edited collapsibles.
- The body can contain all other blocks (lists, tables, code, nested collapsibles).
- Marky remembers if a collapsible is open or closed for each tab. This is not written to the file.

### 6.4 Code blocks

- Shiki highlighting, a language label and a copy button.
- Load Shiki languages only when a file needs them.
- Marky includes about 60 common languages (`src/editor/plugins/languages.ts`), not all ~240 of Shiki: they added about 15 MB to the app. Other languages show as plain code.
- Inside a code block, typing works as in a plain text editor (`Tab` indents).

### 6.5 Front matter

- YAML front matter between `---` lines shows as a properties panel above the document.
- Simple values (text, number, date, true/false, lists) show as fields that you can edit.
- Complex YAML shows as raw YAML in the panel.
- The front matter is a separate block for block preservation. If you do not edit it, Marky writes it again with no change.

### 6.6 Raw mode

- `Cmd/Ctrl+Shift+M` changes between the WYSIWYG view and the markdown source of the current tab.
- The source view is a CodeMirror 6 editor with markdown highlighting.
- When you go back to WYSIWYG, Marky parses the source again.
- If you did not edit the source, Marky keeps the editor state, with its undo history.
- If you edited the source, a save writes your source text exactly. Later edits in the editor change only their own blocks.
- If the block map cannot read a file (the editor makes a different number of nodes than the markdown has blocks), the file opens in raw mode with a message. You can go back to the editor when the source maps again.

### 6.7 Other GFM

Headings, lists, task lists, block quotes, links, images (local and remote), strikethrough, inline code, horizontal rules and footnotes.

### 6.7.1 Box-drawing text

Text drawn with box-drawing characters (`┌─┬─┐ │ ├─┼─┤`), for example a table copied from a terminal, is a paragraph in markdown. Marky shows it as in the source: monospace, no wrap, horizontal scroll when it is too wide. It does not convert it to a table, and a save does not change it.

### 6.8 Markdown shortcuts while you type

Typing markdown syntax converts it immediately: `# ` makes a heading, `- ` makes a list, `- [ ] ` makes a task, ```` ``` ```` makes a code block, `> ` makes a quote and `---` makes a rule. A `/` menu inserts blocks: table, Mermaid, collapsible, code block and image.

## 7. Tabs and files

- Each tab shows one file. If the file has unsaved edits, the tab shows a dot.
- If you open a file that is already open, Marky selects its tab.
- When the file changes on disk:
  - If the tab has no unsaved edits, reload it immediately and keep the scroll position.
  - If the tab has unsaved edits, show a bar: "This file changed on disk" with two buttons, **Keep mine** and **Load from disk**.
- When you close a tab or the window with unsaved edits, ask to save.
- At startup, reopen the tabs of the last session.
- Save: `Cmd/Ctrl+S`. There is no auto-save in v1.
- Shortcuts use `Cmd` on macOS and `Ctrl` on Linux, never both: `O` open, `S` save, `W` close tab, `T` new tab, `N` new window.
- `Cmd/Ctrl+W` in a window with no tabs closes the window, through the normal close path (with the unsaved-changes check).
- macOS: the setting "Warn Before Quitting" (app menu, default on) asks before `Cmd+Q` quits. Then each window closes through its normal close path, so each window asks about unsaved changes. The setting is in `settings.json` in the app config folder: the backend builds the menu at start, before the page loads.
- Linux: `Ctrl+Q` quits through the same path, so each window asks about unsaved changes. It does not ask "Quit Marky?" first, and Linux has no settings menu. Reasons: GNOME apps quit on `Ctrl+Q` without a question, the next start reopens the tabs, and with no question there is no setting to show. Add a settings place when Marky has a setting that Linux needs.
- A new tab is "Untitled". Its first save opens a Save As dialog. A new file ends with a newline.
- Each window has its own tabs. Files from the command line and from "open with" open in the focused window. Only the first window restores the session.
- A window with no tabs shows the welcome screen: the app icon, Open file, New file and the 8 recent files (in `localStorage`, shared by all windows). A recent file that does not open goes out of the list.
- Drop a markdown file (`.md`, `.markdown`, `.mdx`, `.txt`) on the window to open it in a tab.
- macOS has a menu bar with the same File actions, and Cut, Copy, Paste and Select All. The default Tauri menu is not used, because its `Cmd+W` closes the window.

## 8. Look and feel

The goal is the calm look of Linear documents: small, slightly gray body text, a large line height, headings that are only a little larger than the body text, a narrow centered column and almost no borders.

All values are CSS variables in `src/styles/tokens.css`. The values below are starting values. Tune them with a visual check against reference documents.

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#ffffff` | `#17181b` |
| `--text` | `#2a2b2f` | `#d6d7da` |
| `--text-muted` | `#6b6f76` | `#8a8f98` |
| `--border` | `#e6e7ea` | `#2b2d31` |
| `--code-bg` | `#f4f5f7` | `#212226` |
| `--accent` | `#5e6ad2` | `#7c85e0` |

| Token | Value |
|---|---|
| `--font-text` | Inter, system-ui, sans-serif |
| `--font-mono` | "JetBrains Mono", ui-monospace, monospace |
| `--size-body` | 15px |
| `--line-height` | 1.6 |
| `--size-h1` / `h2` / `h3` | 24px / 19px / 16px, weight 600 |
| `--column-width` | 720px (tables can be wider, with scroll) |
| `--radius` | 6px |

Rules:

- Light and dark mode follow the system setting.
- Do not use `backdrop-filter`, blur, large shadows or many animations. These are slow on WebKitGTK.
- Bundle Inter in the app. Do not load fonts from the internet.

## 9. Performance targets

| Metric | Target |
|---|---|
| Cold start to visible document | < 500 ms |
| Open a 1,000-line file | < 300 ms |
| Open a 5,000-line file | < 1 s (was < 300 ms, see [issue 3](https://github.com/iammerlijn/marky/issues/3)) |
| Typing delay | < 16 ms (1 frame) |
| App download | < 15 MB |
| Memory with 10 tabs open | < 200 MB |

Measure these targets in CI on macOS and Linux for each release.

**Measured (2026-11-25, Linux, production build in WebKit, `dev/bench.mjs`):**

| Metric | Result | Target met? |
|---|---|---|
| Open a 1,000-line file | 237 ms | Yes |
| Open a 2,000-line file | 327 ms | No |
| Open a 5,000-line file | ~970 ms (parse and block map ~355 ms, the rest is the DOM) | Yes (< 1 s) |
| Typing delay in a 5,000-line file | median 16 ms, p95 17 ms (one frame) | Yes |
| Save after an edit in a 5,000-line file | 4 ms | |
| Flatpak download | 5.8 MB | Yes |

**Why the target for 5,000 lines is < 1 s ([issue 3](https://github.com/iammerlijn/marky/issues/3)).**
Measured on 2026-11-26 (same setup, a slower run than 2026-11-25): a 5,000-line file opened in
~1,100 ms. The parse and the block map took ~390 ms, the editor DOM ~180 ms, the layout ~260 ms
and the first paint ~260 ms. Thus the parse alone is more than 300 ms. These are the options:

- Render a long document in parts. A test showed the first 50 blocks in ~560 ms, because the
  parse must finish first. All blocks were added after ~1,700 ms, slower than one render.
- Parse only the start of the file first. This can show the start in < 300 ms. But edits and
  saves during the load, and reference links that are defined later in the file, need special
  code. This risk is too high for the block-preserving save (section 5).
- `content-visibility: auto` on the blocks (~740 ms). It changes the layout: margins do not
  collapse and the collapsible arrow is clipped.

A 5,000-line markdown file is rare. So Marky keeps the < 1 s target and the simple open. One
small change helps: the app loads the fonts before the first file opens (`src/app/main.ts`).
Before, a font loaded only when the document used it, and then the layout was done again.
After this change: 5,000 lines ~980 ms, 1,000 lines ~275 ms (2026-11-26, runs 2 and 3 of
`dev/bench.mjs`; run 1 also loads the code highlighter).

**Measured in the release app (2026-11-25, Linux, `dev/measure-app.sh`):**

| Metric | Result | Target met? |
|---|---|---|
| Cold start: process start to the page script | ~360 ms (was ~425 ms) | |
| Cold start: process start to the open document, before the paint | ~565 ms (was ~635 ms) | No (< 500 ms) |
| Cold start to the painted document | ~605 ms (was ~1,645 ms) | No (< 500 ms) |
| Memory with 1 tab | 254 MB PSS | |
| Memory with 10 tabs | 280 MB PSS (app 96, WebKit web process 158, network process 25) | No (< 200 MB) |

The cold start values are the median of 10 starts with one file (2026-11-25, Linux, Hyprland), after
[issue 4](https://github.com/iammerlijn/marky/issues/4); a "was" value is from the build
before it. Two changes made the start faster:

- CodeMirror (raw mode) is not in the main script. It loads with `import()` the first time raw
  mode opens. The main script went from 1.17 MB to 0.68 MB.
- The window starts hidden and `src/app/main.ts` shows it when the files are open. No empty
  window shows. Before, the wait for the first painted frame was about 1 s; now the paint comes
  directly after the window shows.

Each tab costs only about 1.5 MB. The memory is mostly the base cost of WebKitGTK.
`content-visibility: auto` on the blocks gave 740 ms for 5,000 lines, but it changes the layout
(margins do not collapse, the collapsible arrow is clipped), so it is not used.

## 10. Folder layout

```text
marky/
├── docs/
│   └── design.md
├── src-tauri/                 Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── files.rs           open, save (atomic), conflict check
│   │   ├── watcher.rs         file watch with notify
│   │   └── cli.rs             CLI args and "open with"
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                       Frontend
│   ├── app/                   Svelte UI: tabs, outline, dialogs
│   ├── editor/
│   │   ├── setup.ts           Milkdown setup and tuned settings
│   │   └── plugins/           collapsible, mermaid, frontmatter, codeblock, raw-mode
│   ├── markdown/
│   │   └── preserve.ts        block-preserving serializer (section 5)
│   └── styles/
│       ├── tokens.css
│       └── document.css
├── tests/
│   ├── corpus/                markdown files for the fidelity tests
│   ├── fidelity.test.ts
│   └── e2e/
└── packaging/
    └── flatpak/
```

## 11. Plan

```text
0. Fidelity test: Tiptap vs Milkdown            -> done (section 3)
1. Tauri shell: open, save, watch, CLI args     -> verify: opens and saves a file on macOS and Linux
2. Milkdown + tuned settings + GFM + tables      -> verify: visual check against reference documents
3. Block-preserving save                        -> verify: corpus round trip = 0 changed lines
4. Tabs + dirty state + external-change bar     -> verify: tests for reload and conflict
5. Collapsibles + Mermaid + code blocks          -> verify: round-trip tests, no changes in clean blocks
6. Front matter panel + raw mode                 -> verify: round-trip tests
7. Styling pass (light and dark)                 -> verify: visual check on macOS and Linux
8. Packaging: .dmg and Flatpak                   -> verify: install on a clean machine, check the performance targets
```

Test on Linux from step 1. Do not wait until the end.

## 12. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| WebKitGTK is slower and has more rendering bugs than WKWebView | Slow or broken UI on Linux | Flatpak, simple CSS, Linux CI from step 1 |
| Blank or flickering window on some NVIDIA setups | Marky does not show content | Set `WEBKIT_DISABLE_DMABUF_RENDERER=1` at startup on Linux |
| Milkdown has mostly one maintainer | Slow fixes, or the project stops | Use Milkdown through a thin layer. ProseMirror and remark are the real base. |
| The block map does not follow complex edits correctly | A block is saved with old text | Many tests for edits that join, split or move blocks. A dirty block always uses the serializer. |
| Mermaid is large | Slow start | Load it only when a diagram is visible |

## 13. Open items

- License (MIT is the usual choice for a tool like this).
- Search and replace in v1, or later?
- Images: paste an image from the clipboard and store it next to the file?
- Spell check (the webview has a spell checker, but it differs between platforms).
