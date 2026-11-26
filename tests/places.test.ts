// @vitest-environment happy-dom
// The saved positions of back and forward follow the edits.
import { EditorState } from '@milkdown/kit/prose/state'
import { afterEach, expect, test } from 'vitest'
import { reloadMeta } from '../src/editor/plugins/collapsible'
import { LIMIT, anchor, followed, positionOf, restore } from '../src/editor/plugins/places'
import { open, type OpenDoc } from './helpers'

let doc: OpenDoc
afterEach(() => doc?.destroy())

// The position of the first text node with this text.
const find = (text: string) => {
  let found = -1
  doc.view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text)
  })
  return found
}

test('a saved position moves with text that is typed before it', async () => {
  doc = await open('# A\n\n# B\n')
  const at = anchor(doc.view.state, find('B'))
  doc.view.dispatch(doc.view.state.tr.insertText('More ', find('A')))
  expect(positionOf(doc.view.state, at)).toBe(find('B'))
})

test('after a reload, the old number stays, in the new document', async () => {
  doc = await open('# A\n\nLong text here.\n')
  const at = anchor(doc.view.state, find('here'))
  const next = doc.parse('# A\n')
  const { state } = doc.view
  doc.view.dispatch(state.tr.replaceWith(0, state.doc.content.size, next.content).setMeta(reloadMeta, true))
  expect(positionOf(doc.view.state, at)).toBe(doc.view.state.doc.content.size)
})

test('in a new state of the tab (back from raw mode), the old number stays', async () => {
  doc = await open('# A\n\n# B\n')
  const at = anchor(doc.view.state, find('B'))
  const old = find('B')
  doc.view.updateState(EditorState.create({ doc: doc.parse('# Other A\n\n# B\n'), plugins: doc.view.state.plugins }))
  expect(positionOf(doc.view.state, at)).toBe(old)
})

test('many edits keep no list of edits, and only the newest anchors follow the edits', async () => {
  doc = await open('# A\n\n# B\n')
  const first = anchor(doc.view.state, find('B'))
  for (let i = 0; i < 1000; i++) doc.view.dispatch(doc.view.state.tr.insertText('x', find('A')))
  expect(followed(doc.view.state)).toBe(1)
  expect(positionOf(doc.view.state, first)).toBe(find('B'))
  for (let i = 0; i < LIMIT + 50; i++) anchor(doc.view.state)
  expect(followed(doc.view.state)).toBe(LIMIT)
})

test('restore puts the cursor at the place and opens the closed collapsible around it', async () => {
  doc = await open('Before.\n\n<details>\n<summary>S</summary>\n\n## Inside\n\n</details>\n')
  const pos = find('Inside')
  const collapsible = doc.view.dom.querySelector('.collapsible')!
  expect(collapsible.classList.contains('is-open')).toBe(false)
  restore(doc.view, anchor(doc.view.state, pos))
  expect(doc.view.state.selection.head).toBe(pos)
  expect(doc.view.dom.querySelector('.collapsible')!.classList.contains('is-open')).toBe(true)
})
