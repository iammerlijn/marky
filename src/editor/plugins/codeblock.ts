// Code blocks and Mermaid diagrams.
// Highlighting is a set of decorations: it does not change the document or the file.
// Shiki runs in a worker, and loads each language only when a code block uses it. Mermaid
// loads only when the first diagram is visible.
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@milkdown/kit/prose/view'
import { $prose, $view } from '@milkdown/kit/utils'
import { isDark, onThemeChange } from '../../app/theme'
import { changedNodes } from './changed'
import type { Span, Tokenize } from './highlighter'
import { languageName } from './languages'

// The worker stops when no code block needed it for this time. Then WebKit gives its memory
// back: about 45 MB after one TypeScript block (issue 2).
export const WORKER_IDLE_MS = 10_000

// Limits for the work on the main thread (issue 57). Mermaid draws on the main thread, and its
// time grows fast with the edges. A larger diagram shows a message, and its source stays.
export const MAX_DIAGRAM_CHARS = 20_000
export const MAX_DIAGRAM_EDGES = 500
// A longer code block is not highlighted: the page makes a decoration for each span.
export const MAX_HIGHLIGHT_CHARS = 100_000

export function workerTokenizer(): Tokenize {
  let worker: Worker | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let next = 0
  const pending = new Map<number, (spans: Span[] | null) => void>()
  return (code, language) =>
    new Promise((resolve) => {
      clearTimeout(timer)
      if (!worker) {
        const started = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' })
        started.onmessage = ({ data }: MessageEvent<{ id: number; spans: Span[] | null }>) => {
          pending.get(data.id)!(data.spans)
          pending.delete(data.id)
          if (pending.size > 0) return
          timer = setTimeout(() => {
            started.terminate()
            worker = null
          }, WORKER_IDLE_MS)
        }
        // A worker that cannot start shows plain code. The next request starts a new worker.
        started.onerror = () => {
          started.terminate()
          worker = null
          for (const settle of pending.values()) settle(null)
          pending.clear()
        }
        worker = started
      }
      pending.set(++next, resolve)
      worker.postMessage({ id: next, code, language })
    })
}

let tokenizer: Tokenize | null = null

// Replaced in tests, to count the loads. Tests run in happy-dom, which has no Worker: the test
// setup (tests/setup.ts) puts the tokenizer in the test process. The app does not include it, so
// that each Shiki grammar is only in the worker build (issue 56).
export const loaders = {
  tokenize: ((code, language) => (tokenizer ??= workerTokenizer())(code, language)) as Tokenize,
  mermaid: async () => (await import('mermaid')).default,
}

// Spans for each code block node. An unchanged node keeps its identity, so it is not
// highlighted again after an edit in another block.
const cache = new WeakMap<Node, Span[]>()
const requested = new WeakSet<Node>()

const highlightKey = new PluginKey<DecorationSet>('marky-highlight')

// One update for all the replies that come before the next frame, not one for each block.
const refreshes = new WeakMap<EditorView, number>()
function refresh(view: EditorView) {
  if (refreshes.has(view)) return
  refreshes.set(
    view,
    requestAnimationFrame(() => {
      refreshes.delete(view)
      if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(highlightKey, true))
    }),
  )
}

const highlighted = (node: Node) => {
  const language = String(node.attrs.language ?? '').toLowerCase()
  if (node.content.size > MAX_HIGHLIGHT_CHARS) return null
  return language !== 'mermaid' && languageName(language) ? language : null
}

// The decorations of one code block. When its spans are not ready, it asks the worker for
// them and keeps the old decorations, so that the colors do not flicker during typing.
function blockDecorations(node: Node, pos: number, view: EditorView | null, old: DecorationSet): Decoration[] {
  const result = cache.get(node)
  if (result) return result.map((span) => Decoration.inline(pos + 1 + span.from, pos + 1 + span.to, { style: span.style }))
  const language = highlighted(node)
  if (!language || !view) return []
  if (!requested.has(node)) {
    requested.add(node)
    void loaders.tokenize(node.textContent, language).then((spans) => {
      if (!spans) return
      cache.set(node, spans)
      refresh(view)
    })
  }
  return old.find(pos, pos + node.nodeSize)
}

function decorations(doc: Node, view: EditorView | null, old: DecorationSet): DecorationSet {
  const list: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') list.push(...blockDecorations(node, pos, view, old))
    // A code block is never inside a paragraph or a heading: do not walk their text.
    return !node.isTextblock
  })
  return DecorationSet.create(doc, list)
}

// After an edit, only the code blocks in the changed ranges get new decorations. A full
// walk of a long document at each key is too slow.
function update(tr: Transaction, set: DecorationSet, view: EditorView | null): DecorationSet {
  const mapped = set.map(tr.mapping, tr.doc)
  let next = mapped
  for (const [pos, node] of changedNodes(tr, 'code_block')) {
    next = next.remove(next.find(pos, pos + node.nodeSize))
    next = next.add(tr.doc, blockDecorations(node, pos, view, mapped))
  }
  return next
}

const highlight = $prose(() => {
  let current: EditorView | null = null
  return new Plugin({
    key: highlightKey,
    state: {
      // A new state (a new tab) uses the view of the earlier state.
      init: (_, state) => decorations(state.doc, current, DecorationSet.empty),
      // Spans that arrived from the worker: all code blocks again. An edit: only the changed blocks.
      apply: (tr, set, _old, state) =>
        tr.getMeta(highlightKey)
          ? decorations(state.doc, current, set.map(tr.mapping, tr.doc))
          : tr.docChanged
            ? update(tr, set, current)
            : set,
    },
    props: {
      decorations: (state) => highlightKey.getState(state),
      // Tab in a code block indents, as in a plain text editor.
      handleKeyDown(view, event) {
        const { $from } = view.state.selection
        if (event.key !== 'Tab' || event.shiftKey || $from.parent.type.name !== 'code_block') return false
        view.dispatch(view.state.tr.insertText('  '))
        return true
      },
    },
    view(view) {
      current = view
      // Highlight the code blocks of the first document.
      view.dispatch(view.state.tr.setMeta(highlightKey, true))
      return {}
    },
  })
})

// The code block that contains the anchor of the selection gets the class `is-editing`: a
// Mermaid block then shows its source. The anchor does not move during a drag or Shift+Arrow,
// so a selection that goes across a block does not show its source. That would move the text
// below the pointer during the drag.
const editingKey = new PluginKey('marky-code-editing')
const editing = $prose(
  () =>
    new Plugin({
      key: editingKey,
      props: {
        decorations(state) {
          const { $anchor } = state.selection
          for (let depth = $anchor.depth; depth > 0; depth--) {
            const node = $anchor.node(depth)
            if (node.type.name === 'code_block') {
              const pos = $anchor.before(depth)
              return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: 'is-editing' })])
            }
          }
          return null
        },
      },
    }),
)

let diagrams = 0

class CodeBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private label: HTMLElement
  private diagram: HTMLElement | null = null
  private error: HTMLElement | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private visible = false
  private rendered = ''
  private stopThemeChange: (() => void) | null = null
  // Render again in the other theme when the system or the chosen theme changes.
  private onThemeChange = () => {
    if (!this.visible) return
    this.rendered = ''
    this.schedule(0)
  }

  constructor(
    private node: Node,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'code-block'
    const header = document.createElement('div')
    header.className = 'code-header'
    header.contentEditable = 'false'
    this.label = document.createElement('span')
    this.label.className = 'code-language'
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'code-copy'
    copy.textContent = 'Copy'
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.node.textContent).then(() => {
        copy.textContent = 'Copied'
        setTimeout(() => (copy.textContent = 'Copy'), 1200)
      })
    })
    header.append(this.label, copy)
    const pre = document.createElement('pre')
    this.contentDOM = document.createElement('code')
    pre.append(this.contentDOM)
    this.dom.append(header)

    if (this.isMermaid) {
      this.diagram = document.createElement('div')
      this.diagram.className = 'mermaid-diagram'
      this.diagram.contentEditable = 'false'
      // A click on the diagram puts the cursor in the source.
      this.diagram.addEventListener('mousedown', (event) => {
        event.preventDefault()
        const pos = getPos()
        if (pos === undefined) return
        view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos + 1))))
        view.focus()
      })
      this.error = document.createElement('div')
      this.error.className = 'mermaid-error'
      this.error.contentEditable = 'false'
      this.error.hidden = true
      this.dom.append(this.diagram, this.error)
      this.stopThemeChange = onThemeChange(this.onThemeChange)
      // Load Mermaid only when the diagram is visible.
      if (typeof IntersectionObserver !== 'undefined') {
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            observer.disconnect()
            this.visible = true
            this.schedule(0)
          }
        })
        observer.observe(this.diagram)
      }
    }
    this.dom.append(pre)
    this.update(node)
  }

  private get isMermaid() {
    return String(this.node.attrs.language).toLowerCase() === 'mermaid'
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false
    // A change of the language to or from Mermaid needs a new view.
    if ((String(node.attrs.language).toLowerCase() === 'mermaid') !== this.isMermaid) return false
    this.node = node
    // Change the DOM only for a new language: a new decoration also calls update().
    const language = node.attrs.language || ''
    if (this.dom.dataset.language !== language) this.dom.dataset.language = language
    if (this.label.textContent !== (language || 'Text')) this.label.textContent = language || 'Text'
    if (this.diagram && this.visible && node.textContent !== this.rendered) this.schedule(300)
    return true
  }

  private schedule(delay: number) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.render(), delay)
  }

  private async render() {
    const source = this.node.textContent
    this.rendered = source
    if (source.length > MAX_DIAGRAM_CHARS) {
      const count = (n: number) => n.toLocaleString('en-US')
      return this.showError(
        `This diagram is too large to draw (${count(source.length)} characters). Marky draws diagrams up to ${count(MAX_DIAGRAM_CHARS)} characters.`,
      )
    }
    const mermaid = await loaders.mermaid()
    const dark = isDark()
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'neutral',
      themeVariables: { fontFamily: getComputedStyle(this.dom).fontFamily },
      // Mermaid shows an error for a diagram with more edges, before the layout.
      maxTextSize: MAX_DIAGRAM_CHARS,
      maxEdges: MAX_DIAGRAM_EDGES,
    })
    try {
      const { svg } = await mermaid.render(`mermaid-${++diagrams}`, source)
      if (source !== this.node.textContent) return
      this.diagram!.innerHTML = svg
      this.error!.hidden = true
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error))
    }
  }

  // Keep the last valid diagram, and show the error below it.
  private showError(message: string) {
    this.error!.textContent = message
    this.error!.hidden = false
  }

  stopEvent(event: Event) {
    const target = event.target as HTMLElement
    return target.classList?.contains('code-copy') ?? false
  }

  ignoreMutation(mutation: { target: globalThis.Node; type: string }) {
    return !this.contentDOM.contains(mutation.target) || mutation.type === 'attributes'
  }

  destroy() {
    clearTimeout(this.timer)
    this.stopThemeChange?.()
  }
}

const codeBlockView = $view(codeBlockSchema.node, () => (node, view, getPos) => new CodeBlockView(node, view, getPos))

export const codeblock = [highlight, editing, codeBlockView].flat()
