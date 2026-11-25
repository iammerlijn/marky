// Code blocks and Mermaid diagrams (design document, sections 6.2 and 6.4).
// Highlighting is a set of decorations: it does not change the document or the file.
// Shiki loads each language only when a code block uses it. Mermaid loads only when the
// first diagram is visible.
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@milkdown/kit/prose/view'
import { $prose, $view } from '@milkdown/kit/utils'
import type { HighlighterCore } from 'shiki/core'

// Replaced in tests, to count the loads.
export const loaders = {
  shiki: async (): Promise<HighlighterCore> => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ])
    return createHighlighterCore({
      themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  },
  language: async (name: string) => {
    const { bundledLanguages } = await import('shiki/langs')
    return name in bundledLanguages ? bundledLanguages[name as keyof typeof bundledLanguages]() : null
  },
  mermaid: async () => (await import('mermaid')).default,
}

let highlighter: Promise<HighlighterCore> | null = null
const languages = new Map<string, Promise<boolean>>()

// Loads the language once. Resolves to false for an unknown language.
function loadLanguage(name: string): Promise<boolean> {
  let loading = languages.get(name)
  if (!loading) {
    highlighter ??= loaders.shiki()
    loading = Promise.all([highlighter, loaders.language(name)]).then(async ([h, language]) => {
      if (!language) return false
      await h.loadLanguage(language)
      return true
    })
    languages.set(name, loading)
  }
  return loading
}

interface Span {
  from: number
  to: number
  style: string
}

// Tokens for each code block node. An unchanged node keeps its identity, so it is not
// highlighted again after an edit in another block.
const cache = new WeakMap<Node, Span[]>()
let ready: HighlighterCore | null = null
const readyLanguages = new Set<string>()

function spans(node: Node): Span[] | null {
  const language = String(node.attrs.language ?? '').toLowerCase()
  if (!language || language === 'mermaid' || !ready || !readyLanguages.has(language)) return null
  let result = cache.get(node)
  if (!result) {
    result = []
    const { tokens } = ready.codeToTokens(node.textContent, {
      lang: language,
      themes: { light: 'github-light', dark: 'github-dark' },
    })
    // token.offset is the offset in the whole code text.
    for (const token of tokens.flat()) {
      const style = Object.entries(token.htmlStyle ?? {})
        .map(([key, value]) => `${key}:${value}`)
        .join(';')
      if (style) result.push({ from: token.offset, to: token.offset + token.content.length, style })
    }
    cache.set(node, result)
  }
  return result
}

const highlightKey = new PluginKey<DecorationSet>('marky-highlight')
const waitingFor = new WeakMap<EditorView, Set<string>>()

// The decorations of one code block. Starts the load of its language when it is not ready.
function blockDecorations(node: Node, pos: number, view: EditorView | null): Decoration[] {
  const result = spans(node)
  if (result) return result.map((span) => Decoration.inline(pos + 1 + span.from, pos + 1 + span.to, { style: span.style }))
  const language = String(node.attrs.language ?? '').toLowerCase()
  // Each editor waits for the load itself: a load can start in another editor.
  const waiting = view && (waitingFor.get(view) ?? waitingFor.set(view, new Set()).get(view)!)
  if (language && language !== 'mermaid' && view && waiting && !waiting.has(language)) {
    waiting.add(language)
    void loadLanguage(language).then(async (known) => {
      if (!known) return
      ready = await highlighter
      readyLanguages.add(language)
      if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(highlightKey, true))
    })
  }
  return []
}

function decorations(doc: Node, view: EditorView | null): DecorationSet {
  const list: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true
    list.push(...blockDecorations(node, pos, view))
    return false
  })
  return DecorationSet.create(doc, list)
}

// After an edit, only the code blocks in the changed ranges get new decorations. A full
// walk of a long document at each key is too slow (design document, section 9).
function update(tr: Transaction, set: DecorationSet, view: EditorView | null): DecorationSet {
  let next = set.map(tr.mapping, tr.doc)
  const touched = new Map<number, Node>()
  tr.mapping.maps.forEach((map, index) => {
    const after = tr.mapping.slice(index + 1)
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = Math.max(0, after.map(newStart, -1) - 1)
      const to = Math.min(tr.doc.content.size, after.map(newEnd, 1) + 1)
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'code_block') return true
        touched.set(pos, node)
        return false
      })
    })
  })
  for (const [pos, node] of touched) {
    next = next.remove(next.find(pos, pos + node.nodeSize))
    next = next.add(tr.doc, blockDecorations(node, pos, view))
  }
  return next
}

const highlight = $prose(() => {
  let current: EditorView | null = null
  return new Plugin({
    key: highlightKey,
    state: {
      // A new state (a new tab) uses the view of the earlier state.
      init: (_, state) => decorations(state.doc, current),
      // A language that finished its load: all code blocks again. An edit: only the changed blocks.
      apply: (tr, set, _old, state) =>
        tr.getMeta(highlightKey) ? decorations(state.doc, current) : tr.docChanged ? update(tr, set, current) : set,
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

// The code block that contains the cursor gets the class `is-editing`.
const editingKey = new PluginKey('marky-code-editing')
const editing = $prose(
  () =>
    new Plugin({
      key: editingKey,
      props: {
        decorations(state) {
          const { $from } = state.selection
          for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth)
            if (node.type.name === 'code_block') {
              const pos = $from.before(depth)
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
  private colorScheme: MediaQueryList | null = null
  // Render again in the other theme when the system changes between light and dark.
  private onColorScheme = () => {
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
      this.colorScheme = matchMedia('(prefers-color-scheme: dark)')
      this.colorScheme.addEventListener('change', this.onColorScheme)
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
    this.dom.dataset.language = node.attrs.language || ''
    this.label.textContent = node.attrs.language || 'Text'
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
    const mermaid = await loaders.mermaid()
    const dark = this.colorScheme!.matches
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'neutral',
      themeVariables: { fontFamily: getComputedStyle(this.dom).fontFamily },
    })
    try {
      const { svg } = await mermaid.render(`mermaid-${++diagrams}`, source)
      if (source !== this.node.textContent) return
      this.diagram!.innerHTML = svg
      this.error!.hidden = true
    } catch (error) {
      // Keep the last valid diagram, and show the error below it.
      this.error!.textContent = error instanceof Error ? error.message : String(error)
      this.error!.hidden = false
    }
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
    this.colorScheme?.removeEventListener('change', this.onColorScheme)
  }
}

const codeBlockView = $view(codeBlockSchema.node, () => (node, view, getPos) => new CodeBlockView(node, view, getPos))

export const codeblock = [highlight, editing, codeBlockView].flat()
