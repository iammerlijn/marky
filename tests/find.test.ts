// @vitest-environment happy-dom
// Find and replace in the document and in the source view.
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, test } from 'vitest'
import { RawEditor } from '../src/app/raw'
import { documentFinder, findMatches, matchesIn, type Finder, type Query } from '../src/editor/plugins/find'
import { open, type OpenDoc } from './helpers'

const q = (text: string, options: Partial<Query> = {}): Query => ({ text, caseSensitive: false, wholeWord: false, ...options })

// Non-default syntax in each block, so that a block that is serialized again shows a change.
const original = `---
title: Plan
---

# Plan for the *plan*

* first plan item
* other item

| Area | Note |
|:--|--:|
| a | the plan |
| b | other |

\`\`\`js
const plan = 1
\`\`\`

\`\`\`mermaid
graph TD
  plan --> done
\`\`\`

<details>
<summary>More</summary>

A plan in a closed section.

</details>

Planning is not a whole word match.


Last paragraph, after two blank lines.
`

let doc: OpenDoc
afterEach(() => doc?.destroy())

const selected = (doc: OpenDoc) => doc.view.state.doc.textBetween(doc.view.state.selection.from, doc.view.state.selection.to)

describe('matches', () => {
  test('match case and whole word', () => {
    expect(matchesIn('Plan plan planning', q('plan'))).toEqual([[0, 4], [5, 9], [10, 14]])
    expect(matchesIn('Plan plan planning', q('plan', { caseSensitive: true }))).toEqual([[5, 9], [10, 14]])
    expect(matchesIn('Plan plan planning', q('plan', { wholeWord: true }))).toEqual([[0, 4], [5, 9]])
    expect(matchesIn('a.b a+b', q('.'))).toEqual([[1, 2]])
    expect(matchesIn('anything', q(''))).toEqual([])
  })

  test('in headings, lists, table cells, code blocks, diagrams and collapsibles, not in front matter', async () => {
    doc = await open(original)
    const found = findMatches(doc.view.state.doc, q('plan', { wholeWord: true })).map((m) => {
      const $pos = doc.view.state.doc.resolve(m.from)
      return $pos.node($pos.depth - ($pos.parent.type.name === 'paragraph' && $pos.depth > 1 ? 1 : 0)).type.name
    })
    expect(found).toEqual(['heading', 'heading', 'list_item', 'table_cell', 'code_block', 'code_block', 'collapsible'])
  })
})

describe('document', () => {
  let finder: Finder
  async function start(text: string, query: Query) {
    doc = await open(text)
    finder = documentFinder(doc.view)
    finder.search(query)
  }

  test('next and previous wrap around, and the status counts', async () => {
    await start('one two one\n\nthree one\n', q('one'))
    expect(finder.status()).toEqual({ current: 0, total: 3 })
    finder.go(1)
    expect(finder.status()).toEqual({ current: 1, total: 3 })
    finder.go(1)
    finder.go(1)
    expect(finder.status().current).toBe(3)
    finder.go(1)
    expect(finder.status().current).toBe(1)
    finder.go(-1)
    expect(finder.status().current).toBe(3)
    expect(doc.view.dom.querySelectorAll('.find-match')).toHaveLength(3)
    expect(doc.view.dom.querySelector('.find-current')?.textContent).toBe('one')
  })

  test('while you type, the match at the cursor stays selected', async () => {
    await start('plan planning\n', q('pla'))
    finder.go(1, true)
    finder.go(1, true)
    expect(doc.view.state.selection.from).toBe(1)
    finder.search(q('plann'))
    finder.go(1, true)
    expect(selected(doc)).toBe('plann')
  })

  test('a match in a closed collapsible opens it', async () => {
    await start('<details>\n<summary>More</summary>\n\nHidden text.\n\n</details>\n', q('hidden'))
    expect(doc.view.dom.querySelector('.collapsible')!.classList.contains('is-open')).toBe(false)
    finder.go(1)
    expect(doc.view.dom.querySelector('.collapsible')!.classList.contains('is-open')).toBe(true)
    expect(selected(doc)).toBe('Hidden')
  })

  test('the source of a Mermaid diagram shows when it has the current match', async () => {
    await start('Text.\n\n```mermaid\ngraph TD\n  a --> b\n```\n', q('graph'))
    finder.go(1)
    expect(doc.view.dom.querySelector('.code-block')!.classList.contains('is-editing')).toBe(true)
  })

  test('Replace changes the current match and goes to the next one', async () => {
    await start('a cat and a cat\n', q('cat'))
    finder.replace('dog')
    // Without a selected match, Replace first selects the next one.
    expect(doc.view.state.doc.textContent).toBe('a cat and a cat')
    expect(finder.status().current).toBe(1)
    finder.replace('cats')
    expect(doc.view.state.doc.textContent).toBe('a cats and a cat')
    // The next match is after the new text, not in it.
    expect(finder.status()).toEqual({ current: 2, total: 2 })
    expect(doc.view.state.selection.from).toBe(14)
  })

  test('Replace All is one undo step', async () => {
    await start(original, q('plan', { wholeWord: true }))
    const before = doc.view.state.doc
    // Type first, so that the replace does not join the undo step of the typing.
    doc.view.dispatch(doc.view.state.tr.setSelection(TextSelection.atEnd(doc.view.state.doc)).insertText('!'))
    const typed = doc.view.state.doc
    finder.replaceAll('idea')
    expect(finder.status().total).toBe(0)
    expect(doc.view.state.doc.textContent).not.toContain('plan')
    undo(doc.view.state, doc.view.dispatch)
    expect(doc.view.state.doc.eq(typed)).toBe(true)
    undo(doc.view.state, doc.view.dispatch)
    expect(doc.view.state.doc.eq(before)).toBe(true)
  })

  test('Replace All changes only the blocks with a match (clean saves)', async () => {
    await start(original, q('plan', { wholeWord: true, caseSensitive: true }))
    finder.replaceAll('idea')
    // The list is written again as a whole block, with the bullet of the serializer.
    const expected = original
      .replace('*plan*', '*idea*')
      .replace('* first plan item\n* other item', '- first idea item\n- other item')
      .replace('the plan', 'the idea')
      .replace('const plan', 'const idea')
      .replace('  plan -->', '  idea -->')
      .replace('A plan in', 'A idea in')
    expect(doc.save().text).toBe(expected)
  })

  test('a closed bar removes the highlights', async () => {
    await start('one two one\n', q('one'))
    finder.search(null)
    expect(finder.status().total).toBe(0)
    expect(doc.view.dom.querySelector('.find-match')).toBeNull()
  })
})

describe('source view', () => {
  let raw: RawEditor
  let text = ''
  let root: HTMLElement
  afterEach(() => root.remove())

  function start(source: string) {
    root = document.createElement('div')
    document.body.append(root)
    raw = new RawEditor(root, (t) => (text = t))
    raw.show(1, source)
    text = source
  }

  test('find, replace and Replace All, also in the front matter', () => {
    start('---\ntitle: plan\n---\n\nA plan. Planning.\n')
    raw.finder.search(q('plan', { wholeWord: true }))
    expect(raw.finder.status()).toEqual({ current: 0, total: 2 })
    raw.finder.go(1)
    expect(raw.finder.status()).toEqual({ current: 1, total: 2 })
    raw.finder.replace('idea')
    expect(text).toBe('---\ntitle: idea\n---\n\nA plan. Planning.\n')
    expect(raw.finder.status()).toEqual({ current: 1, total: 1 })
    raw.finder.search(q('PLAN', { caseSensitive: true }))
    expect(raw.finder.status().total).toBe(0)
    raw.finder.search(q('plan'))
    raw.finder.replaceAll('x')
    expect(text).toBe('---\ntitle: idea\n---\n\nA x. xning.\n')
    raw.finder.search(null)
    expect(raw.finder.status().total).toBe(0)
  })
})
