// Table editing of prosemirror-tables, with a fix for a selection that has one end in a table
// and the other end outside it (or in another table). prosemirror-tables
// - changes such a selection to the text of one block when its end is at the start of a cell,
//   so a drag across a table jumps back to the start block at each cell,
// - makes Shift+Arrow in a cell a cell selection from that cell, so the anchor above the table
//   is lost.
// For such a selection, keep the text selection and let the browser extend it. A selection with
// both ends in one table works as before (for example a cell selection with the mouse).
import { tableEditingPlugin } from '@milkdown/kit/preset/gfm'
import type { EditorState, Selection } from '@milkdown/kit/prose/state'
import { TextSelection } from '@milkdown/kit/prose/state'
import { cellAround, fixTables, inSameTable, tableEditing } from '@milkdown/kit/prose/tables'
import { $prose } from '@milkdown/kit/utils'

// A text selection that goes out of a table: one end is not in a cell of the table of the other end.
export function leavesTable(selection: Selection): boolean {
  if (!(selection instanceof TextSelection)) return false
  const anchor = cellAround(selection.$anchor)
  const head = cellAround(selection.$head)
  if (!anchor && !head) return false
  return !anchor || !head || !inSameTable(anchor, head)
}

const SHIFT_ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

export const tableSelection = $prose(() => {
  const plugin = tableEditing({ allowTableNodeSelection: true })
  const { appendTransaction } = plugin.spec
  const { handleKeyDown } = plugin.props
  plugin.spec.appendTransaction = (trs, old, state: EditorState) =>
    leavesTable(state.selection) ? fixTables(state, old) : appendTransaction!.call(plugin, trs, old, state)
  plugin.props.handleKeyDown = function (view, event) {
    if (event.shiftKey && SHIFT_ARROWS.has(event.key) && leavesTable(view.state.selection)) return false
    return handleKeyDown!.call(this, view, event)
  }
  return plugin
})

// The GFM preset with this table editing in place of its own, at the same place.
export const withTableSelection = <T>(plugins: T[]): T[] =>
  plugins.map((plugin) => (plugin === (tableEditingPlugin as unknown) ? (tableSelection as T) : plugin))
