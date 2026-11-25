// App shortcuts: Cmd on macOS, Ctrl on Linux (test plan, section 8).

export type Action = 'open' | 'save' | 'close-tab' | 'new-tab' | 'new-window' | 'toggle-raw'

const actions: Record<string, Action> = { o: 'open', s: 'save', w: 'close-tab', t: 'new-tab', n: 'new-window' }

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent)

export function shortcut(event: KeyboardEvent, mac = isMac): Action | null {
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (!mod || event.altKey) return null
  const key = event.key.toLowerCase()
  if (key === 'm') return event.shiftKey ? 'toggle-raw' : null
  return actions[key] ?? null
}

export function modLabel(mac = isMac): string {
  return mac ? '⌘' : 'Ctrl'
}
