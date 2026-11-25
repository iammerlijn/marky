// The source editor of raw mode (design document, section 6.6): CodeMirror 6 with markdown
// highlighting. Each tab keeps its own CodeMirror state, so it keeps its undo history.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap } from '@codemirror/view'

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
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString())
      }),
    ]
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
