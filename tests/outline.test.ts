// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest'
import { headingsOf } from '../src/editor/plugins/outline'
import { open, type OpenDoc } from './helpers'

let doc: OpenDoc
afterEach(() => doc?.destroy())

const outline = async (text: string) => {
  doc = await open(text)
  return headingsOf(doc.view.state.doc).map(({ level, parts }) => ({ level, parts }))
}
const plain = (text: string) => [{ text, code: false }]

test('the headings h1 to h6, with their levels', async () => {
  const text = '# One\n\nText.\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n'
  expect(await outline(text)).toEqual([
    { level: 1, parts: plain('One') },
    { level: 2, parts: plain('Two') },
    { level: 3, parts: plain('Three') },
    { level: 4, parts: plain('Four') },
    { level: 5, parts: plain('Five') },
    { level: 6, parts: plain('Six') },
  ])
})

test('inline code is a separate part, other marks are plain text', async () => {
  expect(await outline('## Use `load()` and **save**\n')).toEqual([
    {
      level: 2,
      parts: [
        { text: 'Use ', code: false },
        { text: 'load()', code: true },
        { text: ' and save', code: false },
      ],
    },
  ])
})

test('headings inside a collapsible are included', async () => {
  const text = '# Top\n\n<details>\n<summary>More</summary>\n\n## Inside\n\nText.\n\n</details>\n\n## After\n'
  expect((await outline(text)).map((h) => h.parts[0].text)).toEqual(['Top', 'Inside', 'After'])
})

test('a document without headings gives an empty list, and shows no rail', async () => {
  expect(await outline('')).toEqual([])
  expect(doc.view.dom.parentElement!.querySelector<HTMLElement>('.outline')!.hidden).toBe(true)
  await doc.destroy()
  expect(await outline('Text only.\n')).toEqual([])
})

test('the positions point at the heading nodes', async () => {
  doc = await open('Intro.\n\n# One\n\n## Two\n')
  for (const { pos } of headingsOf(doc.view.state.doc)) expect(doc.view.state.doc.nodeAt(pos)?.type.name).toBe('heading')
})
