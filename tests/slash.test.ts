// @vitest-environment happy-dom
// The `/` menu.
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { afterEach, describe, expect, test } from 'vitest'
import { slashItems, slashKey } from '../src/editor/plugins/slash'
import { open, type OpenDoc } from './helpers'

const source = '# Title\n\nText.\n'

let doc: OpenDoc
afterEach(() => doc?.destroy())

// Open the sample document and put the cursor in a new empty paragraph at the end.
async function openAtEnd(text = source): Promise<EditorView> {
  doc = await open(text)
  const { view } = doc
  const end = view.state.doc.content.size
  const tr = view.state.tr.insert(end, view.state.schema.nodes.paragraph.create())
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 1)))
  return view
}

const type = (view: EditorView, text: string) => view.dispatch(view.state.tr.insertText(text))
const press = (view: EditorView, key: string) =>
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const menu = () => slashKey.getState(doc.view.state)!.open
const labels = () => menu()?.items.map((item) => item.label)
const lastBlock = (view: EditorView) => view.state.doc.lastChild!

describe('slash menu', () => {
  test('/ in an empty paragraph shows all blocks', async () => {
    const view = await openAtEnd()
    type(view, '/')
    expect(labels()).toEqual(slashItems.map((item) => item.label))
    const element = document.querySelector('.slash-menu') as HTMLElement
    expect(element.hidden).toBe(false)
    expect(element.querySelectorAll('[role=option]')).toHaveLength(slashItems.length)
  })

  test('the letters after / filter the blocks', async () => {
    const view = await openAtEnd()
    type(view, '/bul')
    expect(labels()).toEqual(['Bullet list'])
    type(view, 'x')
    expect(menu()).toBeNull()
  })

  test('a keyword also finds a block', async () => {
    const view = await openAtEnd()
    type(view, '/todo')
    expect(labels()).toEqual(['Task list'])
  })

  test('Enter inserts the block, removes the /text and saves only the new block', async () => {
    const view = await openAtEnd()
    type(view, '/bul')
    press(view, 'Enter')
    type(view, 'item')
    expect(menu()).toBeNull()
    expect(doc.save().text).toBe('# Title\n\nText.\n\n- item\n')
  })

  test('arrow keys select another block', async () => {
    const view = await openAtEnd()
    type(view, '/head')
    expect(labels()).toEqual(['Heading 1', 'Heading 2', 'Heading 3'])
    press(view, 'ArrowDown')
    press(view, 'ArrowDown')
    press(view, 'ArrowUp')
    expect(menu()!.index).toBe(1)
    press(view, 'Tab')
    type(view, 'Sub')
    expect(doc.save().text).toBe('# Title\n\nText.\n\n## Sub\n')
  })

  test('Escape closes the menu and keeps the text', async () => {
    const view = await openAtEnd()
    type(view, '/bul')
    press(view, 'Escape')
    expect(menu()).toBeNull()
    type(view, 'k')
    expect(menu()).toBeNull()
    expect(lastBlock(view).textContent).toBe('/bulk')
  })

  test('a / inside a word does not open the menu', async () => {
    const view = await openAtEnd()
    type(view, 'and/or')
    expect(menu()).toBeNull()
  })

  test('a / after a space opens the menu', async () => {
    const view = await openAtEnd()
    type(view, 'Some text /quo')
    expect(labels()).toEqual(['Quote'])
  })

  test('no menu in a code block or a table cell', async () => {
    const view = await openAtEnd('```\ncode\n```\n\n| a |\n|---|\n| b |\n')
    const code = view.state.doc.firstChild!
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, code.nodeSize - 1)))
    type(view, ' /')
    expect(menu()).toBeNull()
    let cell = -1
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'b') cell = pos + 1
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cell)))
    type(view, ' /')
    expect(menu()).toBeNull()
  })

  test('a mouse click on an option inserts the block', async () => {
    const view = await openAtEnd()
    type(view, '/')
    const option = [...document.querySelectorAll('.slash-menu [role=option]')].find((o) => o.textContent?.startsWith('Quote'))!
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(lastBlock(view).type.name).toBe('blockquote')
  })
})

describe('each block', () => {
  const expected: Record<string, (view: EditorView) => void> = {
    'Heading 1': (v) => expect(lastBlock(v).attrs.level).toBe(1),
    'Heading 2': (v) => expect(lastBlock(v).attrs.level).toBe(2),
    'Heading 3': (v) => expect(lastBlock(v).attrs.level).toBe(3),
    'Bullet list': (v) => expect(lastBlock(v).type.name).toBe('bullet_list'),
    'Numbered list': (v) => expect(lastBlock(v).type.name).toBe('ordered_list'),
    'Task list': (v) => expect(lastBlock(v).firstChild!.attrs.checked).toBe(false),
    Quote: (v) => expect(lastBlock(v).type.name).toBe('blockquote'),
    'Code block': (v) => expect(lastBlock(v).type.name).toBe('code_block'),
    'Mermaid diagram': (v) => expect(lastBlock(v).attrs.language).toBe('mermaid'),
    Collapsible: (v) => expect(lastBlock(v).type.name).toBe('collapsible'),
    Table: (v) => expect(v.state.doc.lastChild!.type.name === 'table' || v.state.doc.child(v.state.doc.childCount - 2).type.name === 'table').toBe(true),
    Divider: (v) => expect([...Array(v.state.doc.childCount).keys()].some((i) => v.state.doc.child(i).type.name === 'hr')).toBe(true),
  }

  test.each(slashItems.map((item) => item.label))('%s', async (label) => {
    const view = await openAtEnd()
    type(view, '/')
    const index = menu()!.items.findIndex((item) => item.label === label)
    view.dispatch(view.state.tr.setMeta(slashKey, { index }))
    press(view, 'Enter')
    expected[label](view)
    // The original blocks do not change.
    expect(doc.save().text.startsWith('# Title\n\nText.\n')).toBe(true)
  })
})

test('a divider is saved as ---', async () => {
  const view = await openAtEnd()
  type(view, '/div')
  press(view, 'Enter')
  expect(doc.save().text).toMatch(/^# Title\n\nText\.\n\n---\n/)
})
