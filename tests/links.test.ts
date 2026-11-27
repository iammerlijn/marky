// @vitest-environment happy-dom
// A click on a link opens it in the browser of the system.
import { afterEach, beforeEach, expect, test } from 'vitest'
import { linkOpener, openableUrl } from '../src/editor/plugins/links'
import { open, type OpenDoc } from './helpers'

let doc: OpenDoc
let opened: string[] = []
const original = linkOpener.open
beforeEach(() => {
  opened = []
  linkOpener.open = async (url) => void opened.push(url)
})
afterEach(async () => {
  linkOpener.open = original
  await doc?.destroy()
})

function click(link: Element, init: MouseEventInit = {}) {
  const { view } = doc
  const pos = view.posAtDOM(link.firstChild!, 1)
  // ProseMirror calls handleClick from its mouse handling. The props are the public way in.
  const event = new MouseEvent('click', { button: 0, ...init })
  Object.defineProperty(event, 'target', { value: link })
  return view.someProp('handleClick', (f) => f(view, pos, event)) ?? false
}

test('a click on a web link opens it, and the document does not change', async () => {
  doc = await open('See [the site](https://example.com/page).\n')
  const link = doc.view.dom.querySelector('a')!
  expect(click(link)).toBe(true)
  expect(opened).toEqual(['https://example.com/page'])
  expect(doc.save().changed).toBe(false)
})

test('a mail link opens, a relative link and other schemes do not', async () => {
  doc = await open('[mail](mailto:a@example.com) [file](notes.md) [local](file:///etc/hosts) [js](javascript:alert(1))\n')
  const links = [...doc.view.dom.querySelectorAll('a')]
  expect(links.map((link) => click(link))).toEqual([true, false, false, false])
  expect(opened).toEqual(['mailto:a@example.com'])
})

test('Shift+click does not open the link', async () => {
  doc = await open('[site](https://example.com)\n')
  expect(click(doc.view.dom.querySelector('a')!, { shiftKey: true })).toBe(false)
  expect(opened).toEqual([])
})

test('openableUrl gives the URL only for web and mail links', () => {
  expect(openableUrl('https://example.com')).toBe('https://example.com/')
  expect(openableUrl('vscode://file/etc')).toBeNull()
  expect(openableUrl('')).toBeNull()
})
