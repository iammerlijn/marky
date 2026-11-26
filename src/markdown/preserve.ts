import { Mark, type Node } from '@milkdown/kit/prose/model'

// Block-preserving save.
//
// A file is a list of top-level blocks with the original text between them (the gaps).
// At save, each top-level editor node that is equal to an original node writes the original
// text of that block. Only the other nodes go through the serializer. Equality, and not
// change tracking, decides if a block is clean: thus a moved block and an edit that is
// undone write the original text again.

export interface Markdown {
  parse(text: string): Node
  serialize(doc: Node): string
  // The editor document, and the top-level blocks as offsets in the text. A hidden block has
  // no editor node.
  read(text: string): { doc: Node; blocks: { start: number; end: number; hidden: boolean }[] }
}

interface Block {
  text: string
  // null for a hidden block: a block without an editor node, for example a link definition.
  node: Node | null
}

// The editor made a different number of nodes than the markdown has blocks. Then Marky cannot
// save the file safely as a document. The app opens such a file in raw mode.
export class BlockMapError extends Error {
  constructor(blocks: number, nodes: number) {
    super(`Marky cannot show this text as a document (${blocks} markdown blocks, ${nodes} editor nodes).`)
    this.name = 'BlockMapError'
  }
}

export interface Source {
  text: string
  doc: Node
  bom: string
  eol: string
  blocks: Block[]
  // gaps[i] is the text before blocks[i]. The last gap is the text after the last block.
  gaps: string[]
}

export function load(md: Markdown, text: string): Source {
  const bom = text.startsWith('﻿') ? '﻿' : ''
  const body = text.slice(bom.length)
  const eol = body.includes('\r\n') ? '\r\n' : '\n'
  const { doc, blocks: parsed } = md.read(body)

  const visible = parsed.filter((b) => !b.hidden).length
  // An empty document still has one empty paragraph in the editor.
  const placeholder = visible === 0 && doc.childCount === 1 && doc.firstChild!.content.size === 0
  if (visible !== doc.childCount && !placeholder) {
    throw new BlockMapError(parsed.length, doc.childCount)
  }

  const blocks: Block[] = []
  const gaps: string[] = []
  let end = 0
  let child = 0
  for (const b of parsed) {
    gaps.push(body.slice(end, b.start))
    end = b.end
    blocks.push({ text: body.slice(b.start, b.end), node: b.hidden ? null : doc.child(child++) })
  }
  gaps.push(body.slice(end))
  return { text, doc, bom, eol, blocks, gaps }
}

interface Item {
  text: string
  // Index of the original block at this place in the file, or -1 for a new or moved block.
  // Two items keep the original gap between them only when their places follow each other.
  place: number
  // True when the serializer wrote the text.
  edited: boolean
}

export function save(md: Markdown, source: Source, doc: Node): { text: string; changed: boolean } {
  const { blocks, gaps, eol } = source
  const current: Node[] = []
  doc.forEach((n) => current.push(n))
  const visible = blocks.flatMap((b, i) => (b.node ? [i] : []))

  // place[j] and origin[j] for current node j: origin is the block whose original text it writes.
  const place = new Array<number>(current.length).fill(-1)
  const origin = new Array<number>(current.length).fill(-1)

  const clean = new Set<number>()
  for (const [j, v] of matchNodes(current, visible.map((i) => blocks[i].node!))) {
    place[j] = origin[j] = visible[v]
    clean.add(visible[v])
  }
  const used = new Set(clean)
  // Moved blocks: equal to an original block, but not at the same place.
  // Equal nodes have the same type and text, so only the blocks with that key are compared.
  const key = (node: Node) => node.type.name + '\0' + node.textContent
  const free = new Map<string, number[]>()
  for (const i of visible) {
    if (used.has(i)) continue
    const k = key(blocks[i].node!)
    if (!free.has(k)) free.set(k, [])
    free.get(k)!.push(i)
  }
  for (let j = 0; j < current.length; j++) {
    if (origin[j] >= 0) continue
    const list = free.get(key(current[j])) ?? []
    let k = list.findIndex((i) => current[j] === blocks[i].node)
    if (k < 0) k = list.findIndex((i) => sameContent(current[j], blocks[i].node!))
    if (k >= 0) {
      origin[j] = list[k]
      used.add(list.splice(k, 1)[0])
    }
  }
  // Edited blocks: between two clean blocks, pair the new nodes with the removed blocks in order.
  let j = 0
  let v = 0
  while (j < current.length || v < visible.length) {
    const news: number[] = []
    while (j < current.length && place[j] < 0) {
      if (origin[j] < 0) news.push(j)
      j++
    }
    const removed: number[] = []
    while (v < visible.length && !clean.has(visible[v])) {
      if (!used.has(visible[v])) removed.push(visible[v])
      v++
    }
    for (let k = 0; k < Math.min(news.length, removed.length); k++) place[news[k]] = removed[k]
    j++
    v++
  }

  const items: Item[] = []
  let next = 0
  // Blocks without an editor node stay at their place, after the original block before them.
  const flushHidden = (upTo: number) => {
    for (; next < upTo; next++) if (!blocks[next].node) items.push({ text: blocks[next].text, place: next, edited: false })
  }
  current.forEach((node, j) => {
    if (place[j] >= 0) flushHidden(place[j])
    const edited = origin[j] < 0
    const before = place[j] >= 0 ? blocks[place[j]] : undefined
    const text = !edited
      ? blocks[origin[j]].text
      : node.type.name === 'table' && before?.node?.type === node.type
        ? serializeTable(md, doc, node, before, eol)
        : serializeBlock(md, doc, node, eol)
    if (text !== '') items.push({ text, place: place[j], edited })
  })
  flushHidden(blocks.length)

  // Without blocks, gaps[0] is also the last gap: write it only once, at the end.
  let text = source.bom + (blocks.length > 0 ? gaps[0] : '')
  items.forEach((item, k) => {
    if (k > 0) {
      const previous = items[k - 1]
      const kept = previous.place >= 0 && item.place === previous.place + 1
      let gap = kept ? gaps[item.place] : eol + eol
      // A new gap, or an edited block, can join two blocks into one. For example, two lists of
      // the same type become one list. An HTML comment between them keeps them apart.
      if ((!kept || previous.edited || item.edited) && joins(md, previous.text, gap, item.text)) {
        gap = eol + eol + '<!-- -->' + eol + eol
      }
      text += gap
    }
    text += item.text
  })
  text += gaps[blocks.length]
  // A new file ends with a newline.
  if (source.text === '' && text !== '' && !text.endsWith(eol)) text += eol
  return { text, changed: text !== source.text }
}

function joins(md: Markdown, a: string, gap: string, b: string): boolean {
  return md.read(a + gap + b).blocks.length < md.read(a).blocks.length + md.read(b).blocks.length
}

// Node.eq, but the heading id is ignored. The editor makes the id from the heading text
// after load, and the id is not in the file.
function sameContent(a: Node, b: Node): boolean {
  if (a.eq(b)) return true
  if (a.isText || a.type !== b.type || a.childCount !== b.childCount) return false
  if (a.type.name === 'heading') {
    if (a.attrs.level !== b.attrs.level || !Mark.sameSet(a.marks, b.marks)) return false
  } else if (!a.sameMarkup(b)) return false
  for (let i = 0; i < a.childCount; i++) if (!sameContent(a.child(i), b.child(i))) return false
  return true
}

function serializeBlock(md: Markdown, doc: Node, node: Node, eol: string): string {
  const text = md.serialize(doc.type.create(null, node))
  return text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').replace(/\n/g, eol)
}

// An edited table at its original place: keep the original line of each row that did not change.
// GFM writes each row on one line: line 0 is the header row, line 1 the delimiter row, then the body rows.
function serializeTable(md: Markdown, doc: Node, table: Node, before: Block, eol: string): string {
  const lines = serializeBlock(md, doc, table, eol).split(eol)
  const original = before.text.split(/\r?\n/)
  const old = before.node!
  if (lines.length !== table.childCount + 1 || original.length !== old.childCount + 1) return lines.join(eol)
  const line = (row: number) => (row === 0 ? 0 : row + 1)
  const rows = (node: Node) => Array.from({ length: node.childCount }, (_, i) => node.child(i))
  const pairs = matchNodes(rows(table), rows(old))
  for (const [j, i] of pairs) lines[line(j)] = original[line(i)]
  if (sameColumns(table.child(0), old.child(0))) lines[1] = original[1]
  return lines.join(eol)
}

// Same number of columns and the same alignment: the delimiter row stays valid.
function sameColumns(a: Node, b: Node): boolean {
  if (a.childCount !== b.childCount) return false
  for (let i = 0; i < a.childCount; i++) if (a.child(i).attrs.alignment !== b.child(i).attrs.alignment) return false
  return true
}

// Pairs of equal nodes, as [index in a, index in b]. An untouched block is the same node
// object as its original, so the same objects pair first: two equal blocks with a different
// original text then keep their own text. Between those pairs, equal nodes pair, for
// example a block after an undo.
function matchNodes(a: readonly Node[], b: readonly Node[]): [number, number][] {
  const pairs: [number, number][] = []
  let i0 = 0
  let j0 = 0
  // b has each node object once, so the same objects are a longest increasing subsequence.
  const index = new Map(b.map((node, j) => [node, j]))
  const anchors = increasing(a.map((node) => index.get(node) ?? -1))
  for (const [i, j] of [...anchors, [a.length, b.length]]) {
    for (const [x, y] of commonSubsequence(i - i0, j - j0, (x, y) => sameContent(a[i0 + x], b[j0 + y]))) {
      pairs.push([i0 + x, j0 + y])
    }
    if (i < a.length) pairs.push([i, j])
    i0 = i + 1
    j0 = j + 1
  }
  return pairs
}

// Longest strictly increasing subsequence of the values that are not -1, as pairs
// [index, value]. Patience sort: O(n log n).
function increasing(values: number[]): [number, number][] {
  const tails: number[] = []
  const previous = new Array<number>(values.length).fill(-1)
  values.forEach((value, i) => {
    if (value < 0) return
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (values[tails[middle]] < value) low = middle + 1
      else high = middle
    }
    previous[i] = low > 0 ? tails[low - 1] : -1
    tails[low] = i
  })
  const pairs: [number, number][] = []
  for (let i = tails.at(-1) ?? -1; i >= 0; i = previous[i]) pairs.push([i, values[i]])
  return pairs.reverse()
}

// Larger tables use too much memory. Then only the common start and end pair.
const maxTable = 1 << 20

// Longest common subsequence of a and b, as pairs [index in a, index in b].
// The common start and end are removed first, so a usual edit gives a very small table.
function commonSubsequence(a: number, b: number, equal: (i: number, j: number) => boolean): [number, number][] {
  const pairs: [number, number][] = []
  let start = 0
  while (start < a && start < b && equal(start, start)) pairs.push([start, start++])
  let endA = a
  let endB = b
  const tail: [number, number][] = []
  while (endA > start && endB > start && equal(endA - 1, endB - 1)) tail.unshift([--endA, --endB])

  const n = endA - start
  const m = endB - start
  if ((n + 1) * (m + 1) > maxTable) return pairs.concat(tail)
  const table = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] = equal(start + i, start + j)
        ? table[at(i + 1, j + 1)] + 1
        : Math.max(table[at(i + 1, j)], table[at(i, j + 1)])
    }
  }
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (equal(start + i, start + j)) pairs.push([start + i++, start + j++])
    else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) i++
    else j++
  }
  return pairs.concat(tail)
}
