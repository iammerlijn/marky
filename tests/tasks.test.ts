// @vitest-environment happy-dom
// A click on the checkbox of a task checks or unchecks the task.
import { Selection } from '@milkdown/kit/prose/state'
import { afterEach, expect, test } from 'vitest'
import { open, type OpenDoc } from './helpers'

let doc: OpenDoc
afterEach(() => doc?.destroy())

const original = `# Tasks

- [x] Write the import spec
- [ ] Add progress feedback

Last paragraph.
`

// The checkbox is drawn left of the list item, so a click on it has the list item as target.
// happy-dom has no layout: the list item is at x = 0.
function clickBox(item: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent('mousedown', { button: 0, clientX: -10, bubbles: true, cancelable: true, ...init })
  item.dispatchEvent(event)
  return event.defaultPrevented
}

const items = () => [...doc.view.dom.querySelectorAll('li[data-item-type="task"]')]

test('a click on the checkbox checks the task, and a save changes only that line', async () => {
  doc = await open(original)
  expect(clickBox(items()[1])).toBe(true)
  expect(items()[1].getAttribute('data-checked')).toBe('true')
  const { text, changed } = doc.save()
  expect(changed).toBe(true)
  expect(text).toBe(original.replace('- [ ] Add', '- [x] Add'))
})

test('a click on a checked checkbox unchecks the task', async () => {
  doc = await open(original)
  clickBox(items()[0])
  expect(doc.save().text).toBe(original.replace('- [x] Write', '- [ ] Write'))
})

test('two clicks: the file does not change', async () => {
  doc = await open(original)
  clickBox(items()[0])
  clickBox(items()[0])
  expect(doc.save().changed).toBe(false)
})

test('a toggle keeps the original text of the other items', async () => {
  const text = '* [ ]  one\n*   [X] two\n* [ ] three\n'
  doc = await open(text)
  clickBox(items()[2])
  expect(doc.save().text).toBe('* [ ]  one\n*   [X] two\n* [x] three\n')
})

test('a click on the text of a task does not toggle it', async () => {
  doc = await open(original)
  const p = items()[1].querySelector('p')!
  expect(clickBox(p, { clientX: 10 })).toBe(false)
  expect(doc.save().changed).toBe(false)
})

test('a click with another button does not toggle', async () => {
  doc = await open(original)
  expect(clickBox(items()[1], { button: 2 })).toBe(false)
  expect(doc.save().changed).toBe(false)
})

test('a task in a quote, with a task example in a code block: the save does not change the example', async () => {
  const text = '- item\n\n  > - [ ] real\n\n  ```\n  - [ ] example\n  ```\n'
  doc = await open(text)
  clickBox(items()[0])
  const saved = doc.save().text
  expect(saved).toContain('> - [x] real')
  expect(saved).toContain('  - [ ] example')
})

// Typed text goes through handleTextInput, as in the browser. Input rules run there.
function type(text: string) {
  const view = doc.view
  for (const ch of text) {
    const { from, to } = view.state.selection
    const input = () => view.state.tr.insertText(ch, from, to)
    if (!view.someProp('handleTextInput', (f) => f(view, from, to, ch, input))) view.dispatch(input())
  }
}

function cursorAtEnd() {
  const view = doc.view
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
}

test('"[ ] " at the start of a paragraph makes a task', async () => {
  doc = await open('First.\n')
  cursorAtEnd()
  doc.view.dispatch(doc.view.state.tr.split(doc.view.state.selection.from))
  type('[ ] todo')
  expect(items()).toHaveLength(1)
  expect(doc.save().text).toBe('First.\n\n- [ ] todo\n')
})

test('"[x] " at the start of a paragraph makes a checked task', async () => {
  doc = await open('')
  type('[x] done')
  expect(doc.save().text).toBe('- [x] done\n')
})

test('"[ ] " at the start of a list item makes a task', async () => {
  doc = await open('- one\n')
  cursorAtEnd()
  doc.view.dispatch(doc.view.state.tr.split(doc.view.state.selection.from, 2))
  type('[ ] two')
  expect(items()).toHaveLength(1)
  expect(doc.save().text).toBe('- one\n- [ ] two\n')
})

test('"[ ] " in the middle of a paragraph stays text', async () => {
  doc = await open('')
  type('a [ ] b')
  expect(items()).toHaveLength(0)
})

function enter() {
  const view = doc.view
  view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'Enter' })))
}

test('Enter at the end of a checked task makes a task that is not checked', async () => {
  doc = await open('- [x] done\n')
  cursorAtEnd()
  enter()
  type('next')
  expect(doc.save().text).toBe('- [x] done\n- [ ] next\n')
})

test('Enter at the end of a task that is not checked makes a task that is not checked', async () => {
  doc = await open('- [ ] open\n')
  cursorAtEnd()
  enter()
  type('next')
  expect(doc.save().text).toBe('- [ ] open\n- [ ] next\n')
})

test('Enter two times after a checked task ends the list', async () => {
  doc = await open('- [x] done\n')
  cursorAtEnd()
  enter()
  enter()
  type('after')
  expect(items()).toHaveLength(1)
  expect(doc.save().text).toBe('- [x] done\n\nafter\n')
})
