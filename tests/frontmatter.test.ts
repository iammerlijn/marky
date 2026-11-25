// @vitest-environment happy-dom
// Front matter (design document, section 6.5; test plan, sections 4 and 5.5).
import { afterEach, describe, expect, test } from 'vitest'
import { fieldsOf, setField } from '../src/editor/plugins/fields'
import { open, type OpenDoc } from './helpers'

describe('fields', () => {
  test('simple values show as fields', () => {
    expect(fieldsOf('title: Plan\ncount: 3\ndraft: true\ndate: 2026-11-25\ntags: [a, b]')).toEqual({
      kind: 'fields',
      fields: [
        { key: 'title', type: 'text', value: 'Plan' },
        { key: 'count', type: 'number', value: '3' },
        { key: 'draft', type: 'boolean', value: 'true' },
        { key: 'date', type: 'text', value: '2026-11-25' },
        { key: 'tags', type: 'list', value: 'a, b' },
      ],
    })
  })

  test.each([
    ['nested objects', 'author:\n  name: A\n  mail: a@example.com'],
    ['anchors', 'base: &b x\nother: *b'],
    ['comments', 'title: Plan # the title'],
    ['a list of objects', 'items:\n  - name: a'],
  ])('%s show as raw YAML', (_, yaml) => {
    expect(fieldsOf(yaml).kind).toBe('raw')
  })

  test('invalid YAML gives an error', () => {
    const result = fieldsOf('title: [unclosed')
    expect(result.kind).toBe('error')
  })

  test('a change of one field changes only its line', () => {
    const yaml = "title: 'Old title'\ntags: [a, b]\ndate: 2026-11-25\ndraft: false"
    expect(setField(yaml, 'title', 'New title')).toBe("title: 'New title'\ntags: [a, b]\ndate: 2026-11-25\ndraft: false")
    expect(setField(yaml, 'tags', 'a, b, c')).toBe("title: 'Old title'\ntags: [a, b, c]\ndate: 2026-11-25\ndraft: false")
    expect(setField(yaml, 'draft', 'true')).toBe("title: 'Old title'\ntags: [a, b]\ndate: 2026-11-25\ndraft: true")
  })

  test('a block list stays a block list', () => {
    expect(setField('tags:\n  - a\n  - b\ntitle: x', 'tags', 'a, c')).toBe('tags:\n  - a\n  - c\ntitle: x')
  })

  test('text that needs quotes gets quotes', () => {
    expect(setField('title: x', 'title', 'a: b')).toBe('title: "a: b"')
  })

  test('a number field keeps a number, and text that is not a number stays text', () => {
    expect(setField('count: 3', 'count', '4')).toBe('count: 4')
    expect(setField('count: 3', 'count', 'four')).toBe('count: four')
  })
})

describe('in the editor', () => {
  let doc: OpenDoc
  afterEach(() => doc?.destroy())

  const text = '---\ntitle: Plan\ntags: [a, b]\n---\n\n# Body\n\nText.\n'

  test('the front matter is one block, not a rule and a heading', async () => {
    doc = await open(text)
    const first = doc.view.state.doc.firstChild!
    expect(first.type.name).toBe('frontmatter')
    expect(first.attrs.value).toBe('title: Plan\ntags: [a, b]')
    expect(doc.view.state.doc.child(1).type.name).toBe('heading')
    expect(doc.save()).toEqual({ text, changed: false })
  })

  test('edit the front matter panel: only the front matter changes', async () => {
    doc = await open(text)
    const first = doc.view.state.doc.firstChild!
    doc.view.dispatch(doc.view.state.tr.setNodeMarkup(0, undefined, { value: setField(first.attrs.value, 'title', 'New plan') }))
    expect(doc.save().text).toBe(text.replace('title: Plan', 'title: New plan'))
  })

  test('the panel shows a field for each simple value', async () => {
    doc = await open(text)
    const labels = [...doc.view.dom.querySelectorAll('.frontmatter label')].map((l) => l.textContent)
    expect(labels).toEqual(['title', 'tags'])
  })

  test('a field edit in the panel changes the document', async () => {
    doc = await open(text)
    const input = doc.view.dom.querySelector<HTMLInputElement>('.frontmatter input[data-key="title"]')!
    input.value = 'Typed'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(doc.save().text).toBe(text.replace('title: Plan', 'title: Typed'))
  })

  test('invalid YAML shows the error and keeps the text', async () => {
    const invalid = '---\ntitle: [unclosed\n---\n\nText.\n'
    doc = await open(invalid)
    expect(doc.view.dom.querySelector('.frontmatter-error')).not.toBeNull()
    expect(doc.view.dom.querySelector<HTMLTextAreaElement>('.frontmatter textarea')!.value).toBe('title: [unclosed')
    expect(doc.save()).toEqual({ text: invalid, changed: false })
  })

  test('complex YAML shows as raw YAML and does not change after a save', async () => {
    const complex = '---\nauthor:\n  name: A # main author\nbase: &b x\n---\n\nText.\n'
    doc = await open(complex)
    expect(doc.view.dom.querySelector('.frontmatter textarea')).not.toBeNull()
    expect(doc.save()).toEqual({ text: complex, changed: false })
  })
})
