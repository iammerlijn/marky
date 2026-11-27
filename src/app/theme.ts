// The theme from the settings window. System follows the operating system; Light and Dark
// force a theme. The CSS reads `data-theme` on <html> (src/styles/tokens.css). The backend
// stores the choice and also sets the theme of the native windows (src-tauri/src/settings.rs).

export type Theme = 'system' | 'light' | 'dark'

const systemDark = () => matchMedia('(prefers-color-scheme: dark)')

export function applyTheme(theme: Theme, root = document.documentElement) {
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
}

export function isDark(root = document.documentElement): boolean {
  const forced = root.dataset.theme
  return forced ? forced === 'dark' : systemDark().matches
}

// Calls `callback` when the system theme or the chosen theme changes. Returns a stop function.
export function onThemeChange(callback: () => void, root = document.documentElement): () => void {
  const media = systemDark()
  media.addEventListener('change', callback)
  const observer = new MutationObserver(callback)
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  return () => {
    media.removeEventListener('change', callback)
    observer.disconnect()
  }
}

// Applies the theme of the settings now and after each change. Subscribes first, so that no
// change is lost, and a change that comes during the first read wins. Returns the settings.
export async function followTheme<T extends { theme: Theme }>(
  read: () => Promise<T>,
  subscribe: (handler: (settings: T) => void) => Promise<unknown>,
): Promise<T> {
  let changed: T | null = null
  await subscribe((settings) => {
    changed = settings
    applyTheme(settings.theme)
  })
  const first = await read()
  // A change during the read is newer than the value that the read returns.
  const latest = changed ?? first
  applyTheme(latest.theme)
  return latest
}
