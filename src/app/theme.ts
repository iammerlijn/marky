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
