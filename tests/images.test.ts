// @vitest-environment happy-dom
import { EditorState } from '@milkdown/kit/prose/state'
import { afterEach, expect, test } from 'vitest'
import { blockedText, isRemote, loadText } from '../src/editor/plugins/images'
import { open, type OpenDoc } from './helpers'

let doc: OpenDoc
afterEach(() => doc?.destroy())

const page = 'tauri://localhost/index.html'
const pixel = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='

test.each([
  ['https://example.invalid/pixel', true],
  ['http://example.invalid/pixel', true],
  ['HTTPS://example.invalid/pixel', true],
  ['  https://example.invalid/pixel', true],
  ['//example.invalid/pixel', true],
  ['ftp://example.invalid/pixel', true],
  ['file:///etc/hosts', true],
  ['tauri://other/pixel', true],
  ['http://[bad', true],
  ['pixel.png', false],
  ['./images/pixel.png', false],
  ['/pixel.png', false],
  [pixel, false],
  ['asset://localhost/home/user/pixel.png', false],
])('%s is remote: %s', (src, remote) => {
  expect(isRemote(src, page)).toBe(remote)
})

const imgs = () => [...doc.view.dom.querySelectorAll('img:not(.ProseMirror-separator)')].map((img) => img.getAttribute('src'))
const placeholders = () => [...doc.view.dom.querySelectorAll('.remote-image')]
const loadButton = () => doc.view.dom.querySelector<HTMLButtonElement>('.remote-image button')!

test('a remote image shows a placeholder, not an img', async () => {
  doc = await open('![x](https://example.invalid/pixel)\n')
  expect(imgs()).toEqual([])
  expect(placeholders().map((p) => p.textContent)).toEqual([`${blockedText}: x${loadText}`])
})

test('an embedded image loads', async () => {
  doc = await open(`![x](${pixel})\n`)
  expect(imgs()).toEqual([pixel])
  expect(placeholders()).toEqual([])
})

test('the button loads the remote images of the document, and the file does not change', async () => {
  doc = await open(`![a](https://example.invalid/a) ![b](${pixel})\n\n![c](https://example.invalid/c)\n`)
  expect(imgs()).toEqual([pixel])
  loadButton().click()
  expect(imgs()).toEqual(['https://example.invalid/a', pixel, 'https://example.invalid/c'])
  expect(placeholders()).toEqual([])
  expect(doc.save().changed).toBe(false)
})

test('a remote image added after the button loads', async () => {
  doc = await open('![a](https://example.invalid/a)\n\nText.\n')
  loadButton().click()
  const node = doc.view.state.schema.nodes.image.create({ src: 'https://example.invalid/b' })
  doc.view.dispatch(doc.view.state.tr.insert(doc.view.state.doc.content.size - 1, node))
  expect(imgs()).toEqual(['https://example.invalid/a', 'https://example.invalid/b'])
})

test('another document blocks remote images again', async () => {
  doc = await open('![a](https://example.invalid/a)\n')
  loadButton().click()
  await doc.destroy()
  doc = await open('![a](https://example.invalid/a)\n')
  expect(imgs()).toEqual([])
})

test('a tab change in the same editor view blocks remote images again', async () => {
  const text = '![a](https://example.invalid/a)\n'
  doc = await open(text)
  loadButton().click()
  expect(imgs()).toEqual(['https://example.invalid/a'])
  // The same swap that a tab does, with an image that has the same attributes.
  doc.view.updateState(EditorState.create({ doc: doc.parse(text), plugins: doc.view.state.plugins }))
  expect(imgs()).toEqual([])
  expect(placeholders()).toHaveLength(1)
})
