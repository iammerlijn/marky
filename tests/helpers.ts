import { editorViewCtx } from '@milkdown/kit/core'
import type { Node } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createEditor, markdownOf } from '../src/editor/setup'
import { load, save } from '../src/markdown/preserve'

export interface OpenDoc {
  view: EditorView
  parse(text: string): Node
  save(): { text: string; changed: boolean }
  destroy(): Promise<void>
}

export async function open(text: string): Promise<OpenDoc> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const editor = await createEditor(root)
  const md = markdownOf(editor)
  const source = load(md, text)
  const view = editor.ctx.get(editorViewCtx)
  // The same swap that a tab does: a new state with the loaded document.
  view.updateState(EditorState.create({ doc: source.doc, plugins: view.state.plugins }))
  return {
    view,
    parse: md.parse,
    save: () => save(md, source, view.state.doc),
    destroy: async () => {
      await editor.destroy()
      root.remove()
    },
  }
}
