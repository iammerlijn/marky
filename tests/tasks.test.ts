// @vitest-environment happy-dom
// A click on the checkbox of a task checks or unchecks the task.
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
