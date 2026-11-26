// @vitest-environment happy-dom
// An edit changes only the edited blocks.
import type { Node } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import { undo } from '@milkdown/kit/prose/history'
import { addColumnAfter, addRowAfter, deleteRow } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { afterEach, describe, expect, test } from 'vitest'
import { open, type OpenDoc } from './helpers'

// Non-default syntax everywhere, so that a block that is serialized again shows a change.
const original = `# Title

First paragraph with *star emphasis*.


Second paragraph after two blank lines.

| a | b |
|:--|--:|
| 1 | 2 |

|x|y|
|-|-|
|3|4|

* star list
* item

Last paragraph.
`

let doc: OpenDoc
afterEach(() => doc?.destroy())

// Start position of the top-level block with this index.
function blockPos(view: EditorView, index: number): number {
  let pos = 0
  for (let i = 0; i < index; i++) pos += view.state.doc.child(i).nodeSize
  return pos
}

function textPos(view: EditorView, needle: string): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    const i = node.isText ? node.text!.indexOf(needle) : -1
    if (i >= 0) found = pos + i
  })
  if (found < 0) throw new Error(`text not found: ${needle}`)
  return found
}

function nodes(markdown: string): Node[] {
  const result: Node[] = []
  doc.parse(markdown).forEach((n) => result.push(n))
  return result
}

// The result must be `before + <anything> + after`, where before and after are exact
// parts of the original text around the edited block.
function expectOnlyChanged(result: string, block: string, source = original) {
  const start = source.indexOf(block)
  expect(start).toBeGreaterThanOrEqual(0)
  const before = source.slice(0, start)
  const after = source.slice(start + block.length)
  expect(result.startsWith(before), 'text before the block changed').toBe(true)
  expect(result.endsWith(after), 'text after the block changed').toBe(true)
  return result.slice(before.length, result.length - after.length)
}

describe('edits', () => {
  test('type a word in a paragraph: only that paragraph changes', async () => {
    doc = await open(original)
    const { view } = doc
    view.dispatch(view.state.tr.insertText(' Word', textPos(view, 'Second paragraph') + 'Second paragraph'.length))
    const { text, changed } = doc.save()
    expect(changed).toBe(true)
    expect(text).toBe(original.replace('Second paragraph after', 'Second paragraph Word after'))
  })

  test('edit a table cell: only that table changes', async () => {
    doc = await open(original)
    const { view } = doc
    view.dispatch(view.state.tr.insertText('x', textPos(view, '3') + 1))
    const middle = expectOnlyChanged(doc.save().text, '|x|y|\n|-|-|\n|3|4|')
    expect(middle).toContain('3x')
  })

  test('split a paragraph: the other blocks do not change', async () => {
    doc = await open(original)
    const { view } = doc
    const pos = textPos(view, ' after two')
    view.dispatch(view.state.tr.split(pos))
    const middle = expectOnlyChanged(doc.save().text, 'Second paragraph after two blank lines.')
    expect(middle).toMatch(/^Second paragraph\n\n.*after two blank lines\.$/)
  })

  test('join two paragraphs: the other blocks do not change', async () => {
    doc = await open(original)
    const { view } = doc
    view.dispatch(view.state.tr.join(blockPos(view, 2)))
    const block = original.slice(original.indexOf('First'), original.indexOf('lines.') + 'lines.'.length)
    const middle = expectOnlyChanged(doc.save().text, block)
    expect(middle).toContain('Second paragraph after two blank lines.')
    expect(middle).not.toContain('\n')
  })

  test('move a block: the moved block keeps its original text', async () => {
    doc = await open(original)
    const { view } = doc
    const from = blockPos(view, 5)
    const list = view.state.doc.child(5)
    const tr = view.state.tr.delete(from, from + list.nodeSize).insert(blockPos(view, 1), list)
    view.dispatch(tr)
    expect(doc.save().text).toBe(`# Title

* star list
* item

First paragraph with *star emphasis*.


Second paragraph after two blank lines.

| a | b |
|:--|--:|
| 1 | 2 |

|x|y|
|-|-|
|3|4|

Last paragraph.
`)
  })

  test('delete a block: the other blocks and the space between them do not change', async () => {
    doc = await open(original)
    const { view } = doc
    const from = blockPos(view, 3)
    view.dispatch(view.state.tr.delete(from, from + view.state.doc.child(3).nodeSize))
    expect(doc.save().text).toBe(original.replace('| a | b |\n|:--|--:|\n| 1 | 2 |\n\n', ''))
  })

  test('add a block at the start and at the end: the final newline does not change', async () => {
    doc = await open(original)
    const { view } = doc
    const paragraph = () => view.state.schema.nodes.paragraph.create(null, view.state.schema.text('New'))
    view.dispatch(view.state.tr.insert(0, paragraph()))
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, paragraph()))
    expect(doc.save().text).toBe(`New\n\n${original}\nNew\n`)
  })

  test('add a block at the end of a file without a final newline', async () => {
    const source = '# Title\n\nText.'
    doc = await open(source)
    const { view } = doc
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create(null, view.state.schema.text('New'))))
    expect(doc.save().text).toBe('# Title\n\nText.\n\nNew')
  })

  test('delete one of two equal blocks with different syntax: the other block keeps its own text', async () => {
    doc = await open('- same\n\n* same\n')
    const { view } = doc
    view.dispatch(view.state.tr.delete(0, view.state.doc.child(0).nodeSize))
    expect(doc.save().text).toBe('* same\n')
  })

  // The match of the blocks does not use a table of blocks × blocks (memory) for a large move.
  test('reverse 2000 blocks: each block keeps its text', async () => {
    const paragraphs = Array.from({ length: 2000 }, (_, i) => `Paragraph ${i}.`)
    doc = await open(paragraphs.join('\n\n') + '\n')
    const { view } = doc
    const reversed: Node[] = []
    view.state.doc.forEach((node) => reversed.unshift(node))
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, reversed))
    expect(doc.save().text).toBe(paragraphs.reverse().join('\n\n') + '\n')
  })

  test('edit, then undo: the file does not change', async () => {
    doc = await open(original)
    const { view } = doc
    view.dispatch(view.state.tr.insertText('Word ', textPos(view, 'Last')))
    expect(doc.save().changed).toBe(true)
    undo(view.state, view.dispatch)
    expect(doc.save()).toEqual({ text: original, changed: false })
  })

  test('type a character and delete it: the file does not change', async () => {
    doc = await open(original)
    const { view } = doc
    const pos = textPos(view, 'Last')
    view.dispatch(view.state.tr.insertText('x', pos))
    view.dispatch(view.state.tr.delete(pos, pos + 1))
    expect(doc.save()).toEqual({ text: original, changed: false })
  })

  test('paste a large part of another document: only the new blocks are serialized', async () => {
    doc = await open(original)
    const { view } = doc
    const pasted = nodes('## Pasted\n\n* a\n* b\n\n_Para_')
    view.dispatch(view.state.tr.insert(blockPos(view, 1), pasted))
    const result = doc.save().text
    expect(result).toBe(original.replace('# Title\n\n', '# Title\n\n## Pasted\n\n- a\n- b\n\n_Para_\n\n'))
  })

  test('a selection change alone does not change the file', async () => {
    doc = await open(original)
    const { view } = doc
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, textPos(view, 'Last'))))
    expect(doc.save()).toEqual({ text: original, changed: false })
  })

})

describe('line endings and BOM', () => {
  test('an edited block in a CRLF file uses CRLF', async () => {
    const source = '# Title\r\n\r\nFirst.\r\n\r\n* a\r\n* b\r\n'
    doc = await open(source)
    const { view } = doc
    view.dispatch(view.state.tr.insertText('x', textPos(view, 'a') + 1))
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph.create(null, view.state.schema.text('New'))))
    const { text } = doc.save()
    expect(text).toBe('# Title\r\n\r\nFirst.\r\n\r\n- ax\r\n- b\r\n\r\nNew\r\n')
  })

  test('an edit keeps the BOM', async () => {
    const source = '﻿# Title\n\nText.\n'
    doc = await open(source)
    const { view } = doc
    view.dispatch(view.state.tr.insertText('!', textPos(view, 'Text.') + 5))
    expect(doc.save().text).toBe('﻿# Title\n\nText.!\n')
  })
})

describe('a file with only whitespace', () => {
  test('a save without edits writes the file once', async () => {
    doc = await open(' \n\n')
    expect(doc.save()).toEqual({ text: ' \n\n', changed: false })
  })

  test('typed text comes before the whitespace', async () => {
    doc = await open(' \n\n')
    doc.view.dispatch(doc.view.state.tr.insertText('Hello', 1))
    expect(doc.save().text).toBe('Hello \n\n')
  })
})

describe('blocks without an editor node', () => {
  const source = `See [the docs][docs].

[docs]: https://example.com/docs

Next.
`

  test('a deleted paragraph next to a link definition keeps the definition', async () => {
    doc = await open(source)
    const { view } = doc
    view.dispatch(view.state.tr.delete(0, view.state.doc.child(0).nodeSize))
    expect(doc.save().text).toBe('[docs]: https://example.com/docs\n\nNext.\n')
  })

  test('an edited paragraph that uses a link definition keeps the definition', async () => {
    doc = await open(source)
    const { view } = doc
    view.dispatch(view.state.tr.insertText('Now see', 1, 4))
    const { text } = doc.save()
    expect(text).toContain('\n\n[docs]: https://example.com/docs\n\nNext.\n')
    expect(text).toContain('Now see')
  })
})

describe('blocks that join when they come together', () => {
  const lists = '- a\n- b\n\nMiddle.\n\n- c\n- d\n'

  test('delete the paragraph between two lists: the lists stay two lists', async () => {
    doc = await open(lists)
    const { view } = doc
    const from = view.state.doc.child(0).nodeSize
    view.dispatch(view.state.tr.delete(from, from + view.state.doc.child(1).nodeSize))
    const { text } = doc.save()
    expect(text).toBe('- a\n- b\n\n<!-- -->\n\n- c\n- d\n')
    expect(doc.parse(text).childCount).toBe(3)
  })

  test('move a list next to a list of the same type: the lists stay two lists', async () => {
    doc = await open(lists)
    const { view } = doc
    const last = view.state.doc.child(2)
    const from = view.state.doc.content.size - last.nodeSize
    view.dispatch(view.state.tr.delete(from, from + last.nodeSize).insert(0, last))
    const { text } = doc.save()
    expect(text).toBe('- c\n- d\n\n<!-- -->\n\n- a\n- b\n\nMiddle.\n')
  })

  test('change a paragraph to a list next to a list: the lists stay two lists', async () => {
    doc = await open(lists)
    const { view } = doc
    const { schema } = view.state
    const from = view.state.doc.child(0).nodeSize
    const item = schema.nodes.list_item.create(null, schema.nodes.paragraph.create(null, schema.text('new')))
    view.dispatch(view.state.tr.replaceWith(from, from + view.state.doc.child(1).nodeSize, schema.nodes.bullet_list.create(null, item)))
    const { text } = doc.save()
    expect(doc.parse(text).childCount).toBe(5)
    expect(text.startsWith('- a\n- b\n\n')).toBe(true)
    expect(text.endsWith('- c\n- d\n')).toBe(true)
  })

  test('two clean blocks that follow each other keep their original gap', async () => {
    doc = await open(lists)
    expect(doc.save().changed).toBe(false)
  })
})

describe('table rows', () => {
  const table = `Text.

| Name | Owner | Due |
|:-----|:------|----:|
| Import   | Anna | Dec 4 |
| Start    | Joris | Dec 9 |
| Fixes    | Sam | Nov 28 |

Text after.
`

  // Put the cursor in the cell with this text, then run a table command.
  function inCell(view: EditorView, text: string, command: (state: EditorView['state'], dispatch: EditorView['dispatch']) => boolean) {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, textPos(view, text))))
    expect(command(view.state, view.dispatch)).toBe(true)
  }

  test('edit a cell: only the line of that row changes', async () => {
    doc = await open(table)
    const { view } = doc
    view.dispatch(view.state.tr.insertText(' Mon', textPos(view, 'Dec 9') + 5))
    expect(doc.save().text).toBe(table.replace('| Start    | Joris | Dec 9 |', '| Start | Joris | Dec 9 Mon |'))
  })

  test('edit a header cell: the delimiter row does not change', async () => {
    doc = await open(table)
    const { view } = doc
    view.dispatch(view.state.tr.insertText('s', textPos(view, 'Owner') + 5))
    expect(doc.save().text).toBe(table.replace('| Name | Owner | Due |', '| Name | Owners | Due |'))
  })

  test('add a row: only the new line is added', async () => {
    doc = await open(table)
    const { view } = doc
    inCell(view, 'Joris', addRowAfter)
    const { text } = doc.save()
    const lines = text.split('\n')
    const start = lines.findIndex((l) => l.includes('Joris'))
    expect(lines.slice(0, start + 1).join('\n')).toBe(table.split('\n').slice(0, start + 1).join('\n'))
    expect(lines.slice(start + 2).join('\n')).toBe(table.split('\n').slice(start + 1).join('\n'))
    expect(lines[start + 1]).toMatch(/^\|.*\|$/)
  })

  test('delete a row: only that line is removed', async () => {
    doc = await open(table)
    const { view } = doc
    inCell(view, 'Joris', deleteRow)
    expect(doc.save().text).toBe(table.replace('| Start    | Joris | Dec 9 |\n', ''))
  })

  test('add a column: the table is written again and stays valid', async () => {
    doc = await open(table)
    const { view } = doc
    inCell(view, 'Owner', addColumnAfter)
    const middle = expectOnlyChanged(doc.save().text, table.slice(table.indexOf('| Name'), table.indexOf('\n\nText after')), table)
    const lines = middle.split('\n')
    expect(lines).toHaveLength(5)
    for (const line of lines) expect(line.split('|')).toHaveLength(6)
  })

  test('edit a cell in a CRLF file: the row uses CRLF and the other lines do not change', async () => {
    const source = '| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n| 3 | 4 |\r\n'
    doc = await open(source)
    const { view } = doc
    view.dispatch(view.state.tr.insertText('x', textPos(view, '3') + 1))
    expect(doc.save().text).toBe('| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n| 3x | 4 |\r\n')
  })

  test('delete one of two equal rows with different spacing: the other row keeps its own line', async () => {
    const source = '| a |\n|---|\n|  x |\n| x  |\n'
    doc = await open(source)
    const { view } = doc
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, textPos(view, 'x'))))
    deleteRow(view.state, view.dispatch)
    expect(doc.save().text).toBe('| a |\n|---|\n| x  |\n')
  })
})
