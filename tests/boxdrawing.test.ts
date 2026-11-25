// @vitest-environment happy-dom
// Box-drawing tables copied from a terminal: a paragraph in markdown, shown as in the source.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { isBoxDrawing } from '../src/editor/plugins/boxdrawing'
import { open, type OpenDoc } from './helpers'

const sample = readFileSync(join(import.meta.dirname, 'corpus', 'box-drawing.md'), 'utf8')

describe('isBoxDrawing', () => {
  test('a table of box-drawing lines', () => {
    expect(isBoxDrawing('┌──┬──┐\n│ a│ b│\n└──┴──┘')).toBe(true)
  })
  test.each([
    ['normal text', 'Text on\ntwo lines.'],
    ['one line', '──────'],
    ['one box line among many text lines', 'One\nTwo\nThree\n│ four'],
  ])('not: %s', (_, text) => expect(isBoxDrawing(text)).toBe(false))
})

describe('in the editor', () => {
  let doc: OpenDoc
  afterEach(() => doc?.destroy())
  const boxes = () => [...doc.view.dom.querySelectorAll('p.box-drawing')]

  test('the box-drawing paragraphs get the class, the other paragraphs do not', async () => {
    doc = await open(sample)
    expect(boxes()).toHaveLength(2)
    expect(boxes()[0].textContent).toContain('┌──────┬')
    expect(doc.view.dom.querySelectorAll('p:not(.box-drawing)').length).toBeGreaterThan(2)
  })

  test('a save without edits does not change the lines', async () => {
    doc = await open(sample)
    expect(doc.save()).toEqual({ text: sample, changed: false })
  })

  test('an edit in another paragraph keeps the class, and new box lines get it', async () => {
    doc = await open('Text.\n\n┌──┐\n│ a│\n└──┘\n')
    const { view } = doc
    view.dispatch(view.state.tr.insertText('More ', 1))
    expect(boxes()).toHaveLength(1)
    view.dispatch(view.state.tr.insertText('\n┌──┐\n└──┘', view.state.doc.firstChild!.nodeSize - 1))
    expect(boxes()).toHaveLength(2)
  })
})
