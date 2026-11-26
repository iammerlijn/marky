// The positions of back and forward (src/app/history.ts). A saved position follows the later
// edits. Each tab has its own editor state, so each tab follows its own edits.
import { Plugin, PluginKey, Selection, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { openAround, reloadMeta } from './collapsible'

export interface Anchor {
  pos: number
}

// Each edit moves the newest anchors of a state, so no list of edits is kept. An older anchor
// keeps its last position. The history also keeps no more places than this (src/app/history.ts).
export const LIMIT = 100
const key = new PluginKey<Anchor[]>('marky-places')

export function anchor(state: EditorState, pos = state.selection.head): Anchor {
  const at = { pos }
  const anchors = key.getState(state)!
  anchors.push(at)
  if (anchors.length > LIMIT) anchors.shift()
  return at
}

// The number of anchors that follow the edits of the state.
export const followed = (state: EditorState) => key.getState(state)!.length

// After a reload or in a new state, the edits are not known: then the old number stays, in the
// document.
export const positionOf = (state: EditorState, at: Anchor) => Math.min(at.pos, state.doc.content.size)

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
        init: (): Anchor[] => [],
        apply(tr, anchors) {
          // A reload replaces the whole document: a mapped position would go to its start or end.
          if (tr.getMeta(reloadMeta)) return [] as Anchor[]
          if (tr.docChanged) for (const at of anchors) at.pos = tr.mapping.map(at.pos)
          return anchors
        },
      },
    }),
)
