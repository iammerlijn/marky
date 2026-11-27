// The source editor of raw mode: CodeMirror 6 with markdown
// highlighting. Each tab keeps its own CodeMirror state, so it keeps its undo history.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search'
import { tags } from '@lezer/highlight'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap } from '@codemirror/view'
import { FIND_EVENT, type Finder } from '../editor/plugins/find'

// Calm markdown colors from the design tokens, so that light and dark mode both work.
const style = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--accent)' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator, tags.labelName], color: 'var(--text-muted)' },
  { tag: tags.monospace, color: 'var(--text-muted)' },
])

export class RawEditor {
  private view: EditorView
  private extensions
  private states = new Map<number, EditorState>()
  private shown: number | null = null

  constructor(parent: HTMLElement, onChange: (text: string) => void) {
    this.view = new EditorView({ parent })
    this.extensions = [
      history(),
      drawSelection(),
      markdown(),
      syntaxHighlighting(style),
      EditorView.lineWrapping,
      // The tab bar and the banner stick at the top of the window: keep the cursor below them.
      EditorView.scrollMargins.of(() => ({ top: document.getElementById('chrome')?.getBoundingClientRect().bottom ?? 0 })),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      // The find bar of the app replaces the search panel of CodeMirror. The panel must be open
      // for the highlights, so it is an empty element (hidden in find.css).
      search({ createPanel: () => ({ dom: document.createElement('div'), top: true }) }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString())
        if (searchPanelOpen(update.state) && (update.docChanged || update.selectionSet || update.transactions.some((tr) => tr.effects.length))) {
          update.view.dom.dispatchEvent(new CustomEvent(FIND_EVENT, { bubbles: true }))
        }
      }),
    ]
  }

  // Find and replace with @codemirror/search, for the find bar (src/app/FindBar.svelte).
  readonly finder: Finder = {
    search: (query) => {
      if (!query?.text) return void closeSearchPanel(this.view)
      openSearchPanel(this.view)
      const { text: search, caseSensitive, wholeWord } = query
      this.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search, caseSensitive, wholeWord, literal: true })) })
    },
    go: (direction, stay = false) => {
      if (stay) this.view.dispatch({ selection: { anchor: this.view.state.selection.main.from } })
      if (direction === 1) findNext(this.view)
      else findPrevious(this.view)
    },
    replace: (text) => this.withReplacement(text, replaceNext),
    replaceAll: (text) => this.withReplacement(text, replaceAll),
    status: () => {
      const { state } = this.view
      const query = getSearchQuery(state)
      if (!searchPanelOpen(state) || !query.valid) return { current: 0, total: 0 }
      const { from, to } = state.selection.main
      let current = 0
      let total = 0
      for (let cursor = query.getCursor(state), next = cursor.next(); !next.done; next = cursor.next()) {
        total++
        if (next.value.from === from && next.value.to === to) current = total
      }
      return { current, total }
    },
  }

  private withReplacement(replace: string, command: (view: EditorView) => boolean) {
    const query = getSearchQuery(this.view.state)
    this.view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...query, replace })) })
    command(this.view)
  }

  // Show the text of a tab. A text that differs from the shown text (a reload) replaces it.
  show(tab: number, text: string) {
    if (this.shown !== tab) {
      if (this.shown !== null) this.states.set(this.shown, this.view.state)
      this.view.setState(this.states.get(tab) ?? EditorState.create({ doc: text, extensions: this.extensions }))
      this.shown = tab
    }
    if (this.view.state.doc.toString() !== text) {
      this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } })
    }
  }

  // The tab is not in raw mode now.
  forget(tab: number) {
    this.states.delete(tab)
    if (this.shown === tab) this.shown = null
  }

  focus() {
    this.view.focus()
  }
}
