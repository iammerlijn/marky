// Box-drawing text (┌─┬─┐ │ ├─┼─┤), for example a table copied from a terminal. Markdown
// reads it as a paragraph. Marky shows it as in the source: monospace, no wrap, and a horizontal
// scroll when it is too wide. Only a class: the document and the file do not change.
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { changedNodes } from './changed'

const BOX = /[─-╿]/

// At least two lines with box-drawing characters, and at least half of the lines.
export function isBoxDrawing(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  const box = lines.filter((line) => BOX.test(line)).length
  return box >= 2 && box * 2 >= lines.length
}

const mark = (node: Node, pos: number) =>
  isBoxDrawing(node.textContent) ? [Decoration.node(pos, pos + node.nodeSize, { class: 'box-drawing' })] : []

function all(doc: Node): DecorationSet {
  const list: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true
    list.push(...mark(node, pos))
    return false
  })
  return DecorationSet.create(doc, list)
}

const key = new PluginKey<DecorationSet>('marky-box-drawing')

export const boxDrawing = $prose(
  () =>
    new Plugin({
      key,
      state: {
        init: (_, state) => all(state.doc),
        apply(tr, set) {
          if (!tr.docChanged) return set
          let next = set.map(tr.mapping, tr.doc)
          for (const [pos, node] of changedNodes(tr, 'paragraph')) {
            // find() also gives the decoration of the paragraph before, which ends at pos.
            next = next.remove(next.find(pos, pos + node.nodeSize).filter((d) => d.from === pos))
            next = next.add(tr.doc, mark(node, pos))
          }
          return next
        },
      },
      props: { decorations: (state) => key.getState(state) },
    }),
)
