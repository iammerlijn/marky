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
  // Returns the new version. Throws a SaveError.
  save(path: string, text: string, expectedVersion: string): Promise<string>
  // Save As: write a new file, or replace the file that the user chose. Returns the version.
  create(path: string, text: string): Promise<string>
  watch(path: string): Promise<void>
  unwatch(path: string): Promise<void>
}

export const tauriBackend: Backend = {
  open: (path) => invoke<Opened>('open_file', { path }),
  save: (path, text, expectedVersion) => invoke<string>('save_file', { path, text, expectedVersion }),
  create: (path, text) => invoke<string>('create_file', { path, text }),
  watch: (path) => invoke('watch', { path }),
  unwatch: (path) => invoke('unwatch', { path }),
}

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

// A change in the settings window: returns the settings to show. These are the old settings
// when the save fails, because the backend then keeps the old settings too.
export const saveOrKeep = (old: Settings, next: Settings, save: (settings: Settings) => Promise<unknown>) =>
  save(next).then(
    () => next,
    () => old,
  )
