// Recent files for the welcome screen. In localStorage, like the session: all windows share them.

export interface RecentFile {
  path: string
  // The time of the last open, in ms.
  at: number
}

const KEY = 'marky.recent'
const MAX = 8

export function recentFiles(): RecentFile[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function store(list: RecentFile[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // Without storage, there are no recent files.
  }
}

// The file goes to the top of the list.
export function addRecent(path: string, at = Date.now()) {
  store([{ path, at }, ...recentFiles().filter((f) => f.path !== path)].slice(0, MAX))
}

export function removeRecent(path: string) {
  store(recentFiles().filter((f) => f.path !== path))
}

// The folder of a path, with ~ for the home folder.
export function folderOf(path: string, home: string | null): string {
  const folder = path.slice(0, Math.max(path.lastIndexOf('/'), 0)) || '/'
  const base = home?.replace(/\/$/, '')
  if (base && (folder === base || folder.startsWith(base + '/'))) return '~' + folder.slice(base.length)
  return folder
}

// "Today", "Yesterday", else the day and the month ("12 Nov").
export function whenLabel(at: number, now = Date.now()): string {
  const day = (ms: number) => {
    const d = new Date(ms)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
