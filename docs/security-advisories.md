# Known dependency advisories

This file lists the advisories that remain in the dependency graph, and why they do not affect Marky.
Check it again when you upgrade Tauri, `tauri-plugin-single-instance` or WebdriverIO.

Last check: 2026-11-27, with `npm audit` and `cargo audit` 0.23.0 (`src-tauri/Cargo.lock`).

## npm

`npm audit` finds no advisories.

WebdriverIO 10.2.0 still depends on versions of `glob` and `minimatch` with advisories
GHSA-3g3m-2fjr-6pw4 and GHSA-g3hv-75wg-m249. The `overrides` in `package.json` move them to fixed versions:

| Package | Pinned by | Override |
|---------|-----------|----------|
| `readdir-glob` | `webdriverio` → `archiver@8` (`^3.0.0`, uses `minimatch@10`) | `^4.0.0` (uses `minimatch@11`) |
| `glob` | `@wdio/mocha-framework` → `mocha@12` (`^13.0.0`) | `^14.0.2` |
| `minimatch` | `@wdio/mocha-framework` → `mocha@12` (`^10.2.2`) | `^11.0.1` |

Remove an override when the upstream package allows a fixed version.

WebdriverIO installs `edgedriver` and `geckodriver` through `@wdio/utils`. They are normal dependencies, not optional,
and `@wdio/utils` imports `geckodriver` at load time, so they cannot be omitted.
They do not run: npm does not run their install scripts (no driver download), and `tests/e2e/wdio.conf.ts`
connects to `tauri-driver` on port 4444, so WebdriverIO never starts a browser driver.

## Rust

All Rust advisories are warnings (unsound or unmaintained). No advisory is a vulnerability.
None of the crates is in the macOS graph.

| ID | Crate | Kind | Dependency path | Why it is not reachable |
|----|-------|------|-----------------|-------------------------|
| RUSTSEC-2024-0429 | `glib 0.18.5` | unsound | `tauri` → `gtk 0.18` / `webkit2gtk 2.0` / `muda` / `tao` / `wry` → `glib 0.18` (Linux only) | The unsound code is the `Iterator` implementations of `glib::VariantStrIter`. Marky does not use `glib`, and no crate in the graph calls `VariantStrIter`. |
| RUSTSEC-2024-0370 | `proc-macro-error 1.0.4` | unmaintained | `glib 0.18` → `glib-macros 0.18` → `proc-macro-error` (Linux only) | It is a proc macro. It runs only at compile time and is not in the app binary. |
| RUSTSEC-2026-0370 | `zvariant 5.15.1` | unmaintained | `tauri-plugin-single-instance` → `zbus 5` → `zvariant` (Linux only) | No known vulnerability. Marky uses D-Bus only to find a running Marky on the session bus. |
| RUSTSEC-2026-0371 | `zbus_names 4.3.5` | unmaintained | `tauri-plugin-single-instance` → `zbus 5` → `zbus_names` (Linux only) | Same as `zvariant`. |
| RUSTSEC-2026-0372 | `zvariant_derive 5.15.1` | unmaintained | `tauri-plugin-single-instance` → `zbus 5` → `zvariant` → `zvariant_derive` (Linux only) | Proc macro: compile time only. |
| RUSTSEC-2026-0543 | `chrono 0.4.45` | unmaintained | `tauri-utils` → `serde_with` (optional `chrono` feature) | Only in `Cargo.lock`. The `chrono` feature of `serde_with` is off, so `cargo tree --target all -e all` does not show `chrono` and it is not compiled. |

### Why glib stays at 0.18

The fix for RUSTSEC-2024-0429 is `glib >= 0.20`. The latest stable Tauri (2.12.7) uses `gtk 0.18`, which needs `glib 0.18`.
`gtk 0.19` (`glib 0.22`) exists, and `wry 0.58` uses it, but Tauri 2 does not use `wry 0.58`.
`tauri 3.0.0-alpha.6` also still depends on `muda 0.20` and `gtk 0.18`.
A `[patch]` to force a newer `glib` would not build with `gtk 0.18`. Upgrade when a stable Tauri release uses `gtk >= 0.19` on Linux.

## Ignore list

The IDs that remain, for a CI ignore list:

```text
RUSTSEC-2024-0429
RUSTSEC-2024-0370
RUSTSEC-2026-0370
RUSTSEC-2026-0371
RUSTSEC-2026-0372
RUSTSEC-2026-0543
```
