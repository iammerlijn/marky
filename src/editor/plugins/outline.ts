// The outline: a rail at the left edge with one dash for each
// heading. Hover over the rail, or focus it and press Enter, to open a list of the headings.
// Arrow keys move in the list, Enter goes to the heading, Escape closes the list.
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { openAround } from './collapsible'

export interface Heading {
  level: number
  pos: number
  // The text in parts: inline code shows as a code chip.
  parts: { text: string; code: boolean }[]
}

// All headings with text, also the headings inside collapsibles.
export function headingsOf(doc: Node): Heading[] {
  const headings: Heading[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const parts: Heading['parts'] = []
      node.forEach((child) => {
        if (!child.isText) return
        const code = child.marks.some((mark) => mark.type.name === 'inlineCode')
        const last = parts.at(-1)
        if (last?.code === code) last.text += child.text
        else parts.push({ text: child.text!, code })
      })
      if (parts.some((part) => part.text.trim())) headings.push({ level: node.attrs.level, pos, parts })
    }
    return !node.isTextblock
  })
  return headings
}

// After a jump to a heading, the editor element sends this event with the place before the jump
// ({ pos, scroll }), for back and forward (src/app/history.ts).
export const JUMP_EVENT = 'marky-jump'

// The bottom of the tab bar and the banner, which stick at the top of the window.
const viewTop = () => document.getElementById('chrome')?.getBoundingClientRect().bottom ?? 0
// The list is made again this time after the last edit.
const DELAY = 150
// The list closes this time after the mouse leaves it, so that it does not flicker.
const CLOSE_DELAY = 200

// Each tab has its own editor state, and each new state gets a new value here. A changed value
// is a tab swap, so the list is made again immediately. An edit waits for DELAY.
const key = new PluginKey<object>('marky-outline')

class OutlineView {
  private root = document.createElement('div')
  private rail = document.createElement('button')
  private panel = document.createElement('div')
  private headings: Heading[] = []
  private current = 0
  private hovered = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private closeTimer: ReturnType<typeof setTimeout> | undefined
  private frame = 0

  constructor(private view: EditorView) {
    this.root.className = 'outline'
    this.rail.className = 'outline-rail'
    this.rail.type = 'button'
    this.rail.setAttribute('aria-label', 'Outline')
    this.rail.setAttribute('aria-expanded', 'false')
    this.panel.className = 'outline-panel'
    this.panel.setAttribute('role', 'navigation')
    this.panel.setAttribute('aria-label', 'Outline')
    this.root.append(this.rail, this.panel)
    // Before the document, so that Tab reaches the rail first.
    view.dom.parentElement!.insertBefore(this.root, view.dom)

    this.rail.addEventListener('mouseenter', () => this.open())
    this.rail.addEventListener('click', () => this.open(true))
    this.root.addEventListener('mouseenter', () => {
      this.hovered = true
      clearTimeout(this.closeTimer)
    })
    this.root.addEventListener('mouseleave', () => {
      this.hovered = false
      this.closeTimer = setTimeout(() => this.close(), CLOSE_DELAY)
    })
    this.root.addEventListener('focusout', (event) => {
      if (!this.hovered && !this.root.contains(event.relatedTarget as globalThis.Node | null)) this.close()
    })
    this.root.addEventListener('keydown', this.onKey)
    this.panel.addEventListener('click', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('.outline-item')
      if (item) this.go(Number(item.dataset.index))
    })
    window.addEventListener('scroll', this.onScroll, { passive: true })
    window.addEventListener('resize', this.onScroll)
    this.build()
  }

  update(view: EditorView, prev: EditorState) {
    clearTimeout(this.timer)
    if (key.getState(view.state) !== key.getState(prev)) this.build()
    else if (view.state.doc !== prev.doc) this.timer = setTimeout(() => this.build(), DELAY)
  }

  destroy() {
    clearTimeout(this.timer)
    clearTimeout(this.closeTimer)
    cancelAnimationFrame(this.frame)
    window.removeEventListener('scroll', this.onScroll)
    window.removeEventListener('resize', this.onScroll)
    this.root.remove()
  }

  private build() {
    this.headings = headingsOf(this.view.state.doc)
    this.root.hidden = this.headings.length === 0
    const top = Math.min(...this.headings.map((h) => h.level))
    this.rail.replaceChildren(
      ...this.headings.map((h) => {
        const dash = document.createElement('span')
        dash.className = 'outline-dash'
        dash.style.setProperty('--depth', String(h.level - top))
        return dash
      }),
    )
    this.panel.replaceChildren(
      ...this.headings.map((h, index) => {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'outline-item'
        item.tabIndex = -1
        item.dataset.index = String(index)
        item.dataset.depth = String(h.level - top)
        item.style.setProperty('--depth', String(h.level - top))
        item.append(
          ...h.parts.map((part) => {
            if (!part.code) return part.text
            const code = document.createElement('code')
            code.textContent = part.text
            return code
          }),
        )
        return item
      }),
    )
    this.markCurrent()
  }

  // The current section: the last heading above the top of the view. Headings in a closed
  // collapsible are not visible and do not count. At the end of the document the last headings
  // cannot scroll up to the top: then the last heading in the view is the current one.
  private markCurrent() {
    const atEnd = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
    const limit = atEnd ? window.innerHeight : viewTop() + 24
    let current = 0
    for (let i = 0; i < this.headings.length; i++) {
      const el = this.view.nodeDOM(this.headings[i].pos) as HTMLElement | null
      if (!el || el.getClientRects().length === 0) continue
      if (el.getBoundingClientRect().top > limit) break
      current = i
    }
    this.current = current
    this.rail.querySelector('.is-current')?.classList.remove('is-current')
    this.rail.children[current]?.classList.add('is-current')
    this.panel.querySelector('[aria-current]')?.removeAttribute('aria-current')
    this.panel.children[current]?.setAttribute('aria-current', 'location')
  }

  private onScroll = () => {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.markCurrent()
    })
  }

  private open(focus = false) {
    clearTimeout(this.closeTimer)
    if (!this.root.classList.contains('is-open')) {
      this.root.classList.add('is-open')
      this.rail.setAttribute('aria-expanded', 'true')
      const item = this.panel.children[this.current] as HTMLElement | undefined
      if (item) this.panel.scrollTop = item.offsetTop - this.panel.clientHeight / 2
    }
    if (focus) this.focusItem(this.current)
  }

  private close() {
    this.root.classList.remove('is-open')
    this.rail.setAttribute('aria-expanded', 'false')
  }

  private focusItem(index: number) {
    const item = this.panel.children[Math.max(0, Math.min(index, this.headings.length - 1))] as HTMLElement | undefined
    item?.focus()
  }

  private onKey = (event: KeyboardEvent) => {
    const index = Number((document.activeElement as HTMLElement | null)?.dataset.index ?? this.current)
    if (event.key === 'ArrowDown') this.focusItem(index + 1)
    else if (event.key === 'ArrowUp') this.focusItem(index - 1)
    else if (event.key === 'Escape') {
      this.close()
      this.rail.focus()
    } else return
    event.preventDefault()
  }

  // Scroll to the heading and put the cursor at its start.
  private go(index: number) {
    const heading = this.headings[index]
    const { view } = this
    if (view.state.doc.nodeAt(heading.pos)?.type.name !== 'heading') return
    const from = { pos: view.state.selection.head, scroll: window.scrollY }
    openAround(view, heading.pos)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, heading.pos + 1)))
    view.focus()
    const el = view.nodeDOM(heading.pos) as HTMLElement
    window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - viewTop() - 16)
    view.dom.dispatchEvent(new CustomEvent(JUMP_EVENT, { bubbles: true, detail: from }))
  }
}

export const outline = $prose(
  () =>
    new Plugin({
      key,
      state: { init: () => ({}), apply: (_, value) => value },
      view: (view) => new OutlineView(view),
    }),
)
