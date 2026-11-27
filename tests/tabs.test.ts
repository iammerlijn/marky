// @vitest-environment happy-dom
// Tabs, and changes to an open file by another app.
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Backend, Opened, SaveError } from '../src/app/backend'
import { LARGE_TEXT, Tabs, type Tab } from '../src/app/tabs'
import { createEditor, markdownOf } from '../src/editor/setup'

// Files in memory. The version changes on each write, as the modification time does on disk.
class FakeBackend implements Backend {
  files = new Map<string, { text: string; version: number }>()
  saves: string[] = []
  watched = new Set<string>()
  private clock = 0

  write(path: string, text: string): string {
    this.files.set(path, { text, version: ++this.clock })
    return String(this.clock)
  }
  async open(path: string): Promise<Opened> {
    const file = this.files.get(path)
    if (!file) throw `No such file: ${path}`
    return { text: file.text, version: String(file.version) }
  }
  creates: string[] = []
  async create(path: string, text: string): Promise<string> {
    this.creates.push(path)
    return this.write(path, text)
  }
  async save(path: string, text: string, expectedVersion: string): Promise<string> {
    const file = this.files.get(path)
    if (!file || String(file.version) !== expectedVersion) throw { kind: 'Conflict' } satisfies SaveError
    this.saves.push(path)
    return this.write(path, text)
  }
  async watch(path: string) {
    this.watched.add(path)
  }
  async unwatch(path: string) {
    this.watched.delete(path)
  }
}

let backend: FakeBackend
let view: EditorView
let tabs: Tabs
let scrollTop = 0
// The answer of the Save As dialog.
let chosenPath: string | null = null
let destroy: () => Promise<void>
// The texts that the block map read.
let reads: string[] = []

beforeEach(async () => {
  backend = new FakeBackend()
  backend.write('/a.md', '# A\n\nText of A.\n')
  backend.write('/b.md', '# B\n\nText of B.\n')
  const root = document.createElement('div')
  document.body.append(root)
  const editor = await createEditor(root)
  view = editor.ctx.get(editorViewCtx)
  chosenPath = null
  // A text with BREAK_THE_BLOCK_MAP gets one more markdown block than editor nodes. No real file
  // causes this yet, but Marky must stay safe when one does.
  const md = markdownOf(editor)
  const read = md.read
  reads = []
  md.read = (text) => {
    reads.push(text)
    const result = read(text)
    if (text.includes('BREAK_THE_BLOCK_MAP')) result.blocks.push({ start: text.length, end: text.length, hidden: false })
    return result
  }
  tabs = new Tabs(view, md, backend, { get: () => scrollTop, set: (top) => (scrollTop = top) }, async () => chosenPath)
  destroy = async () => {
    await editor.destroy()
    root.remove()
  }
})
afterEach(() => destroy())

const type = (text: string) => view.dispatch(view.state.tr.insertText(text, 1))
const docText = () => view.state.doc.textContent
const tab = (path: string) => tabs.tabs.find((t) => t.path === path)!
const discard = async () => 'discard' as const
const cancel = async () => 'cancel' as const

describe('tabs', () => {
  test('open two files: two tabs, the second is active', async () => {
    await tabs.open('/a.md')
    await tabs.open('/b.md')
    expect(tabs.tabs.map((t) => t.path)).toEqual(['/a.md', '/b.md'])
    expect(tabs.active?.path).toBe('/b.md')
    expect(docText()).toContain('Text of B.')
    expect([...backend.watched]).toEqual(['/a.md', '/b.md'])
  })

  test('when the watch fails, the file does not open, and the next open tries again', async () => {
    const watch = backend.watch.bind(backend)
    backend.watch = async () => {
      throw new Error('watch failed')
    }
    await expect(tabs.open('/a.md')).rejects.toThrow('watch failed')
    expect(tabs.tabs).toHaveLength(0)
    backend.watch = watch
    await tabs.open('/a.md')
    expect(tabs.tabs).toHaveLength(1)
    expect(backend.watched.has('/a.md')).toBe(true)
  })

  test('the previous and the next tab, with a wrap at the ends', async () => {
    await tabs.open('/a.md')
    await tabs.open('/b.md')
    tabs.newTab()
    tabs.activateNext(1)
    expect(tabs.active?.path).toBe('/a.md')
    tabs.activateNext(-1)
    expect(tabs.active?.path).toBeNull()
    tabs.activateNext(-1)
    expect(tabs.active?.path).toBe('/b.md')
  })

  test('the next tab with no tabs does nothing', () => {
    tabs.activateNext(1)
    expect(tabs.active).toBeNull()
  })

  test('open a file that is already open: Marky selects its tab', async () => {
    await tabs.open('/a.md')
    await tabs.open('/b.md')
    await tabs.open('/a.md')
    expect(tabs.tabs).toHaveLength(2)
    expect(tabs.active?.path).toBe('/a.md')
  })

  test('each tab keeps its content, selection, scroll position and undo history', async () => {
    await tabs.open('/a.md')
    type('Edit A ')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)))
    scrollTop = 120
    await tabs.open('/b.md')
    type('Edit B ')
    scrollTop = 0
    tabs.activate(tab('/a.md').id)
    expect(docText()).toContain('Edit A')
    expect(docText()).not.toContain('Edit B')
    expect(view.state.selection.from).toBe(3)
    expect(scrollTop).toBe(120)
    // Undo in tab A does not undo the edit of tab B.
    undo(view.state, view.dispatch)
    expect(docText()).not.toContain('Edit A')
    tabs.activate(tab('/b.md').id)
    expect(docText()).toContain('Edit B')
  })

  test('save in tab A writes only file A', async () => {
    await tabs.open('/a.md')
    type('Edit A ')
    await tabs.open('/b.md')
    type('Edit B ')
    tabs.activate(tab('/a.md').id)
    expect(await tabs.save()).toBe(true)
    expect(backend.saves).toEqual(['/a.md'])
    expect(backend.files.get('/a.md')!.text).toContain('Edit A')
    expect(backend.files.get('/b.md')!.text).toBe('# B\n\nText of B.\n')
  })

  test('save of an inactive tab writes the content of that tab', async () => {
    await tabs.open('/a.md')
    type('Edit A ')
    await tabs.open('/b.md')
    expect(await tabs.save(tab('/a.md').id)).toBe(true)
    expect(backend.files.get('/a.md')!.text).toContain('Edit A')
    expect(backend.files.get('/b.md')!.text).toBe('# B\n\nText of B.\n')
  })

  test('save without edits writes nothing', async () => {
    await tabs.open('/a.md')
    expect(await tabs.save()).toBe(true)
    expect(backend.saves).toEqual([])
  })

  test('the dirty flag follows the edits', async () => {
    await tabs.open('/a.md')
    type('x')
    tabs.refreshDirty()
    expect(tab('/a.md').dirty).toBe(true)
    await tabs.save()
    expect(tab('/a.md').dirty).toBe(false)
    undo(view.state, view.dispatch)
    tabs.refreshDirty()
    expect(tab('/a.md').dirty).toBe(true)
  })

  test('an edit during a save keeps the tab dirty', async () => {
    await tabs.open('/a.md')
    type('first ')
    const save = backend.save.bind(backend)
    let finish = () => {}
    backend.save = (...args) => new Promise((resolve) => (finish = () => resolve(save(...args))))
    const saved = tabs.save()
    type('second ')
    finish()
    expect(await saved).toBe(true)
    expect(backend.files.get('/a.md')!.text).not.toContain('second')
    expect(tab('/a.md').dirty).toBe(true)
  })

  test('two saves in a row: the second save keeps the blocks of the first', async () => {
    await tabs.open('/a.md')
    type('One ')
    await tabs.save()
    view.dispatch(view.state.tr.insertText('Two ', view.state.doc.child(0).nodeSize + 1))
    await tabs.save()
    expect(backend.files.get('/a.md')!.text).toBe('# One A\n\nTwo Text of A.\n')
  })
})

describe('close', () => {
  test('a tab without edits closes without a question', async () => {
    await tabs.open('/a.md')
    await tabs.open('/b.md')
    expect(await tabs.close(tab('/b.md').id, cancel)).toBe(true)
    expect(tabs.tabs.map((t) => t.path)).toEqual(['/a.md'])
    expect(tabs.active?.path).toBe('/a.md')
    expect(docText()).toContain('Text of A.')
    expect(backend.watched.has('/b.md')).toBe(false)
  })

  test('a tab with edits asks. Cancel keeps the tab', async () => {
    await tabs.open('/a.md')
    type('x')
    let asked: Tab | null = null
    expect(await tabs.close(tab('/a.md').id, async (t) => ((asked = t), 'cancel'))).toBe(false)
    expect(asked!.path).toBe('/a.md')
    expect(tabs.tabs).toHaveLength(1)
  })

  test("Don't Save closes and writes nothing", async () => {
    await tabs.open('/a.md')
    type('x')
    expect(await tabs.close(tab('/a.md').id, discard)).toBe(true)
    expect(tabs.tabs).toHaveLength(0)
    expect(tabs.active).toBeNull()
    expect(backend.saves).toEqual([])
  })

  test('Save writes and closes', async () => {
    await tabs.open('/a.md')
    type('x')
    expect(await tabs.close(tab('/a.md').id, async () => 'save')).toBe(true)
    expect(backend.files.get('/a.md')!.text).toContain('x')
  })

  test('close an inactive tab with edits', async () => {
    await tabs.open('/a.md')
    type('x')
    await tabs.open('/b.md')
    let asked = ''
    await tabs.close(tab('/a.md').id, async (t) => ((asked = t.path!), 'discard'))
    expect(asked).toBe('/a.md')
    expect(tabs.active?.path).toBe('/b.md')
  })

  test('dirtyTabs lists the tabs with unsaved edits, for the window close question', async () => {
    await tabs.open('/a.md')
    type('x')
    await tabs.open('/b.md')
    expect(tabs.dirtyTabs().map((t) => t.path)).toEqual(['/a.md'])
  })
})

describe('changes on disk', () => {
  test('a tab without edits reloads and keeps the scroll position', async () => {
    await tabs.open('/a.md')
    scrollTop = 80
    const version = backend.write('/a.md', '# A\n\nChanged by another app.\n')
    await tabs.changed('/a.md', version)
    expect(docText()).toContain('Changed by another app.')
    expect(scrollTop).toBe(80)
    expect(tab('/a.md').banner).toBeNull()
  })

  test('an inactive tab without edits reloads too', async () => {
    await tabs.open('/a.md')
    await tabs.open('/b.md')
    const version = backend.write('/a.md', '# A\n\nChanged.\n')
    await tabs.changed('/a.md', version)
    expect(docText()).toContain('Text of B.')
    tabs.activate(tab('/a.md').id)
    expect(docText()).toContain('Changed.')
  })

  test('a tab with edits shows the bar and does not overwrite anything', async () => {
    await tabs.open('/a.md')
    type('Mine ')
    const version = backend.write('/a.md', '# A\n\nTheirs.\n')
    await tabs.changed('/a.md', version)
    expect(tab('/a.md').banner).toBe('changed')
    expect(docText()).toContain('Mine')
    expect(backend.files.get('/a.md')!.text).toBe('# A\n\nTheirs.\n')
  })

  test('an edit while the reload reads the file stays, and the tab shows the bar', async () => {
    await tabs.open('/a.md')
    const version = backend.write('/a.md', '# A\n\nTheirs.\n')
    const open = backend.open.bind(backend)
    let finish = () => {}
    backend.open = (path) => new Promise((resolve) => (finish = () => resolve(open(path))))
    const changed = tabs.changed('/a.md', version)
    type('Mine ')
    finish()
    await changed
    expect(docText()).toContain('Mine')
    expect(tab('/a.md').banner).toBe('changed')
    expect(backend.files.get('/a.md')!.text).toBe('# A\n\nTheirs.\n')
  })

  test('after a reload, undo first undoes the reload, then the edits from before it', async () => {
    await tabs.open('/a.md')
    type('Mine ')
    await tabs.save()
    const version = backend.write('/a.md', '# A\n\nTheirs.\n')
    await tabs.changed('/a.md', version)
    expect(docText()).toBe('ATheirs.')
    undo(view.state, view.dispatch)
    expect(docText()).toBe('Mine AText of A.')
    undo(view.state, view.dispatch)
    expect(docText()).toBe('AText of A.')
    // The undone text differs from the file on disk.
    tabs.refreshDirty()
    expect(tab('/a.md').dirty).toBe(true)
  })

  test('an inactive tab keeps its undo history after a reload', async () => {
    await tabs.open('/a.md')
    type('Mine ')
    await tabs.save()
    await tabs.open('/b.md')
    const version = backend.write('/a.md', '# A\n\nTheirs.\n')
    await tabs.changed('/a.md', version)
    tabs.activate(tab('/a.md').id)
    undo(view.state, view.dispatch)
    expect(docText()).toBe('Mine AText of A.')
  })

  test('Load from disk can be undone: the edits come back', async () => {
    await tabs.open('/a.md')
    type('Mine ')
    const version = backend.write('/a.md', '# A\n\nTheirs.\n')
    await tabs.changed('/a.md', version)
    await tabs.loadFromDisk(tab('/a.md').id)
    expect(docText()).toBe('ATheirs.')
    undo(view.state, view.dispatch)
    expect(docText()).toBe('Mine AText of A.')
  })

  test('typing just after a reload is its own undo step', async () => {
    await tabs.open('/a.md')
    const version = backend.write('/a.md', '# A\n\nTheirs.\n')
    await tabs.changed('/a.md', version)
    type('x')
    undo(view.state, view.dispatch)
    expect(docText()).toBe('ATheirs.')
  })

  test('a save after the undo of a reload writes the old file, with its hidden blocks', async () => {
    const old = '# A\n\n* Text of A [x].\n\n[x]: https://x.test\n'
    backend.write('/a.md', old)
    await tabs.open('/a.md')
    const version = backend.write('/a.md', '# A\n\n* Theirs.\n')
    await tabs.changed('/a.md', version)
    undo(view.state, view.dispatch)
    await tabs.save()
    expect(backend.files.get('/a.md')!.text).toBe(old)
  })

  test('a reload opens a collapsible with the open attribute', async () => {
    await tabs.open('/a.md')
    const version = backend.write('/a.md', '<details open>\n<summary>S</summary>\n\nBody.\n\n</details>\n')
    await tabs.changed('/a.md', version)
    expect(view.dom.querySelector('.is-open')).not.toBeNull()
  })

  test('a save after a reload keeps the blocks of the new file', async () => {
    backend.write('/a.md', '# A\n\nText of A.\n')
    await tabs.open('/a.md')
    const version = backend.write('/a.md', '# A\n\n* Theirs\n')
    await tabs.changed('/a.md', version)
    tabs.refreshDirty()
    expect(tab('/a.md').dirty).toBe(false)
    type('x')
    await tabs.save()
    expect(backend.files.get('/a.md')!.text).toBe('# xA\n\n* Theirs\n')
  })

  test('Keep mine: the next save writes my edits', async () => {
    await tabs.open('/a.md')
    type('Mine ')
    const version = backend.write('/a.md', '# A\n\nTheirs.\n')
    await tabs.changed('/a.md', version)
    await tabs.keepMine(tab('/a.md').id)
    expect(tab('/a.md').banner).toBeNull()
    expect(await tabs.save()).toBe(true)
    expect(backend.files.get('/a.md')!.text).toContain('Mine')
  })

  test('Load from disk: the edits are replaced by the file on disk', async () => {
    await tabs.open('/a.md')
    type('Mine ')
    const version = backend.write('/a.md', '# A\n\nTheirs.\n')
    await tabs.changed('/a.md', version)
    await tabs.loadFromDisk(tab('/a.md').id)
    expect(docText()).toContain('Theirs.')
    expect(tab('/a.md').banner).toBeNull()
    expect(tab('/a.md').dirty).toBe(false)
  })

  test('the event of an own save changes nothing', async () => {
    await tabs.open('/a.md')
    type('x')
    await tabs.save()
    type('y')
    await tabs.changed('/a.md', tab('/a.md').version)
    expect(tab('/a.md').banner).toBeNull()
    expect(docText()).toContain('yx')
  })

  test('a change between the last read and the save: the save stops with a conflict', async () => {
    await tabs.open('/a.md')
    type('Mine ')
    backend.write('/a.md', '# A\n\nTheirs.\n')
    expect(await tabs.save()).toBe(false)
    expect(tab('/a.md').banner).toBe('conflict')
    expect(backend.files.get('/a.md')!.text).toBe('# A\n\nTheirs.\n')
  })

  test('a deleted file shows the bar, and a save does not create it again', async () => {
    await tabs.open('/a.md')
    type('x')
    backend.files.delete('/a.md')
    await tabs.changed('/a.md', null)
    expect(tab('/a.md').banner).toBe('deleted')
    expect(await tabs.save()).toBe(false)
    expect(backend.files.has('/a.md')).toBe(false)
  })

  test('50 files change at the same time (git checkout): all tabs reload', async () => {
    for (let i = 0; i < 50; i++) backend.write(`/f${i}.md`, `# File ${i}\n`)
    for (let i = 0; i < 50; i++) await tabs.open(`/f${i}.md`)
    const versions = Array.from({ length: 50 }, (_, i) => backend.write(`/f${i}.md`, `# File ${i} changed\n`))
    await Promise.all(versions.map((version, i) => tabs.changed(`/f${i}.md`, version)))
    for (let i = 0; i < 50; i++) {
      tabs.activate(tab(`/f${i}.md`).id)
      expect(docText()).toBe(`File ${i} changed`)
    }
  })
})

describe('new tab', () => {
  const typeAtStart = (text: string) => view.dispatch(view.state.tr.insertText(text, 1))

  test('a new tab is empty, untitled and active', async () => {
    await tabs.open('/a.md')
    tabs.newTab()
    expect(tabs.tabs).toHaveLength(2)
    expect(tabs.active?.path).toBeNull()
    expect(docText()).toBe('')
  })

  test('the first save asks for a file name and creates the file with a final newline', async () => {
    tabs.newTab()
    typeAtStart('New text')
    tabs.refreshDirty()
    expect(tabs.active?.dirty).toBe(true)
    chosenPath = '/new.md'
    expect(await tabs.save()).toBe(true)
    expect(backend.creates).toEqual(['/new.md'])
    expect(backend.files.get('/new.md')!.text).toBe('New text\n')
    expect(tabs.active?.path).toBe('/new.md')
    expect(tabs.active?.dirty).toBe(false)
    expect(backend.watched.has('/new.md')).toBe(true)
  })

  test('the second save writes to the same file without a question', async () => {
    tabs.newTab()
    typeAtStart('One')
    chosenPath = '/new.md'
    await tabs.save()
    chosenPath = null
    view.dispatch(view.state.tr.insertText(' two', view.state.doc.content.size - 1))
    expect(await tabs.save()).toBe(true)
    expect(backend.creates).toEqual(['/new.md'])
    expect(backend.files.get('/new.md')!.text).toBe('One two\n')
  })

  test('cancel in the Save As dialog saves nothing', async () => {
    tabs.newTab()
    typeAtStart('x')
    expect(await tabs.save()).toBe(false)
    expect(backend.creates).toEqual([])
    expect(tabs.active?.path).toBeNull()
  })

  test('an empty new tab closes without a question', async () => {
    tabs.newTab()
    expect(await tabs.close(tabs.active!.id, cancel)).toBe(true)
    expect(tabs.tabs).toHaveLength(0)
  })

  test('a new tab with text asks before it closes', async () => {
    tabs.newTab()
    typeAtStart('x')
    expect(await tabs.close(tabs.active!.id, cancel)).toBe(false)
  })

  test('the session does not list a new tab without a file', async () => {
    await tabs.open('/a.md')
    tabs.newTab()
    expect(tabs.session()).toEqual({ paths: ['/a.md'], active: null })
  })
})

describe('raw mode', () => {
  test('raw mode shows the text of the file', async () => {
    await tabs.open('/a.md')
    tabs.enterRaw()
    expect(tabs.active?.rawText).toBe('# A\n\nText of A.\n')
  })

  test('switch to source and back without edits: the document and the file do not change', async () => {
    await tabs.open('/a.md')
    type('x')
    const before = view.state
    tabs.enterRaw()
    await tabs.leaveRaw()
    expect(view.state).toBe(before)
    expect(tabs.active?.rawText).toBeNull()
    undo(view.state, view.dispatch)
    expect(await tabs.save()).toBe(true)
    expect(backend.saves).toEqual([])
  })

  test('an edit in raw mode shows in the editor, and a save writes the raw text exactly', async () => {
    await tabs.open('/a.md')
    tabs.enterRaw()
    tabs.setRawText('# A\n\nText of A.\n\n* star bullet\n* two\n')
    await tabs.leaveRaw()
    expect(docText()).toContain('star bullet')
    tabs.refreshDirty()
    expect(tab('/a.md').dirty).toBe(true)
    await tabs.save()
    expect(backend.files.get('/a.md')!.text).toBe('# A\n\nText of A.\n\n* star bullet\n* two\n')
  })

  test('a save in raw mode writes the raw text and keeps raw mode', async () => {
    await tabs.open('/a.md')
    tabs.enterRaw()
    tabs.setRawText('# A\n\nChanged in raw mode.\n')
    tabs.refreshDirty()
    expect(tab('/a.md').dirty).toBe(true)
    expect(await tabs.save()).toBe(true)
    expect(backend.files.get('/a.md')!.text).toBe('# A\n\nChanged in raw mode.\n')
    expect(tab('/a.md').dirty).toBe(false)
    expect(tab('/a.md').rawText).toBe('# A\n\nChanged in raw mode.\n')
    await tabs.leaveRaw()
    expect(docText()).toContain('Changed in raw mode.')
  })

  test('each tab keeps its own mode', async () => {
    await tabs.open('/a.md')
    tabs.enterRaw()
    tabs.setRawText('# A raw\n')
    await tabs.open('/b.md')
    expect(tabs.active?.rawText).toBeNull()
    tabs.activate(tab('/a.md').id)
    expect(tabs.active?.rawText).toBe('# A raw\n')
  })

  test('a change on disk in raw mode without edits shows the new text', async () => {
    await tabs.open('/a.md')
    tabs.enterRaw()
    const version = backend.write('/a.md', '# A\n\nNew on disk.\n')
    await tabs.changed('/a.md', version)
    expect(tabs.active?.rawText).toBe('# A\n\nNew on disk.\n')
  })

  test('a change on disk in raw mode with edits shows the bar', async () => {
    await tabs.open('/a.md')
    tabs.enterRaw()
    tabs.setRawText('mine\n')
    const version = backend.write('/a.md', 'theirs\n')
    await tabs.changed('/a.md', version)
    expect(tab('/a.md').banner).toBe('changed')
    expect(tabs.active?.rawText).toBe('mine\n')
  })
})

describe('a file that the block map cannot read', () => {
  const broken = '# Broken\n\nBREAK_THE_BLOCK_MAP\n'

  test('opens in raw mode with a message', async () => {
    backend.write('/broken.md', broken)
    await tabs.open('/broken.md')
    expect(tabs.active?.rawText).toBe(broken)
    expect(tabs.active?.banner).toBe('raw-only')
  })

  test('a save in raw mode writes the source exactly', async () => {
    backend.write('/broken.md', broken)
    await tabs.open('/broken.md')
    tabs.setRawText(broken + '\nMore.\n')
    expect(await tabs.save()).toBe(true)
    expect(backend.files.get('/broken.md')!.text).toBe(broken + '\nMore.\n')
  })

  test('back to the editor fails while the text still breaks the block map', async () => {
    backend.write('/broken.md', broken)
    await tabs.open('/broken.md')
    expect(() => tabs.leaveRaw()).toThrow()
    expect(tabs.active?.rawText).toBe(broken)
  })

  test('back to the editor works when the source is fixed in raw mode', async () => {
    backend.write('/broken.md', broken)
    await tabs.open('/broken.md')
    tabs.setRawText('# Fixed\n')
    tabs.leaveRaw()
    expect(tabs.active?.rawText).toBeNull()
    expect(tabs.active?.banner).toBeNull()
    expect(docText()).toBe('Fixed')
  })

  test('a change on disk without edits reloads the source', async () => {
    backend.write('/broken.md', broken)
    await tabs.open('/broken.md')
    const version = backend.write('/broken.md', broken + 'Changed.\n')
    await tabs.changed('/broken.md', version)
    expect(tabs.active?.rawText).toBe(broken + 'Changed.\n')
  })
})

describe('a large file', () => {
  // One long paragraph: the parse is fast in the tests that show it as a document.
  const large = '# Big\n\n' + 'a'.repeat(LARGE_TEXT) + '\n'
  const parsed = (text: string) => reads.includes(text)

  test('opens in raw mode with a message, and the block map does not read it', async () => {
    backend.write('/big.md', large)
    await tabs.open('/big.md')
    expect(tabs.active?.rawText).toBe(large)
    expect(tabs.active?.banner).toBe('large')
    expect(parsed(large)).toBe(false)
  })

  test('a file of LARGE_TEXT characters still opens as a document', async () => {
    const limit = 'a'.repeat(LARGE_TEXT)
    backend.write('/limit.md', limit)
    await tabs.open('/limit.md')
    expect(tabs.active?.rawText).toBeNull()
    expect(tabs.active?.banner).toBeNull()
  })

  test('a save writes the source exactly, and does not parse it', async () => {
    backend.write('/big.md', large)
    await tabs.open('/big.md')
    tabs.setRawText(large + 'More.\n')
    expect(await tabs.save()).toBe(true)
    expect(backend.files.get('/big.md')!.text).toBe(large + 'More.\n')
    expect(parsed(large + 'More.\n')).toBe(false)
    expect(tabs.active?.banner).toBe('large')
  })

  test('"Show as Document" parses it and removes the message', async () => {
    backend.write('/big.md', large)
    await tabs.open('/big.md')
    tabs.leaveRaw()
    expect(tabs.active?.rawText).toBeNull()
    expect(tabs.active?.banner).toBeNull()
    expect(docText()).toBe('Big' + 'a'.repeat(LARGE_TEXT))
  })

  test('after "Show as Document", a change on disk keeps the document', async () => {
    backend.write('/big.md', large)
    await tabs.open('/big.md')
    tabs.leaveRaw()
    const version = backend.write('/big.md', large + '\nChanged.\n')
    await tabs.changed('/big.md', version)
    expect(tabs.active?.rawText).toBeNull()
    expect(docText()).toBe('Big' + 'a'.repeat(LARGE_TEXT) + 'Changed.')
  })

  test('a document that becomes large on disk reloads in raw mode', async () => {
    await tabs.open('/a.md')
    const version = backend.write('/a.md', large)
    await tabs.changed('/a.md', version)
    expect(tabs.active?.rawText).toBe(large)
    expect(tabs.active?.banner).toBe('large')
    expect(parsed(large)).toBe(false)
  })
})

describe('session', () => {
  test('the session lists the open files and the active file', async () => {
    await tabs.open('/a.md')
    await tabs.open('/b.md')
    tabs.activate(tab('/a.md').id)
    expect(tabs.session()).toEqual({ paths: ['/a.md', '/b.md'], active: '/a.md' })
  })
})

describe('errors', () => {
  test('a file that cannot be opened gives an error and no tab', async () => {
    await expect(tabs.open('/missing.md')).rejects.toThrow('No such file')
    expect(tabs.tabs).toHaveLength(0)
  })
})
