// The positions of back and forward (src/app/history.ts). A saved position follows the later
// edits. Each tab has its own editor state, so each tab follows its own edits.
import { Plugin, PluginKey, Selection, type EditorState } from '@milkdown/kit/prose/state'
import { Mapping } from '@milkdown/kit/prose/transform'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { openAround, reloadMeta } from './collapsible'

// The edits since the state was made or the file was reloaded.
const key = new PluginKey<Mapping>('marky-places')

export interface Anchor {
  pos: number
  mapping: Mapping
  // The number of edits in the mapping when the position was saved.
  from: number
}

export function anchor(state: EditorState, pos = state.selection.head): Anchor {
  const mapping = key.getState(state)!
  return { pos, mapping, from: mapping.maps.length }
}

// The position now. After a reload or in a new state, the edits are not known: then the old
// number stays, in the document.
export function positionOf(state: EditorState, at: Anchor): number {
  const mapping = key.getState(state)!
  const pos = mapping === at.mapping ? mapping.slice(at.from).map(at.pos) : at.pos
  return Math.min(pos, state.doc.content.size)
}

// Put the cursor at the position, and open the closed collapsibles around it.
export function restore(view: EditorView, at: Anchor) {
  const pos = positionOf(view.state, at)
  openAround(view, pos)
  view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos))))
}

export const places = $prose(
  () =>
    new Plugin({
      key,
      state: {
        init: () => new Mapping(),
        apply(tr, mapping) {
          // A reload replaces the whole document: a mapped position would go to its start or end.
          if (tr.getMeta(reloadMeta)) return new Mapping()
          if (tr.docChanged) mapping.appendMapping(tr.mapping)
          return mapping
        },
      },
    }),
)
