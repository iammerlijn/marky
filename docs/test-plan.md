# Marky: test plan

Status: draft, 2026-11-25

This document tells which tests Marky needs, why each test is necessary, and when in the plan (design document, section 11) each test must pass.

## 1. Main promise and main risks

Marky's main promise is: **Marky does not damage your files.** A WYSIWYG editor does not show you the markdown, so you do not see damage when it occurs. You see it later in a git diff, or you never see it. Thus most tests in this plan are about file safety.

| Risk | What can go wrong | Tests |
|---|---|---|
| Content loss | Text, HTML, links or code are deleted when you save | Sections 3 and 4 |
| Noisy diffs | Blocks that you did not edit change when you save | Sections 3 and 4 |
| Lost writes | A crash or a second app overwrites your work | Section 6 |
| Wrong rendering | A table, diagram or collapsible shows incorrectly | Section 5 |
| Platform differences | It works on macOS but not on Linux | Section 8 |
| Slow app | The promise "lightweight and fast" is not true | Section 9 |

## 2. Tools

| Level | Tool | Runs |
|---|---|---|
| TypeScript unit and fidelity tests | Vitest with happy-dom or jsdom | Each commit, in CI |
| Rust tests | `cargo test` | Each commit, in CI |
| UI tests in a browser | Playwright with WebKit | Each commit, in CI |
| App tests (real Tauri window) | WebdriverIO with `tauri-driver` | Linux CI. `tauri-driver` does not support macOS, so test macOS by hand before each release. |
| Visual tests | Playwright screenshots, compared with approved images | Each pull request |
| Performance | A benchmark script on the built app | Each release, macOS and Linux |

CI runs on GitHub Actions with `macos-latest` and `ubuntu-latest`.

### Test corpus

The fidelity tests need many real markdown files.

- **Public corpus** (`tests/corpus/`, in the repo): sample files without private content. Add files from open-source projects with a compatible license (READMEs, docs) and files made for edge cases.
- **Private corpus** (not in the repo): set `MARKY_CORPUS=~/Projects` to run the same tests on your own files. Run this locally before each release.

Why both: the public corpus makes the tests repeatable in CI. The private corpus finds the problems that occur in real use.

## 3. Fidelity tests: open and save without edits

**Why:** this is the most important test. It proves the main promise. The step 0 test (design document, section 3) showed that the serializer alone changes 549 lines in 31 files. The block-preserving save must make this 0.

**How:** for each file in the corpus, load the file in the editor, save it without edits, and compare the result with the original, byte for byte.

**Pass:** 0 changed bytes for all files.

**Include these cases**, because the step 0 test did not cover them:

| Case | Why |
|---|---|
| CRLF line endings (Windows files) | The step 0 test changed CRLF to LF before the comparison. A real save must keep CRLF. |
| UTF-8 with BOM | Some editors add a BOM. Marky must keep it. |
| No final newline, or many final newlines | The end of the file is a frequent cause of noisy diffs. |
| Tabs for indentation | Lists and code blocks with tabs |
| Trailing spaces (two spaces = line break) | The serializer can remove them or change them to `\`. |
| HTML blocks and inline HTML | Tiptap deleted these in step 0 |
| HTML comments | Tiptap deleted these in step 0 |
| HTML entities (`&mdash;`, `&nbsp;`) | Milkdown changed `&mdash;` to `—` in step 0 |
| Reference links (`[text][ref]` and `[ref]: url`) | The serializer can change them to inline links. |
| Setext headings (`Title` + `===`) | The serializer can change them to `# Title`. |
| Escaped characters (`\*`, `\|`) | The serializer can add or remove escapes. |
| Front matter | It must stay exactly the same. |
| `+++` collapsibles | Marky reads `+++`, but writes `<details>`. A clean `+++` block must stay `+++`. |
| Empty file, file with only front matter | Edge cases |

## 4. Edit tests: only edited blocks change

**Why:** the fidelity test proves that Marky saves correctly when you do not edit anything. But you always edit something. These tests prove that one edit changes only the block that you edited, and not the blocks next to it.

**How:** load a file, do one edit through the ProseMirror API, save, and compare the result with the original, line by line.

**Pass:** only the lines of the edited block change. All other lines stay the same, including the empty lines between blocks.

| Edit | Expected result |
|---|---|
| Type a word in a paragraph | Only that paragraph changes. |
| Edit a table cell | Only that table changes. The other tables keep their alignment. |
| Split a paragraph (Enter) | One block becomes two. The other blocks do not change. |
| Join two paragraphs (Backspace) | Two blocks become one. The other blocks do not change. |
| Move a block (drag) | The moved block keeps its original text. |
| Delete a block | The other blocks and the space between them do not change. |
| Add a block at the start and at the end of the file | The final newline of the file does not change. |
| **Edit, then undo** | **The file does not change.** If the block content is the same as the original, the block is clean again. |
| Paste a large part of another document | Only the new blocks are serialized. |
| Edit the front matter panel | Only the front matter changes. |
| Raw mode: switch to source and back without edits | The file does not change. |

**Content-loss test (fuzz):** generate many random markdown documents from parts (headings, lists, tables, code, HTML, links). For each document, do a random edit and save. Then check that each word, link URL, image path and HTML tag of the blocks that you did not edit is still in the file.

**Why fuzz:** hand-written tests find the problems that you expect. Random combinations find the problems that you do not expect, for example a table in a list in a collapsible.

## 5. Feature tests

**Why:** each plugin has its own markdown syntax and its own way to save. A plugin can render correctly but save incorrectly, or the other way around. Each feature needs tests for its rendering and for its round trip.

### 5.1 Tables

- A pipe in a cell (`\|`) and in inline code in a cell.
- Empty cells, cells with only inline code, and cells with links.
- Column alignment (`:---`, `:---:`, `---:`).
- A table that is wider than the page: it must scroll horizontally.
- A table with 100 columns and a table with 1,000 rows: speed and memory.
- Add and delete a row and a column: the result is valid GFM.
- `Tab` in the last cell adds a row.

### 5.2 Collapsibles

- Read `<details>` with and without `<summary>`.
- Read `+++ Title` … `+++`.
- Nested collapsibles, and a collapsible that contains a table, a list and code.
- Edit a `+++` collapsible: Marky saves it as `<details>`.
- A `<details>` block with attributes (`<details open>`): the attributes stay.

### 5.3 Mermaid

- A valid diagram renders. An invalid diagram shows the error and the last valid diagram.
- A file without Mermaid does not load the Mermaid library (check the loaded scripts).
- Light and dark theme.
- A file with 20 diagrams: the scroll stays smooth.

### 5.4 Code blocks

- A known language, an unknown language and no language.
- Very long lines: horizontal scroll, no line wrap.
- `Tab` in a code block indents and does not move the focus.
- The copy button copies the code exactly, without line numbers.

### 5.5 Front matter

- Simple values (text, number, date, boolean, list) show as fields.
- Complex YAML (nested objects, anchors, comments) shows as raw YAML. It does not change after a save.
- Invalid YAML: show an error, and keep the text without change.

### 5.6 Markdown shortcuts and paste

- Each shortcut (`# `, `- `, `- [ ] `, ```` ``` ````, `> `, `---`) makes the correct block.
- Paste from a web page, GitHub, Linear and VS Code: the result is correct markdown, with no style or script garbage.
- Copy from Marky and paste in a plain text editor: the result is markdown.

### 5.7 Outline

- The heading list comes from the document: the levels `h1` to `h6`, inline code as a separate part, headings inside a collapsible, and no list for a document without headings (`tests/outline.test.ts`).
- Visual tests: the closed rail with the current section, and the open panel, in light and dark mode.
- Keyboard: `Enter` on the rail opens the panel, `Escape` closes it, and `Enter` on a line moves the cursor to the heading.

## 6. File safety tests

**Why:** these tests protect your work from crashes and from other apps. A data-loss bug in this part can delete a full file, not only a block.

| Test | Pass |
|---|---|
| Stop the app (kill) during a save | The file is the old version or the new version, never half of a file. |
| Save when the disk is full | Marky shows an error. The original file does not change. |
| Another app changes the file, and the tab has no unsaved edits | The tab reloads and keeps the scroll position. |
| Undo after a reload, or after Load from disk | The first undo gives back the text from before the reload. The next undos undo the edits from before it. |
| Another app changes the file, and the tab has unsaved edits | Marky shows the "changed on disk" bar. It does not overwrite anything. |
| Another app changes the file between the last read and the save | The save stops with a conflict (content hash check). |
| Marky saves the file itself | The file watcher does not show a "changed on disk" bar. |
| The file is deleted or renamed while it is open | Marky shows this in the tab. It does not create the file again without a question. |
| A git checkout changes 50 open files at the same time | All tabs reload. No crash, no lost edits. |
| A read-only file | Marky opens it and shows that you cannot save. |
| A symlink | Marky saves to the target. The symlink stays. |
| A file that is not UTF-8 | Marky does not open it for editing. It does not damage it. |
| File permissions | A save keeps the original permissions of the file. |
| Close a tab or the window with unsaved edits | Marky asks to save. |

## 7. Tab tests

**Why:** Marky uses one editor view and swaps the state between tabs. A mistake in this swap can show the content of one tab in another tab, or save one tab's content to the file of another tab.

- Change between tabs: each tab keeps its content, selection, scroll position and undo history.
- Undo in tab A does not undo an edit of tab B.
- Save in tab A writes only file A.
- Open the same file two times: Marky selects the existing tab.
- Restart the app: the tabs of the last session open again.
- Memory with 10 tabs open: less than 200 MB.
- Scroll a long document: the tab bar and the "changed on disk" bar stay at the top, also in raw mode (visual test).

## 8. Platform tests

**Why:** macOS uses WKWebView and Linux uses WebKitGTK. Both are WebKit, but they have different versions, different bugs and different speed. The Flatpak sandbox also changes how the app gets access to files.

| Test | Why |
|---|---|
| Visual tests on macOS and Linux | Find rendering differences early |
| Start on a Linux machine with an NVIDIA GPU | Some NVIDIA setups show a blank window. Check that the `WEBKIT_DISABLE_DMABUF_RENDERER` workaround works. |
| **Flatpak: open, save and watch a file outside the home folder** | **The Flatpak sandbox blocks file access by default.** Files that you open through the file dialog use a portal. The file watcher and "reopen last session" can fail in the sandbox. Test this early, because it can change the design. |
| Flatpak: open a file from the file manager and from the terminal | File association and CLI arguments in the sandbox |
| Wayland and X11 | Window, keyboard input and clipboard behave differently |
| HiDPI and normal screens | Font rendering and line sharpness |
| macOS: open a file with "Open With" and by drag and drop on the dock icon | macOS file events are different from Linux |
| Keyboard shortcuts: `Cmd` on macOS, `Ctrl` on Linux | Shortcuts must use the correct key for the platform. |

## 9. Performance tests

**Why:** "lightweight and fast" is a main goal. Without measurement, the app gets slower with each new feature, and you do not see it until it is too late.

| Metric | Target | How to measure |
|---|---|---|
| Cold start to visible document | < 500 ms | Time from process start to the first paint of the document, mean of 10 starts |
| Open a 1,000-line file | < 300 ms | Time from the open command to the first paint |
| Open a 5,000-line file | < 1 s | Time from the open command to the first paint |
| Typing delay | < 16 ms | Time from key event to paint, in a 5,000-line file |
| App download | < 15 MB | Size of the `.dmg` and the Flatpak bundle |
| Memory with 10 tabs | < 200 MB | Resident memory of all app processes |

- Run the benchmark for each release on macOS and on Linux.
- If a value is more than 10% worse than the last release, the release stops until the cause is known.

## 10. Order of the tests

The tests follow the plan in the design document (section 11). A step is done only when its tests pass.

| Plan step | Tests that must pass |
|---|---|
| 1. Tauri shell | Section 6 (file safety), Flatpak file access (section 8) |
| 2. Milkdown + tables | Section 5.1 (rendering) |
| 3. Block-preserving save | Sections 3 and 4 (fidelity and edits). **This step is the core of Marky.** |
| 4. Tabs | Section 7, and the external-change tests from section 6 |
| 5. Collapsibles, Mermaid, code | Sections 5.2, 5.3 and 5.4 |
| 6. Front matter, raw mode | Section 5.5, raw mode tests from section 4 |
| 7. Styling | Visual tests (section 8) |
| 8. Packaging | Section 8 (all), section 9 (performance) |

The Flatpak file access test is in step 1 and not in step 8. If the sandbox blocks the file watcher, this changes the design of the backend, so it is necessary to know this early.
