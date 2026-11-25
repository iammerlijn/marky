import { Mark, type Node } from '@milkdown/kit/prose/model'

// Block-preserving save (design document, section 5).
//
// A file is a list of top-level blocks with the original text between them (the gaps).
// At save, each top-level editor node that is equal to an original node writes the original
// text of that block. Only the other nodes go through the serializer. Equality, and not
// change tracking, decides if a block is clean: thus a moved block and an edit that is
// undone write the original text again.

export interface Markdown {
  parse(text: string): Node
  serialize(doc: Node): string
  // The top-level blocks as offsets in the text. A hidden block has no editor node.
  blocks(text: string): { start: number; end: number; hidden: boolean }[]
}

interface Block {
  text: string
  // null for a hidden block: a block without an editor node, for example a link definition.
  node: Node | null
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
  const doc = md.parse(body)
  const parsed = md.blocks(body)

  const visible = parsed.filter((b) => !b.hidden).length
  // An empty document still has one empty paragraph in the editor.
  const placeholder = visible === 0 && doc.childCount === 1 && doc.firstChild!.content.size === 0
  if (visible !== doc.childCount && !placeholder) {
    throw new Error(`block map: ${parsed.length} markdown blocks, ${doc.childCount} editor nodes`)
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
  const same = (j: number, i: number) => sameContent(current[j], blocks[i].node!)

  const clean = new Set<number>()
  for (const [j, v] of commonSubsequence(current.length, visible.length, (j, v) => same(j, visible[v]))) {
    place[j] = origin[j] = visible[v]
    clean.add(visible[v])
  }
  const used = new Set(clean)
  // Moved blocks: equal to an original block, but not at the same place.
  for (let j = 0; j < current.length; j++) {
    if (origin[j] >= 0) continue
    const i = visible.find((i) => !used.has(i) && same(j, i))
    if (i !== undefined) {
      origin[j] = i
      used.add(i)
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

  let text = source.bom + gaps[0]
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
  return md.blocks(a + gap + b).length < md.blocks(a).length + md.blocks(b).length
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
  const pairs = commonSubsequence(table.childCount, old.childCount, (j, i) => sameContent(table.child(j), old.child(i)))
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
