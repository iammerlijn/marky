// Dev preview: the editor in a browser, without Tauri. For screenshots and visual checks.
// ?file=<name> loads a corpus file. ?diff shows the diff that a save writes to the file.
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import 'prosemirror-view/style/prosemirror.css'
import '../src/styles/tokens.css'
import '../src/styles/document.css'
import '../src/styles/outline.css'
import './preview.css'
import { editorViewCtx } from '@milkdown/kit/core'
import { EditorState } from '@milkdown/kit/prose/state'
import { diffLines } from 'diff'
import { createEditor, markdownOf } from '../src/editor/setup'
import { load, save } from '../src/markdown/preserve'
import sample from './sample.md?raw'

const corpus = import.meta.glob<string>('../tests/corpus/*.md', { query: '?raw', import: 'default', eager: true })
const params = new URLSearchParams(location.search)
const file = params.get('file')
const text = file ? corpus[`../tests/corpus/${file}`] : sample

const editor = await createEditor(document.getElementById('editor')!)
const md = markdownOf(editor)
const source = load(md, text)
const view = editor.ctx.get(editorViewCtx)
view.updateState(EditorState.create({ doc: source.doc, plugins: view.state.plugins }))

if (params.has('diff')) {
  const panel = document.getElementById('diff')!
  panel.hidden = false
  const render = () => {
    const result = save(md, source, view.state.doc)
    const parts = diffLines(text, result.text)
    const changed = parts.filter((p) => p.added || p.removed).reduce((n, p) => n + (p.count ?? 0), 0)
    panel.replaceChildren()
    const title = document.createElement('div')
    title.className = 'diff-title'
    title.textContent = result.changed ? `Save writes: ${changed} changed lines` : 'Save writes: no change'
    panel.append(title)
    for (const part of parts) {
      for (const line of part.value.replace(/\n$/, '').split('\n')) {
        const row = document.createElement('div')
        row.className = part.added ? 'added' : part.removed ? 'removed' : 'same'
        row.textContent = (part.added ? '+ ' : part.removed ? '- ' : '  ') + line
        panel.append(row)
      }
    }
    panel.querySelector('.added, .removed')?.scrollIntoView({ block: 'center' })
  }
  // Milkdown owns dispatchTransaction, so check for a new document at each frame.
  let shown: unknown = null
  const loop = () => {
    if (view.state.doc !== shown) {
      shown = view.state.doc
      render()
    }
    requestAnimationFrame(loop)
  }
  loop()
}
