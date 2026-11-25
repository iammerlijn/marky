// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest'
import { placeholderText } from '../src/editor/plugins/placeholder'
import { open, type OpenDoc } from './helpers'

let doc: OpenDoc
afterEach(() => doc?.destroy())

const hint = () => doc.view.dom.querySelector('.is-empty')?.getAttribute('data-placeholder') ?? null

test('an empty document shows the hint, and the file stays empty', async () => {
  doc = await open('')
  expect(hint()).toBe(placeholderText)
  expect(doc.save()).toEqual({ text: '', changed: false })
})

test('the hint goes away when you type', async () => {
  doc = await open('')
  doc.view.dispatch(doc.view.state.tr.insertText('x', 1))
  expect(hint()).toBeNull()
})

test('a document with text shows no hint', async () => {
  doc = await open('Text.\n')
  expect(hint()).toBeNull()
})
