// App shortcuts: Cmd on macOS, Ctrl on Linux.

export type Action = 'open' | 'save' | 'close-tab' | 'new-tab' | 'new-window' | 'toggle-raw' | 'quit' | Navigation
export type Navigation = 'back' | 'forward' | 'previous-tab' | 'next-tab'

const actions: Record<string, Action> = { o: 'open', s: 'save', w: 'close-tab', t: 'new-tab', n: 'new-window' }

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent)

export function shortcut(event: KeyboardEvent, mac = isMac): Action | null {
  const nav = navigation(event, mac)
  if (nav) return nav
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!mod || event.altKey) return null
  const key = event.key.toLowerCase()
  if (key === 'm') return event.shiftKey ? 'toggle-raw' : null
  // On macOS, Cmd+Q is in the menu bar (src-tauri/src/menu.rs).
  if (key === 'q') return mac ? null : 'quit'
  return actions[key] ?? null
}

// Back, forward and the tab changes. Not Cmd+Left and Cmd+Right: on macOS they move the cursor to
// the start and the end of the line.
function navigation(event: KeyboardEvent, mac: boolean): Navigation | null {
  const { key, metaKey: meta, ctrlKey: ctrl, altKey: alt, shiftKey: shift } = event
  // Ctrl+Tab and Ctrl+Shift+Tab on both systems.
  if (ctrl && !meta && !alt && key === 'Tab') return shift ? 'previous-tab' : 'next-tab'
  if (mac) {
    if (!meta || ctrl) return null
    if (alt && !shift) return key === 'ArrowLeft' ? 'previous-tab' : key === 'ArrowRight' ? 'next-tab' : null
    if (alt) return null
    // With Shift, the key of [ and ] can give { and }.
    if (key === '[' || key === '{') return shift ? 'previous-tab' : 'back'
    if (key === ']' || key === '}') return shift ? 'next-tab' : 'forward'
    return null
  }
  if (meta || shift) return null
  if (alt && !ctrl) return key === 'ArrowLeft' ? 'back' : key === 'ArrowRight' ? 'forward' : null
  if (ctrl && !alt) return key === 'PageUp' ? 'previous-tab' : key === 'PageDown' ? 'next-tab' : null
  return null
}

export function modLabel(mac = isMac): string {
  return mac ? '⌘' : 'Ctrl'
}

// In the capture phase, before the editor and the source editor: a shortcut of the app does not
// also run a command of the editor (for example, Mod-[ and Mod-] of the Milkdown list keymap).
export function listenForShortcuts(perform: (action: Action) => void, mac = isMac): () => void {
  const onKey = (event: KeyboardEvent) => {
    const action = shortcut(event, mac)
    if (!action) return
    event.preventDefault()
    event.stopPropagation()
    perform(action)
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}
