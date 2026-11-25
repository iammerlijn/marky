# To do

## Revise the open time for long files

The first target was < 300 ms to open a 5,000-line file (design document, section 9).
On 2026-11-25 the measured time was ~970 ms, so the target changed to < 1 s for 5,000 lines
and < 300 ms for 1,000 lines.

- About 355 ms is the parse and the block map. The rest is the DOM for ~1,600 blocks.
- `content-visibility: auto` on the blocks gave 740 ms, but it changes the layout: margins do
  not collapse and the collapsible arrow is clipped. The visual tests show this.
- Options: render a long document in parts, parse in a web worker, or a cheaper DOM for blocks
  that are not visible.
- Measure with `dev/bench.mjs` (see the comment in that file), also with `?lines=N`.

## Other open items

- Run the app tests (`tests/e2e/`) on this machine with `tests/e2e/docker.sh`: Arch has no
  package for `WebKitWebDriver`.

- Measure the cold start again on an unlocked screen: on a locked screen, the wait for the
  first paint was ~1 s (design document, section 9). Then decide on the target.
- Memory: 303 MB with 1 tab and 317 MB with 10 tabs. The target is < 200 MB, but WebKitGTK
  costs most of it. Measure macOS (WKWebView), then decide on the target.
- Test on macOS by hand: the menu bar, "Open With", a drop on the Dock icon, `Cmd` shortcuts and
  new windows (test plan, section 8). `tauri-driver` does not support macOS.
- macOS signing and notarization for the `.dmg`.
- Flathub: an offline build (vendored crates, the frontend built in the Flatpak) and an app ID
  for a domain that you control. `nl.marky.Marky` is a placeholder.
- A reload after a change on disk loses the undo history of that tab.
- The GLib warning "Error writing credentials to socket: Broken pipe" at the start of the
  Flatpak. The app works, but find the cause.
