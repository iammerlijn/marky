// @vitest-environment happy-dom
// The app shortcuts win over the keymap of the editor.
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, expect, test, vi } from 'vitest'
import { listenForShortcuts, type Action } from '../src/app/keys'
import { open, type OpenDoc } from './helpers'

// ProseMirror reads Mod as Cmd only on macOS, and it reads the platform when it loads.
vi.hoisted(() => Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true }))

let doc: OpenDoc
let stop: (() => void) | undefined
afterEach(async () => {
  stop?.()
  await doc?.destroy()
})

const press = (key: string) =>
  doc.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true }))

async function inSecondItem() {
  doc = await open('- one\n- two\n')
  let pos = 0
  doc.view.state.doc.descendants((node, p) => {
    if (node.isText && node.text === 'two') pos = p
  })
  doc.view.dispatch(doc.view.state.tr.setSelection(TextSelection.create(doc.view.state.doc, pos)))
}

test('without the app shortcuts, Cmd+] of the list keymap moves the item in', async () => {
  await inSecondItem()
  press(']')
  expect(doc.save().text).not.toBe('- one\n- two\n')
})

test('Cmd+] goes forward and Cmd+[ goes back, and the list item does not move', async () => {
  await inSecondItem()
  const actions: Action[] = []
  stop = listenForShortcuts((action) => actions.push(action), true)
  press(']')
  press('[')
  expect(actions).toEqual(['forward', 'back'])
  expect(doc.save().text).toBe('- one\n- two\n')
})
