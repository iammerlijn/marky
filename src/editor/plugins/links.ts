// Links. A click on a link opens it in the browser of the system (or the mail app). Only web
// and mail links open: a document must not start other apps. The backend checks this again
// (open_link in src-tauri/src/lib.rs). A relative link (another file) does nothing.
import { Plugin } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

const SCHEMES = new Set(['http:', 'https:', 'mailto:'])

// The URL to open, or null for a link that does not open.
export function openableUrl(href: string): string | null {
  try {
    const url = new URL(href)
    return SCHEMES.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

// Replaced in tests and in the dev preview, which have no backend. When the system cannot open
// the link (for example no mail app), a message says so.
export const linkOpener = {
  open: async (url: string) => {
    const { invoke } = await import('@tauri-apps/api/core')
    try {
      await invoke('open_link', { url })
    } catch (error) {
      const { message } = await import('@tauri-apps/plugin-dialog')
      await message(`Marky could not open the link.\n\n${String(error)}`, { kind: 'error' })
    }
  },
}

export const links = $prose(
  () =>
    new Plugin({
      props: {
        handleClick(view, _pos, event) {
          // Shift+click selects, as in other text.
          if (event.button !== 0 || event.shiftKey || event.altKey) return false
          const link = (event.target as Element | null)?.closest?.('a[href]')
          if (!link || !view.dom.contains(link)) return false
          const url = openableUrl(link.getAttribute('href') ?? '')
          if (!url) return false
          void linkOpener.open(url).catch(() => {})
          return true
        },
      },
    }),
)
