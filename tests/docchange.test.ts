// @vitest-environment happy-dom
import { editorViewCtx } from '@milkdown/kit/core'
import { EditorState } from '@milkdown/kit/prose/state'
import { expect, test } from 'vitest'
import { createEditor } from '../src/editor/setup'

test('onDocChange runs after an edit and after a new state, not after a selection change', async () => {
  const root = document.createElement('div')
  document.body.append(root)
  let calls = 0
  const editor = await createEditor(root, 'Text.', () => calls++)
  const view = editor.ctx.get(editorViewCtx)
  calls = 0

  view.dispatch(view.state.tr.insertText('x', 1))
  expect(calls).toBe(1)

  view.dispatch(view.state.tr.setMeta('no-change', true))
  expect(calls).toBe(1)

  // The same swap that a tab change does.
  view.updateState(EditorState.create({ doc: view.state.schema.node('doc', null, [view.state.schema.node('paragraph')]), plugins: view.state.plugins }))
  expect(calls).toBe(2)

  await editor.destroy()
  root.remove()
})
