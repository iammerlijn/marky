// @vitest-environment happy-dom
// Collapsibles.
import type { Node } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, test } from 'vitest'
import { slashKey } from '../src/editor/plugins/slash'
import { open, type OpenDoc } from './helpers'

let doc: OpenDoc
afterEach(() => doc?.destroy())

// The structure of a node as nested type names, for example ['collapsible', ['paragraph']].
function shape(node: Node): unknown {
  const children: unknown[] = []
  node.forEach((child) => {
    if (!child.isInline) children.push(shape(child))
  })
  return children.length ? [node.type.name, ...children] : node.type.name
}

const first = () => doc.view.state.doc.firstChild!
function textPos(needle: string): number {
  let found = -1
  doc.view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle)
  })
  return found
}

describe('read', () => {
  test('<details> with <summary> is one collapsible', async () => {
    doc = await open('<details>\n<summary>Summary</summary>\n\nBody with **bold**.\n\n- a list\n\n</details>\n')
    expect(doc.view.state.doc.childCount).toBe(1)
    expect(first().type.name).toBe('collapsible')
    expect(first().attrs.summary).toBe('Summary')
    expect(shape(first())).toEqual(['collapsible', 'paragraph', ['bullet_list', ['list_item', 'paragraph']]])
  })

  test('<details> without <summary>', async () => {
    doc = await open('<details>\n\nNo summary here.\n\n</details>\n')
    expect(first().type.name).toBe('collapsible')
    expect(first().attrs.summary).toBe('')
  })

  test('<summary> in its own HTML block', async () => {
    doc = await open('<details>\n\n<summary>Apart</summary>\n\nBody\n\n</details>\n')
    expect(first().attrs.summary).toBe('Apart')
    expect(shape(first())).toEqual(['collapsible', 'paragraph'])
  })

  test('+++ Title … +++ (Linear)', async () => {
    doc = await open('+++ Agent notes\n\nDetails.\n\n- a list\n\n+++\n')
    expect(first().type.name).toBe('collapsible')
    expect(first().attrs.summary).toBe('Agent notes')
    expect(shape(first())).toEqual(['collapsible', 'paragraph', ['bullet_list', ['list_item', 'paragraph']]])
  })

  test('nested collapsibles with a table, a list and code', async () => {
    doc = await open(
      '<details>\n<summary>Outer</summary>\n\n+++ Inner\n\n| a |\n|---|\n| 1 |\n\n+++\n\n- item\n\n```js\nx\n```\n\n</details>\n',
    )
    expect(shape(first())).toEqual([
      'collapsible',
      ['collapsible', ['table', ['table_header_row', ['table_header', 'paragraph']], ['table_row', ['table_cell', 'paragraph']]]],
      ['bullet_list', ['list_item', 'paragraph']],
      'code_block',
    ])
  })

  test('a collapsible in a list item', async () => {
    doc = await open('- item\n\n  <details>\n  <summary>In a list</summary>\n\n  Body\n\n  </details>\n')
    let found = false
    doc.view.state.doc.descendants((node) => {
      if (node.type.name === 'collapsible') found = true
    })
    expect(found).toBe(true)
  })

  test('<details> without </details> stays HTML', async () => {
    doc = await open('<details>\n<summary>Open</summary>\n\nBody\n')
    expect(first().type.name).not.toBe('collapsible')
    expect(doc.save()).toEqual({ text: '<details>\n<summary>Open</summary>\n\nBody\n', changed: false })
  })

  test('a file with collapsibles saves without changes', async () => {
    const text = 'Before.\n\n<details open>\n<summary>S</summary>\n\nBody\n\n</details>\n\n+++ T\n\nBody\n\n+++\n\nAfter.\n'
    doc = await open(text)
    expect(doc.save()).toEqual({ text, changed: false })
  })
})

describe('write', () => {
  const plus = 'Before.\n\n+++ Agent notes\n\nDetails.\n\n- a list\n\n+++\n\nAfter.\n'

  test('an edited +++ collapsible is written as <details>, the other blocks do not change', async () => {
    doc = await open(plus)
    doc.view.dispatch(doc.view.state.tr.insertText('More ', textPos('Details.')))
    expect(doc.save().text).toBe(
      'Before.\n\n<details>\n<summary>Agent notes</summary>\n\nMore Details.\n\n- a list\n\n</details>\n\nAfter.\n',
    )
  })

  test('an edit after a collapsible does not change the collapsible', async () => {
    doc = await open(plus)
    doc.view.dispatch(doc.view.state.tr.insertText('!', textPos('After.') + 6))
    expect(doc.save().text).toBe(plus.replace('After.', 'After.!'))
  })

  test('the attributes of <details> stay', async () => {
    doc = await open('<details open class="x">\n<summary>S</summary>\n\nBody\n\n</details>\n')
    doc.view.dispatch(doc.view.state.tr.insertText('New ', textPos('Body')))
    expect(doc.save().text).toBe('<details open class="x">\n<summary>S</summary>\n\nNew Body\n\n</details>\n')
  })

  test('a collapsible without a summary is written without <summary>', async () => {
    doc = await open('<details>\n\nBody\n\n</details>\n')
    doc.view.dispatch(doc.view.state.tr.insertText('New ', textPos('Body')))
    expect(doc.save().text).toBe('<details>\n\nNew Body\n\n</details>\n')
  })

  test('an edited summary is written', async () => {
    doc = await open('<details>\n<summary>Old</summary>\n\nBody\n\n</details>\n')
    doc.view.dispatch(doc.view.state.tr.setNodeMarkup(0, undefined, { ...first().attrs, summary: 'New' }))
    expect(doc.save().text).toBe('<details>\n<summary>New</summary>\n\nBody\n\n</details>\n')
  })

  test('the saved text reads back as the same document', async () => {
    doc = await open(plus)
    doc.view.dispatch(doc.view.state.tr.insertText('More ', textPos('Details.')))
    const before = doc.view.state.doc
    const text = doc.save().text
    expect(doc.parse(text).eq(before)).toBe(true)
  })

  test('the / menu inserts a collapsible', async () => {
    doc = await open('Text.\n')
    const { view } = doc
    const end = view.state.doc.content.size
    const tr = view.state.tr.insert(end, view.state.schema.nodes.paragraph.create())
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)))
    view.dispatch(view.state.tr.insertText('/coll'))
    expect(slashKey.getState(view.state)!.open!.items.map((i) => i.label)).toEqual(['Collapsible'])
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    view.dispatch(view.state.tr.insertText('Inside'))
    expect(doc.save().text).toBe('Text.\n\n<details>\n<summary>Details</summary>\n\nInside\n\n</details>\n')
  })
})

describe('open or closed', () => {
  const isOpen = (index = 0) => doc.view.dom.querySelectorAll('.collapsible')[index].classList.contains('is-open')
  const toggle = (index = 0) =>
    doc.view.dom.querySelectorAll<HTMLButtonElement>('.collapsible-toggle')[index].dispatchEvent(new MouseEvent('click', { bubbles: true }))

  test('<details open> starts open, <details> starts closed', async () => {
    doc = await open('<details open>\n<summary>A</summary>\n\nA\n\n</details>\n\n<details>\n<summary>B</summary>\n\nB\n\n</details>\n')
    expect([isOpen(0), isOpen(1)]).toEqual([true, false])
  })

  test('the toggle opens and closes, and the file does not change', async () => {
    const text = '<details>\n<summary>S</summary>\n\nBody\n\n</details>\n'
    doc = await open(text)
    toggle()
    expect(isOpen()).toBe(true)
    expect(doc.save()).toEqual({ text, changed: false })
    toggle()
    expect(isOpen()).toBe(false)
  })

  test('the state is part of the editor state, so each tab keeps it', async () => {
    doc = await open('Before.\n\n<details>\n<summary>S</summary>\n\nBody\n\n</details>\n')
    toggle()
    const state = doc.view.state
    // Another tab: a new state in the same view.
    doc.view.updateState(EditorState.create({ doc: doc.parse('# Other\n'), plugins: state.plugins }))
    doc.view.updateState(state)
    expect(isOpen()).toBe(true)
  })

  test('the state follows the collapsible when text before it changes', async () => {
    doc = await open('Before.\n\n<details>\n<summary>S</summary>\n\nBody\n\n</details>\n')
    toggle()
    doc.view.dispatch(doc.view.state.tr.insertText('More text. ', 1))
    expect(isOpen()).toBe(true)
  })

  test('an edit of the summary keeps it open', async () => {
    doc = await open('<details>\n<summary>S</summary>\n\nBody\n\n</details>\n')
    toggle()
    doc.view.dispatch(doc.view.state.tr.setNodeMarkup(0, undefined, { ...first().attrs, summary: 'New' }))
    expect(isOpen()).toBe(true)
  })

  test('a new block just before the collapsible does not move the state to it', async () => {
    doc = await open('<details>\n<summary>S</summary>\n\nBody\n\n</details>\n')
    toggle()
    doc.view.dispatch(doc.view.state.tr.insert(0, doc.view.state.schema.nodes.paragraph.create()))
    expect(isOpen()).toBe(true)
  })

  test('a new collapsible from the / menu is open', async () => {
    doc = await open('Text.\n')
    const { view } = doc
    const end = view.state.doc.content.size
    const tr = view.state.tr.insert(end, view.state.schema.nodes.paragraph.create())
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)))
    view.dispatch(view.state.tr.insertText('/coll'))
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(isOpen()).toBe(true)
  })
})
