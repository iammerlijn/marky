// Links. A click on a link opens it in the browser of the system (or the mail app). Only web
// and mail links open: a document must not start other apps. The backend checks this again
// (open_link in src-tauri/src/lib.rs). A relative link (another file) does nothing.
// When the pointer is on a link, a tooltip below the link shows its URL.
import { Plugin } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
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

// The tooltip of each editor. It is hidden when the pointer is not on a link.
const tips = new WeakMap<EditorView, HTMLElement>()

function showTip(view: EditorView, link: Element) {
  const element = tips.get(view)
  if (!element) return
  element.textContent = link.getAttribute('href') ?? ''
  element.hidden = false
  // Below the link, or above it when the window has no space below.
  const rect = link.getBoundingClientRect()
  const below = rect.bottom + 4 + element.offsetHeight <= window.innerHeight
  element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - element.offsetWidth - 8))}px`
  element.style.top = `${below ? rect.bottom + 4 : Math.max(8, rect.top - 4 - element.offsetHeight)}px`
}

function hideTip(view: EditorView) {
  const element = tips.get(view)
  if (element) element.hidden = true
}

export const links = $prose(
  () =>
    new Plugin({
      view(view) {
        const element = document.createElement('div')
        element.className = 'link-tip'
        element.setAttribute('role', 'tooltip')
        element.hidden = true
        document.body.append(element)
        tips.set(view, element)
        return {
          // A new document, for example after a reload of the file: the link can be gone.
          update: (view, previous) => {
            if (view.state.doc !== previous.doc) hideTip(view)
          },
          destroy: () => element.remove(),
        }
      },
      props: {
        handleDOMEvents: {
          mouseover(view, event) {
            const link = (event.target as Element | null)?.closest?.('a[href]')
            if (link && view.dom.contains(link)) showTip(view, link)
            else hideTip(view)
            return false
          },
          mouseleave(view) {
            hideTip(view)
            return false
          },
          // The tooltip does not move with the text.
          wheel(view) {
            hideTip(view)
            return false
          },
          keydown(view) {
            hideTip(view)
            return false
          },
        },
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
