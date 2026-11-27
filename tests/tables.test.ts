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

// The browser paints a text selection in a table as a stripe for the text of each cell.
describe('cells that a text selection covers', () => {
  const selected = () => [...doc.view.dom.querySelectorAll('.selectedCell')].map((cell) => cell.textContent)

  test('a selection across a whole table fills all its cells', async () => {
    doc = await open(text)
    select(1, cellStart('Below.') + 2)
    expect(selected()).toEqual(['A', 'B', 'one', 'two'])
  })

  test('a selection into a table fills the cells before its end, not the cell of its end', async () => {
    doc = await open(text)
    select(1, cellStart('two') + 1)
    expect(selected()).toEqual(['A', 'B', 'one'])
  })

  test('a selection from the start of a cell to below the table fills that cell', async () => {
    doc = await open(text)
    select(cellStart('Below.') + 2, cellStart('one'))
    expect(selected()).toEqual(['one', 'two'])
  })

  test('a selection of the text of one cell does not fill it', async () => {
    doc = await open(text)
    select(cellStart('one'), cellStart('one') + 3)
    expect(selected()).toEqual([])
  })

  test('the cells are not filled after the selection collapses', async () => {
    doc = await open(text)
    select(1, cellStart('Below.'))
    select(1, 1)
    expect(selected()).toEqual([])
  })
})

// One outline goes around the selected cells: each cell has a class for each outer edge.
describe('the outline of the selected cells', () => {
  const edges = () =>
    Object.fromEntries(
      [...doc.view.dom.querySelectorAll('.selectedCell')].map((cell) => [
        cell.textContent,
        ['top', 'bottom', 'left', 'right'].filter((edge) => cell.classList.contains(`selected-${edge}`)),
      ]),
    )

  test('a cell selection of the whole table has an outline around the table', async () => {
    doc = await open(text)
    const { view } = doc
    const $a = view.state.doc.resolve(cellStart('A') - 2)
    const $b = view.state.doc.resolve(cellStart('two') - 2)
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, $a.pos, $b.pos)))
    expect(edges()).toEqual({ A: ['top', 'left'], B: ['top', 'right'], one: ['bottom', 'left'], two: ['bottom', 'right'] })
  })

  test('one selected cell has all four edges', async () => {
    doc = await open(text)
    const { view } = doc
    const pos = view.state.doc.resolve(cellStart('one') - 2).pos
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, pos)))
    expect(edges()).toEqual({ one: ['top', 'bottom', 'left', 'right'] })
  })

  test('the cells that a text selection covers get the edges of their block', async () => {
    doc = await open(text)
    select(1, cellStart('two') + 1)
    expect(edges()).toEqual({ A: ['top', 'left'], B: ['top', 'bottom', 'right'], one: ['bottom', 'left', 'right'] })
  })
})

describe('Backspace and Delete in a table', () => {
  const rows = 'Above.\n\n| A | B |\n|---|---|\n| one | two |\n|  | four |\n| five | six |\n\nBelow.\n'

  // The position before the first cell with this text.
  function cellBefore(name: string): number {
    let found = -1
    doc.view.state.doc.descendants((node, pos) => {
      if (found < 0 && node.type.spec.tableRole?.includes('cell') && node.textContent === name) found = pos
      return found < 0
    })
    return found
  }

  function press(key: string): boolean {
    const { view } = doc
    const event = new KeyboardEvent('keydown', { key })
    return view.someProp('handleKeyDown', (f) => f(view, event)) ?? false
  }

  function selectRow(name: string) {
    const { view } = doc
    const $cell = view.state.doc.resolve(cellBefore(name))
    view.dispatch(view.state.tr.setSelection(CellSelection.rowSelection($cell)))
  }

  test('Backspace in an empty cell selects its row', async () => {
    doc = await open(rows)
    select(cellBefore('') + 2, cellBefore('') + 2)
    expect(press('Backspace')).toBe(true)
    const selection = doc.view.state.selection as CellSelection
    expect(selection).toBeInstanceOf(CellSelection)
    expect(selection.isRowSelection()).toBe(true)
    expect(doc.view.dom.querySelectorAll('.selectedCell')).toHaveLength(2)
  })

  test('Delete with a row selected deletes the row', async () => {
    doc = await open(rows)
    selectRow('')
    expect(press('Delete')).toBe(true)
    expect(doc.save().text).toBe('Above.\n\n| A | B |\n|---|---|\n| one | two |\n| five | six |\n\nBelow.\n')
    expect(doc.view.state.selection.$from.parent.textContent).toBe('five')
  })

  test('with all rows selected, Backspace deletes the table', async () => {
    doc = await open(rows)
    const { view } = doc
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellBefore('A'), cellBefore('six'))))
    expect(press('Backspace')).toBe(true)
    expect(doc.save().text).toBe('Above.\n\nBelow.\n')
    expect(view.state.selection.$from.parent.textContent).toBe('Below.')
  })

  test('in a table with one row, Backspace selects the row, then deletes it and keeps the header', async () => {
    doc = await open('Above.\n\n| A |\n|---|\n|  |\n\nBelow.\n')
    select(cellBefore('') + 2, cellBefore('') + 2)
    press('Backspace')
    press('Backspace')
    expect(doc.save().text).toBe('Above.\n\n| A |\n|---|\n\nBelow.\n')
  })

  test('a table with only a header row stays as it is', async () => {
    doc = await open('| A | B |\n|---|---|\n')
    expect(doc.view.state.doc.child(0).childCount).toBe(1)
  })

  test('in a table with only a header row, a selected row deletes the table', async () => {
    doc = await open('Above.\n\n| A |\n|---|\n\nBelow.\n')
    selectRow('A')
    press('Backspace')
    expect(doc.save().text).toBe('Above.\n\nBelow.\n')
  })

  test('with the header row selected, Backspace only clears its cells', async () => {
    doc = await open(rows)
    selectRow('A')
    expect(press('Backspace')).toBe(true)
    const table = doc.view.state.doc.child(1)
    expect(table.childCount).toBe(4)
    expect(table.child(0).textContent).toBe('')
  })

  test('Backspace in a cell with text is the normal text delete', async () => {
    doc = await open(rows)
    select(cellBefore('two') + 2, cellBefore('two') + 2)
    expect(press('Backspace')).toBe(false)
    expect(doc.view.state.selection).toBeInstanceOf(TextSelection)
  })

  test('a cell selection that is not whole rows only clears the cells', async () => {
    doc = await open(rows)
    const { view } = doc
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellBefore('one'))))
    expect(press('Delete')).toBe(true)
    const table = view.state.doc.child(1)
    expect(table.childCount).toBe(4)
    expect(table.child(1).textContent).toBe('two')
  })
})
