// The positions of back and forward (src/app/history.ts). A saved position follows the later
// edits. Each tab has its own editor state, so each tab follows its own edits.
import { Plugin, PluginKey, Selection, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { openAround, reloadMeta } from './collapsible'

export interface Anchor {
  pos: number
  // The list of the state that moves this anchor.
  list: Anchor[]
}

// Each edit moves the anchors of a state, so no list of edits is kept. The history releases an
// anchor when it drops its place, so the list is not longer than the history (src/app/history.ts).
const key = new PluginKey<Anchor[]>('marky-places')

export function anchor(state: EditorState, pos = state.selection.head): Anchor {
  const list = key.getState(state)!
  const at = { pos, list }
  list.push(at)
  return at
}

// The anchor stops following the edits.
export function release(at: Anchor) {
  const index = at.list.indexOf(at)
  if (index >= 0) at.list.splice(index, 1)
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
