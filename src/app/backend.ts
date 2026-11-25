// The Rust backend (design document, section 4.1). Tests use a fake with files in memory.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface Opened {
  text: string
  // The modification time and size on disk. See files.rs.
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
