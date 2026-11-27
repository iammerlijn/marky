// The Rust backend. Tests use a fake with files in memory.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Theme } from './theme'

export interface Opened {
  text: string
  // A hash of the content on disk. See files.rs.
  version: string
}

export type SaveError = { kind: 'Conflict' } | { kind: 'Io'; message: string }

export interface Backend {
  open(path: string): Promise<Opened>
  // The version of the file on disk, without the text: also for a file that is too large to open.
  version(path: string): Promise<string>
  // Returns the new version. Throws a SaveError.
  save(path: string, text: string, expectedVersion: string): Promise<string>
  // Save As: write a new file, or replace the file that the user chose. Returns the version.
  create(path: string, text: string): Promise<string>
  watch(path: string): Promise<void>
  unwatch(path: string): Promise<void>
}

export const tauriBackend: Backend = {
  open: (path) => invoke<Opened>('open_file', { path }),
  version: (path) => invoke<string>('file_version', { path }),
  save: (path, text, expectedVersion) => invoke<string>('save_file', { path, text, expectedVersion }),
  create: (path, text) => invoke<string>('create_file', { path, text }),
  watch: (path) => invoke('watch', { path }),
  unwatch: (path) => invoke('unwatch', { path }),
}

// The open and save dialogs are in the backend: the path that the user chooses is the only path
// that the window gets permission for (src-tauri/src/grants.rs). Null when the user cancels.
// `path` is a file for the dialog to show.
export const openFileDialog = (path?: string) => invoke<string | null>('open_dialog', { path })
export const saveFileDialog = () => invoke<string | null>('save_dialog')

// The error of a file command for a path that the window has no permission for (grants.rs).
export const isNotGranted = (error: unknown) =>
  String(error instanceof Error ? error.message : error).startsWith('Marky has no permission for ')

// Markdown files that the user dropped on the window. The backend gives the window permission
// for them first.
export const onDroppedFiles = (handler: (paths: string[]) => void) =>
  listen<string[]>('dropped-files', ({ payload }) => handler(payload))

// `version` is null when the file was deleted or renamed.
export function onFileChanged(handler: (path: string, version: string | null) => void) {
  return listen<{ path: string; version: string | null }>('file-changed', ({ payload }) => handler(payload.path, payload.version))
}

// Files from the command line, from "open with" and from a second `marky` command.
// The backend sends `open-files` to the focused window. Only the first window takes the
// files of the command line at start.
// The returned promise resolves after the files of the command line are open.
export function onOpenFiles(handler: (paths: string[]) => Promise<void>, takeNow: boolean) {
  const take = async () => {
    const paths = await invoke<string[]>('take_pending_files')
    if (paths.length > 0) await handler(paths)
  }
  return listen('open-files', take).then(async (unlisten) => {
    if (takeNow) await take()
    return unlisten
  })
}

// The app settings (src-tauri/src/settings.rs). The settings window changes them. Each window
// gets `settings-changed` after a change.
export interface Settings {
  warnBeforeQuit: boolean
  theme: Theme
}

// For the About section of the settings window on Linux (src-tauri/src/about.rs).
export interface About {
  name: string
  version: string
  copyright: string
  license: string
  repository: string
}

export const getSettings = () => invoke<Settings>('get_settings')
export const setSettings = (settings: Settings) => invoke('set_settings', { settings })
export const onSettingsChanged = (handler: (settings: Settings) => void) =>
  listen<Settings>('settings-changed', ({ payload }) => handler(payload))
export const getAbout = () => invoke<About>('about')

// The changes of the settings window. Each change returns the settings to show. After a failed
// save these are the last saved settings, not the choice before the click: that choice can be
// another change that is not saved either. The backend also keeps the last saved settings.
export function settingsSaver(saved: Settings, save: (settings: Settings) => Promise<unknown>) {
  return (next: Settings): Promise<Settings> =>
    save(next).then(
      () => (saved = next),
      () => saved,
    )
}
