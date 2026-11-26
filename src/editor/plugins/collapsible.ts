// Collapsibles (design document, section 6.3).
// Read `<details><summary>Title</summary> … </details>` and `+++ Title` … `+++` (Linear).
// Write `<details>`. A collapsible that you do not edit keeps its original text (preserve.ts).
import { wrapIn } from '@milkdown/kit/prose/commands'
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@milkdown/kit/prose/view'
import { $node, $prose, $remark, $view } from '@milkdown/kit/utils'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Parent, Root, RootContent } from 'mdast'
import type { Position } from 'unist'

const DETAILS_OPEN = /^<details(\s[^>]*)?>\s*(?:<summary>([\s\S]*?)<\/summary>)?$/i
const SUMMARY = /^<summary>([\s\S]*?)<\/summary>$/i
const DETAILS_CLOSE = /^<\/details>$/i
const PLUS_OPEN = /^\+\+\+[ \t]+(\S.*)$/
const PLUS_CLOSE = /^\+\+\+$/

// The markdown tree node that the remark plugin makes.
interface CollapsibleNode extends Parent {
  type: 'collapsible'
  summary: string
  // The attributes of the <details> tag, for example ` open`.
  attributes: string
}

// Raw HTML is sometimes wrapped in a paragraph by an earlier transform.
function html(node: RootContent): string | null {
  if (node.type === 'html') return node.value.trim()
  if (node.type === 'paragraph' && node.children.length === 1 && node.children[0].type === 'html') {
    return node.children[0].value.trim()
  }
  return null
}

function text(node: RootContent): string | null {
  if (node.type !== 'paragraph' || node.children.length !== 1 || node.children[0].type !== 'text') return null
  return node.children[0].value
}

interface Frame {
  plus: boolean
  summary: string
  attributes: string
  // The original nodes of the opener, to restore them if no closer follows.
  openers: RootContent[]
  start: Position['start']
  items: RootContent[]
}

// Replaces each opener … closer sequence in a list of sibling blocks with one collapsible.
function group(children: RootContent[]): RootContent[] {
  const out: RootContent[] = []
  const stack: Frame[] = []
  const target = () => (stack.length ? stack[stack.length - 1].items : out)

  for (let i = 0; i < children.length; i++) {
    const node = children[i]
    const value = html(node)
    const line = text(node)
    const top = stack[stack.length - 1]
    const details = value !== null ? DETAILS_OPEN.exec(value) : null
    const plus = line !== null ? PLUS_OPEN.exec(line) : null

    if (details || plus) {
      const frame: Frame = {
        plus: Boolean(plus),
        summary: plus ? plus[1].trim() : (details![2] ?? '').trim(),
        attributes: details?.[1] ?? '',
        openers: [node],
        start: node.position!.start,
        items: [],
      }
      const next = children[i + 1]
      const summary = details && details[2] === undefined && next ? SUMMARY.exec(html(next) ?? '') : null
      if (summary) {
        frame.summary = summary[1].trim()
        frame.openers.push(next)
        i++
      }
      stack.push(frame)
    } else if (top && (top.plus ? line !== null && PLUS_CLOSE.test(line) : value !== null && DETAILS_CLOSE.test(value))) {
      stack.pop()
      const collapsible: CollapsibleNode = {
        type: 'collapsible',
        summary: top.summary,
        attributes: top.attributes,
        // The editor needs at least one block in a collapsible.
        children: top.items.length ? top.items : [{ type: 'paragraph', children: [] }],
        position: { start: top.start, end: node.position!.end },
      }
      target().push(collapsible as unknown as RootContent)
    } else {
      if ('children' in node && node.type !== 'paragraph' && node.type !== 'heading') transform(node as Parent)
      target().push(node)
    }
  }
  // An opener without a closer stays as it was.
  for (const frame of stack) out.push(...frame.openers, ...frame.items)
  return out
}

function transform(parent: Parent) {
  parent.children = group(parent.children as RootContent[]) as Parent['children']
}

export const remarkCollapsible = $remark('remarkCollapsible', () => () => (tree: Root) => transform(tree))

export const collapsibleNode = $node('collapsible', () => ({
  group: 'block',
  content: 'block+',
  defining: true,
  attrs: {
    summary: { default: '' },
    attributes: { default: '' },
  },
  parseDOM: [
    {
      tag: 'div[data-type="collapsible"]',
      contentElement: '.collapsible-body',
      getAttrs: (dom) => ({
        summary: (dom as HTMLElement).dataset.summary ?? '',
        attributes: (dom as HTMLElement).dataset.attributes ?? '',
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    { 'data-type': 'collapsible', 'data-summary': node.attrs.summary, 'data-attributes': node.attrs.attributes, class: 'collapsible' },
    ['div', { class: 'collapsible-summary', contenteditable: 'false' }, node.attrs.summary || 'Details'],
    ['div', { class: 'collapsible-body' }, 0],
  ],
  parseMarkdown: {
    match: (node) => node.type === 'collapsible',
    runner: (state, node, type) => {
      state.openNode(type, { summary: node.summary, attributes: node.attributes })
      state.next(node.children)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'collapsible',
    runner: (state, node) => {
      const { summary, attributes } = node.attrs
      state.addNode('html', undefined, `<details${attributes}>${summary ? `\n<summary>${summary}</summary>` : ''}`)
      state.next(node.content)
      state.addNode('html', undefined, '</details>')
    },
  },
}))

// Open or closed is editor state, not document content: each tab (its EditorState) keeps it,
// and it is not written to the file. The state is a list of the positions of open collapsibles.
const openKey = new PluginKey<number[]>('marky-collapsible-open')

const isCollapsible = (doc: Node, pos: number) => doc.nodeAt(pos)?.type.name === 'collapsible'

// Map the start of a collapsible through an edit. Try both sides: a new block just before the
// collapsible and a change of its start (an edit of the summary) map in different directions.
function mapOpen(tr: Transaction, pos: number): number | null {
  for (const side of [1, -1]) {
    const mapped = tr.mapping.map(pos, side)
    if (isCollapsible(tr.doc, mapped)) return mapped
  }
  return null
}

// The collapsibles with the open attribute, as in the file.
function openOf(doc: Node): number[] {
  const open: number[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'collapsible' && /(^|\s)open\b/i.test(node.attrs.attributes)) open.push(pos)
  })
  return open
}

// The meta of a transaction that replaces the document with the file on disk (a reload).
export const reloadMeta = 'marky-reload'

export const openState = $prose(
  () =>
    new Plugin({
      key: openKey,
      state: {
        init: (_, state) => openOf(state.doc),
        apply(tr, open) {
          if (tr.getMeta(reloadMeta)) return openOf(tr.doc)
          let next = tr.docChanged ? open.map((pos) => mapOpen(tr, pos)).filter((pos) => pos !== null) : open
          const toggled = tr.getMeta(openKey) as number | undefined
          if (toggled !== undefined) next = next.includes(toggled) ? next.filter((p) => p !== toggled) : [...next, toggled]
          return next
        },
      },
      props: {
        decorations: (state) =>
          DecorationSet.create(
            state.doc,
            openKey.getState(state)!.map((pos) => Decoration.node(pos, pos + state.doc.nodeAt(pos)!.nodeSize, { class: 'is-open' })),
          ),
      },
    }),
)

function toggleOpen(view: EditorView, pos: number) {
  view.dispatch(view.state.tr.setMeta(openKey, pos))
}

// Open each closed collapsible around a position, so that the content there is visible.
export function openAround(view: EditorView, pos: number) {
  const $pos = view.state.doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name !== 'collapsible') continue
    const at = $pos.before(depth)
    if (!openKey.getState(view.state)!.includes(at)) toggleOpen(view, at)
  }
}

// The summary is a text field above the body. A toggle opens and closes the body.
class CollapsibleView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private input: HTMLInputElement

  constructor(
    private node: Node,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'collapsible'

    const header = document.createElement('div')
    header.className = 'collapsible-summary'
    header.contentEditable = 'false'
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'collapsible-toggle'
    toggle.setAttribute('aria-label', 'Open or close')
    toggle.addEventListener('click', () => {
      const pos = getPos()
      if (pos !== undefined) toggleOpen(view, pos)
    })
    this.input = document.createElement('input')
    this.input.className = 'collapsible-input'
    this.input.placeholder = 'Details'
    this.input.value = node.attrs.summary
    this.input.addEventListener('input', () => {
      const pos = getPos()
      if (pos === undefined) return
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, summary: this.input.value }))
    })
    header.append(toggle, this.input)

    this.contentDOM = document.createElement('div')
    this.contentDOM.className = 'collapsible-body'
    this.dom.append(header, this.contentDOM)
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false
    this.node = node
    if (this.input.value !== node.attrs.summary) this.input.value = node.attrs.summary
    return true
  }

  stopEvent(event: Event) {
    return event.target === this.input || (event.target as HTMLElement).classList?.contains('collapsible-toggle')
  }

  ignoreMutation(mutation: { target: globalThis.Node }) {
    return !this.contentDOM.contains(mutation.target)
  }
}

export const collapsibleView = $view(collapsibleNode, () => (node, view, getPos) => new CollapsibleView(node, view, getPos))

// For the `/` menu: put the current block in a new collapsible, open, so you can type in it.
export function wrapInCollapsible(ctx: Ctx, view: EditorView) {
  if (!wrapIn(collapsibleNode.type(ctx), { summary: 'Details' })(view.state, view.dispatch)) return
  const { $from } = view.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'collapsible') return toggleOpen(view, $from.before(depth))
  }
}

export const collapsible = [remarkCollapsible, collapsibleNode, collapsibleView, openState].flat()
