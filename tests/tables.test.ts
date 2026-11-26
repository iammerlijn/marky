// @vitest-environment happy-dom
// Selections across tables (issue #45).
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import { afterEach, describe, expect, test } from 'vitest'
import { open, type OpenDoc } from './helpers'

let doc: OpenDoc
afterEach(() => doc?.destroy())

const text = 'Above.\n\n| A | B |\n|---|---|\n| one | two |\n\nBelow.\n\n| C |\n|---|\n| three |\n'

// The position at the start of the text of the first cell with this text.
function cellStart(name: string): number {
  let found = -1
  doc.view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent === name) found = pos + 1
    return found < 0
  })
  return found
}

function select(anchor: number, head: number) {
  const { view } = doc
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))
  return view.state.selection
}

describe('selection across a table', () => {
  test('a selection from above the table to the start of a cell stays as it is', async () => {
    doc = await open(text)
    const selection = select(1, cellStart('one'))
    expect(selection).toBeInstanceOf(TextSelection)
    expect([selection.anchor, selection.head]).toEqual([1, cellStart('one')])
  })

  test('a selection from a cell to the start of the block below the table stays as it is', async () => {
    doc = await open(text)
    const selection = select(cellStart('two') + 1, cellStart('Below.'))
    expect([selection.anchor, selection.head]).toEqual([cellStart('two') + 1, cellStart('Below.')])
  })

  test('a selection from a cell of one table to the start of a cell of another table stays as it is', async () => {
    doc = await open(text)
    const selection = select(cellStart('one') + 1, cellStart('three'))
    expect([selection.anchor, selection.head]).toEqual([cellStart('one') + 1, cellStart('three')])
  })

  test('in one table, a text selection to the start of the next cell is still the text of the first cell', async () => {
    doc = await open(text)
    const selection = select(cellStart('one') + 1, cellStart('two'))
    expect([selection.from, selection.to]).toEqual([cellStart('one'), cellStart('one') + 3])
  })

  test('a cell selection in one table still works', async () => {
    doc = await open(text)
    const { view } = doc
    const $a = view.state.doc.resolve(cellStart('A') - 2)
    const $b = view.state.doc.resolve(cellStart('two') - 2)
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, $a.pos, $b.pos)))
    expect(view.state.selection).toBeInstanceOf(CellSelection)
    expect(view.dom.querySelectorAll('.selectedCell')).toHaveLength(4)
  })
})
