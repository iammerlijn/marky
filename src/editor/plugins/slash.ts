import { commandsCtx, type CmdKey } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import {
  createCodeBlockCommand,
  insertHrCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand } from '@milkdown/kit/preset/gfm'
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { wrapInCollapsible } from './collapsible'

// The `/` menu (design document, section 6.8): type `/` in a paragraph to insert a block.
// Type more letters to filter. Arrow keys select, Enter or Tab inserts, Escape closes.

export interface SlashItem {
  label: string
  // The markdown syntax of the block, shown next to the label.
  syntax: string
  keywords: string
  run(ctx: Ctx, view: EditorView): void
}

// Milkdown sets the key of a command when the editor starts, so read it at call time.
const call = (command: { key: CmdKey<any> }, payload?: unknown) => (ctx: Ctx) => {
  ctx.get(commandsCtx).call(command.key, payload)
}

export const slashItems: SlashItem[] = [
  { label: 'Heading 1', syntax: '#', keywords: 'h1 title', run: call(wrapInHeadingCommand, 1) },
  { label: 'Heading 2', syntax: '##', keywords: 'h2 subtitle', run: call(wrapInHeadingCommand, 2) },
  { label: 'Heading 3', syntax: '###', keywords: 'h3', run: call(wrapInHeadingCommand, 3) },
  { label: 'Bullet list', syntax: '-', keywords: 'unordered ul', run: call(wrapInBulletListCommand) },
  { label: 'Numbered list', syntax: '1.', keywords: 'ordered ol', run: call(wrapInOrderedListCommand) },
  {
    label: 'Task list',
    syntax: '- [ ]',
    keywords: 'todo checkbox',
    run: (ctx, view) => {
      call(wrapInBulletListCommand)(ctx)
      const { $from } = view.state.selection
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth)
        if (node.type.name !== 'list_item') continue
        view.dispatch(view.state.tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, checked: false }))
        return
      }
    },
  },
  { label: 'Quote', syntax: '>', keywords: 'blockquote', run: call(wrapInBlockquoteCommand) },
  { label: 'Code block', syntax: '```', keywords: 'pre', run: call(createCodeBlockCommand, '') },
  { label: 'Mermaid diagram', syntax: '```mermaid', keywords: 'chart graph flow', run: call(createCodeBlockCommand, 'mermaid') },
  { label: 'Collapsible', syntax: '<details>', keywords: 'details toggle fold', run: wrapInCollapsible },
  { label: 'Table', syntax: '| |', keywords: 'grid', run: call(insertTableCommand, { row: 3, col: 3 }) },
  { label: 'Divider', syntax: '---', keywords: 'hr rule line', run: call(insertHrCommand) },
]

export interface SlashState {
  // Position of the `/` character.
  from: number
  items: SlashItem[]
  index: number
}

type Meta = { index: number } | { dismiss: number }

interface PluginState {
  open: SlashState | null
  // Position of a `/` that Escape closed. The menu stays closed for it.
  dismissed: number | null
}

export const slashKey = new PluginKey<PluginState>('marky-slash')

// The text before the cursor must be `/query` at the start of the paragraph or after a space.
function match(state: EditorState): { from: number; query: string } | null {
  const { selection } = state
  if (!selection.empty) return null
  const { $from } = selection
  if ($from.parent.type.name !== 'paragraph') return null
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.spec.tableRole) return null
  }
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
  const found = /(?:^|\s)\/([a-z0-9]*)$/i.exec(before)
  if (!found) return null
  return { from: $from.pos - found[1].length - 1, query: found[1].toLowerCase() }
}

function filter(query: string): SlashItem[] {
  const words = (item: SlashItem) => `${item.label} ${item.keywords}`.toLowerCase().split(/\s+/)
  return slashItems.filter((item) => words(item).some((word) => word.startsWith(query)))
}

function choose(ctx: Ctx, view: EditorView, open: SlashState, item: SlashItem) {
  view.dispatch(view.state.tr.delete(open.from, view.state.selection.from))
  item.run(ctx, view)
  view.focus()
}

export const slash = $prose(
  (ctx) =>
    new Plugin({
      key: slashKey,
      state: {
        init: (): PluginState => ({ open: null, dismissed: null }),
        apply(tr, previous, _old, state): PluginState {
          const meta = tr.getMeta(slashKey) as Meta | undefined
          const found = match(state)
          let dismissed = previous.dismissed
          if (meta && 'dismiss' in meta) dismissed = meta.dismiss
          if (!found) return { open: null, dismissed: null }
          if (found.from === dismissed) return { open: null, dismissed }
          const items = filter(found.query)
          if (items.length === 0) return { open: null, dismissed }
          const same = previous.open?.from === found.from && previous.open.items.length === items.length
          const index = meta && 'index' in meta ? meta.index : same ? previous.open!.index : 0
          return { open: { from: found.from, items, index }, dismissed }
        },
      },
      props: {
        handleKeyDown(view, event) {
          const open = slashKey.getState(view.state)?.open
          if (!open) return false
          const move = (step: number) => {
            const index = (open.index + step + open.items.length) % open.items.length
            view.dispatch(view.state.tr.setMeta(slashKey, { index }))
          }
          switch (event.key) {
            case 'ArrowDown':
              move(1)
              return true
            case 'ArrowUp':
              move(-1)
              return true
            case 'Enter':
            case 'Tab':
              choose(ctx, view, open, open.items[open.index])
              return true
            case 'Escape':
              view.dispatch(view.state.tr.setMeta(slashKey, { dismiss: open.from }))
              return true
          }
          return false
        },
      },
      view(editorView) {
        const menu = document.createElement('div')
        menu.className = 'slash-menu'
        menu.setAttribute('role', 'listbox')
        menu.hidden = true
        document.body.append(menu)

        const render = (view: EditorView) => {
          const open = slashKey.getState(view.state)?.open
          menu.hidden = !open
          if (!open) return
          menu.replaceChildren(
            ...open.items.map((item, i) => {
              const option = document.createElement('div')
              option.className = 'slash-item'
              option.setAttribute('role', 'option')
              option.setAttribute('aria-selected', String(i === open.index))
              const label = document.createElement('span')
              label.textContent = item.label
              const syntax = document.createElement('code')
              syntax.textContent = item.syntax
              option.append(label, syntax)
              // mousedown, not click: the editor must keep the focus.
              option.addEventListener('mousedown', (event) => {
                event.preventDefault()
                choose(ctx, view, open, item)
              })
              return option
            }),
          )
          menu.children[open.index]?.scrollIntoView?.({ block: 'nearest' })
          // Below the cursor, or above it when the window has no space below.
          const coords = view.coordsAtPos(open.from)
          const below = coords.bottom + 4 + menu.offsetHeight <= window.innerHeight
          menu.style.left = `${Math.max(8, Math.min(coords.left, window.innerWidth - menu.offsetWidth - 8))}px`
          menu.style.top = `${below ? coords.bottom + 4 : Math.max(8, coords.top - 4 - menu.offsetHeight)}px`
        }

        render(editorView)
        return { update: render, destroy: () => menu.remove() }
      },
    }),
)
