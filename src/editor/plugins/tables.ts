// Table editing of prosemirror-tables, with a fix for a selection that has one end in a table
// and the other end outside it (or in another table). prosemirror-tables
// - changes such a selection to the text of one block when its end is at the start of a cell,
//   so a drag across a table jumps back to the start block at each cell,
// - makes Shift+Arrow in a cell a cell selection from that cell, so the anchor above the table
//   is lost.
// For such a selection, keep the text selection and let the browser extend it. A selection with
// both ends in one table works as before (for example a cell selection with the mouse).
// The browser paints a text selection in a table as a stripe for the text of each cell. The cells
// that such a selection covers get the class `selectedCell`, like the cells of a cell selection.
// The cells at the edge of the selected block get the classes of those edges (for example
// `selected-top`), so that one outline goes around the block.
// Backspace and Delete also go on past an empty cell: see deleteInTable.
import { tableEditingPlugin, tableSchema } from '@milkdown/kit/preset/gfm'
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import type { Command, EditorState, Selection } from '@milkdown/kit/prose/state'
import { TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import {
  CellSelection,
  TableMap,
  cellAround,
  deleteRow,
  deleteTable,
  fixTables,
  inSameTable,
  selectedRect,
  tableEditing,
} from '@milkdown/kit/prose/tables'
import { $prose } from '@milkdown/kit/utils'

// A text selection that goes out of a table: one end is not in a cell of the table of the other end.
export function leavesTable(selection: Selection): boolean {
  if (!(selection instanceof TextSelection)) return false
  const anchor = cellAround(selection.$anchor)
  const head = cellAround(selection.$head)
  if (!anchor && !head) return false
  return !anchor || !head || !inSameTable(anchor, head)
}

// The cells that a text selection covers from the start to the end of their text. A cell has one
// paragraph, so its text goes from pos + 2 to pos + nodeSize - 2. A selection in one cell does not
// fill it: there the browser paints it correctly.
export function coveredCells(state: EditorState): number[] {
  const { selection } = state
  if (!(selection instanceof TextSelection) || selection.empty) return []
  const { from, to } = selection
  const cells: number[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    const role = node.type.spec.tableRole
    if (role !== 'cell' && role !== 'header_cell') return true
    const end = pos + node.nodeSize
    if (from <= pos + 2 && to >= end - 2 && (from < pos || to > end)) cells.push(pos)
    return false
  })
  return cells
}

// The selected cells: the cells of a cell selection, or the cells that a text selection covers.
export function selectedCells(state: EditorState): number[] {
  const { selection } = state
  if (!(selection instanceof CellSelection)) return coveredCells(state)
  const cells: number[] = []
  selection.forEachCell((_, pos) => cells.push(pos))
  return cells
}

// The class of each selected cell, with an edge class for each side that has no selected neighbour.
export function cellDecorations(state: EditorState): DecorationSet | null {
  const cells = selectedCells(state)
  if (!cells.length) return null
  const selected = new Set(cells)
  // For each table: its map and the box of each cell, from one walk over the map.
  const tables = new Map<number, { map: TableMap; boxes: Map<number, { left: number; top: number; right: number; bottom: number }> }>()
  const tableOf = (start: number, map: TableMap) => {
    let table = tables.get(start)
    if (!table) {
      const boxes = new Map<number, { left: number; top: number; right: number; bottom: number }>()
      map.map.forEach((cell, index) => {
        const row = Math.floor(index / map.width)
        const col = index % map.width
        const box = boxes.get(cell)
        if (box) {
          box.right = col + 1
          box.bottom = row + 1
        } else boxes.set(cell, { left: col, top: row, right: col + 1, bottom: row + 1 })
      })
      table = { map, boxes }
      tables.set(start, table)
    }
    return table
  }
  const decorations = cells.map((pos) => {
    const $cell = state.doc.resolve(pos)
    const start = $cell.start(-1)
    const { map, boxes } = tableOf(start, TableMap.get($cell.node(-1)))
    const { left, top, right, bottom } = boxes.get(pos - start)!
    const at = (row: number, col: number) =>
      row >= 0 && row < map.height && col >= 0 && col < map.width && selected.has(start + map.map[row * map.width + col])
    const edges = [
      at(top - 1, left) ? '' : ' selected-top',
      at(bottom, left) ? '' : ' selected-bottom',
      at(top, left - 1) ? '' : ' selected-left',
      at(top, right) ? '' : ' selected-right',
    ].join('')
    return Decoration.node(pos, pos + $cell.nodeAfter!.nodeSize, { class: 'selectedCell' + edges })
  })
  return DecorationSet.create(state.doc, decorations)
}

// Backspace or Delete in an empty cell selects its row. With whole rows selected, the next press
// deletes them, or the table when they are all its rows. The header row stays: a GFM table must
// have one, so with the header row selected the press only clears the cells (the default). A
// table with only its header row is valid (see tableWithoutRows).
export const deleteInTable: Command = (state, dispatch) => {
  const { selection } = state
  if (selection instanceof CellSelection) {
    if (!selection.isRowSelection()) return false
    if (selection.isColSelection()) return deleteTable(state, dispatch)
    const { top, bottom, map, tableStart } = selectedRect(state)
    if (selectedRect(state).top === 0) return false
    return deleteRow(state, dispatch)
  }
  const $cell = selection.empty ? cellAround(selection.$from) : null
  const cell = $cell?.nodeAfter
  if (!$cell || !cell || cell.childCount !== 1 || cell.firstChild!.content.size > 0) return false
  dispatch?.(state.tr.setSelection(CellSelection.rowSelection($cell)))
  return true
}

const deleteKeys = keydownHandler({ Backspace: deleteInTable, Delete: deleteInTable })

const SHIFT_ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

export const tableSelection = $prose(() => {
  const plugin = tableEditing({ allowTableNodeSelection: true })
  const { appendTransaction } = plugin.spec
  const { handleKeyDown } = plugin.props
  // In place of the decorations of prosemirror-tables, which give only the class `selectedCell`.
  plugin.props.decorations = cellDecorations
  plugin.spec.appendTransaction = (trs, old, state: EditorState) =>
    leavesTable(state.selection) ? fixTables(state, old) : appendTransaction!.call(plugin, trs, old, state)
  plugin.props.handleKeyDown = function (view, event) {
    if (deleteKeys(view, event)) return true
    if (event.shiftKey && SHIFT_ARROWS.has(event.key) && leavesTable(view.state.selection)) return false
    return handleKeyDown!.call(this, view, event)
  }
  return plugin
})

// GFM allows a table with only a header row. The schema of Milkdown needs one more row: without
// this, the last row cannot be deleted, and such a table in a file gets an empty row.
const tableWithoutRows = tableSchema.extendSchema((prev) => (ctx) => ({ ...prev(ctx), content: 'table_header_row table_row*' }))

// The GFM preset with this table editing and table schema in place of its own, at the same place.
const replacements = new Map<unknown, unknown>([
  [tableEditingPlugin, tableSelection],
  [tableSchema.ctx, tableWithoutRows.ctx],
  [tableSchema.node, tableWithoutRows.node],
])
export const withTableSelection = <T>(plugins: T[]): T[] => plugins.map((plugin) => (replacements.get(plugin) as T) ?? plugin)
