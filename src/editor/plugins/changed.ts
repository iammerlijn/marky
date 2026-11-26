// The nodes of one type in the ranges that a transaction changed, by their position in the new
// document. Plugins use it to update their decorations only where an edit happened: a walk of a
// long document at each key is too slow.
import type { Node } from '@milkdown/kit/prose/model'
import type { Transaction } from '@milkdown/kit/prose/state'

export function changedNodes(tr: Transaction, type: string): Map<number, Node> {
  const touched = new Map<number, Node>()
  tr.mapping.maps.forEach((map, index) => {
    const after = tr.mapping.slice(index + 1)
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = Math.max(0, after.map(newStart, -1) - 1)
      const to = Math.min(tr.doc.content.size, after.map(newEnd, 1) + 1)
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== type) return true
        touched.set(pos, node)
        return false
      })
    })
  })
  return touched
}
