// @vitest-environment happy-dom
// Code blocks and Mermaid.
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { loaders, WORKER_IDLE_MS, workerTokenizer } from '../src/editor/plugins/codeblock'
import { open, type OpenDoc } from './helpers'

let doc: OpenDoc
afterEach(() => doc?.destroy())

const blocks = () => [...doc.view.dom.querySelectorAll<HTMLElement>('.code-block')]

describe('code blocks', () => {
  test('the label shows the language, or Text when there is none', async () => {
    doc = await open('```ts\nconst a = 1\n```\n\n```\nplain\n```\n')
    expect(blocks().map((b) => b.querySelector('.code-language')!.textContent)).toEqual(['ts', 'Text'])
  })

  test('the copy button copies the code exactly', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    doc = await open('```py\ndef f():\n\treturn 1\n```\n')
    blocks()[0].querySelector<HTMLButtonElement>('.code-copy')!.click()
    expect(writeText).toHaveBeenCalledWith('def f():\n\treturn 1')
  })

  test('Tab in a code block indents and keeps the focus in the block', async () => {
    doc = await open('```js\nx\n```\n')
    const { view } = doc
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(view.state.doc.firstChild!.textContent).toBe('  x')
    expect(doc.save().text).toBe('```js\n  x\n```\n')
  })

  test('a known language gets highlighted, without a change to the document', async () => {
    const text = '```ts\nconst answer: number = 42\n```\n'
    doc = await open(text)
    await vi.waitFor(() => expect(doc.view.dom.querySelectorAll('.code-block code span[style]').length).toBeGreaterThan(2), {
      timeout: 5000,
    })
    expect(doc.save()).toEqual({ text, changed: false })
  })

  test('an edit in a code block highlights it again, and an edit elsewhere keeps the colors', async () => {
    doc = await open('Text.\n\n```ts\nx\n```\n')
    const styled = () => doc.view.dom.querySelectorAll('.code-block code span[style]').length
    await vi.waitFor(() => expect(styled()).toBeGreaterThan(0), { timeout: 5000 })
    const before = styled()
    const { view } = doc
    // Type a keyword at the start of the code.
    const code = view.state.doc.child(0).nodeSize + 1
    view.dispatch(view.state.tr.insertText('const ', code))
    await vi.waitFor(() => expect(styled()).toBeGreaterThan(before))
    const after = styled()
    view.dispatch(view.state.tr.insertText('More ', 1))
    expect(styled()).toBe(after)
  })

  test('the colors stay while the new highlight of an edited code block is not ready', async () => {
    doc = await open('```ts\nconst a = 1\n```\n')
    const styled = () => doc.view.dom.querySelectorAll('.code-block code span[style]').length
    await vi.waitFor(() => expect(styled()).toBeGreaterThan(0), { timeout: 5000 })
    const before = styled()
    const original = loaders.tokenize
    // A worker that does not answer yet.
    const requests: string[] = []
    loaders.tokenize = (code) => {
      requests.push(code)
      return new Promise(() => {})
    }
    try {
      const { view } = doc
      view.dispatch(view.state.tr.insertText('x', view.state.doc.firstChild!.nodeSize - 1))
      expect(requests).toEqual(['const a = 1x'])
      expect(styled()).toBe(before)
    } finally {
      loaders.tokenize = original
    }
  })

  test('a short name of a language (py) is highlighted', async () => {
    doc = await open('```py\ndef f():\n    return 1\n```\n')
    await vi.waitFor(() => expect(doc.view.dom.querySelectorAll('.code-block code span[style]').length).toBeGreaterThan(2), {
      timeout: 5000,
    })
  })

  test('a language that Marky does not include shows plain code', async () => {
    doc = await open('```cobol\nDISPLAY "HI".\n```\n')
    await new Promise((r) => setTimeout(r, 200))
    expect(doc.view.dom.querySelectorAll('.code-block code span[style]')).toHaveLength(0)
  })

  test('an unknown language shows plain code and no error', async () => {
    doc = await open('```notalanguage\nsome code\n```\n')
    await new Promise((r) => setTimeout(r, 200))
    expect(doc.view.dom.querySelectorAll('.code-block code span[style]')).toHaveLength(0)
    expect(blocks()[0].querySelector('code')!.textContent).toBe('some code')
  })
})

describe('highlight worker', () => {
  // A worker that answers each request at once, with no spans.
  const workers: { terminated: boolean; requests: number }[] = []
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null
    state = { terminated: false, requests: 0 }
    constructor() {
      workers.push(this.state)
    }
    postMessage({ id }: { id: number }) {
      this.state.requests++
      void Promise.resolve().then(() => this.onmessage!({ data: { id, spans: [] } }))
    }
    terminate() {
      this.state.terminated = true
    }
  }

  beforeEach(() => {
    workers.length = 0
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('the worker stops when no code block needed it for some time, and starts again', async () => {
    const tokenize = workerTokenizer()
    await tokenize('x', 'ts')
    vi.advanceTimersByTime(WORKER_IDLE_MS - 1)
    // A request before the time ends keeps the same worker.
    await tokenize('y', 'ts')
    vi.advanceTimersByTime(WORKER_IDLE_MS - 1)
    expect(workers).toEqual([{ terminated: false, requests: 2 }])
    vi.advanceTimersByTime(1)
    expect(workers[0].terminated).toBe(true)
    await tokenize('z', 'ts')
    expect(workers).toHaveLength(2)
    expect(workers[1]).toEqual({ terminated: false, requests: 1 })
  })
})

describe('mermaid', () => {
  let loads = 0
  const themes: string[] = []
  let render: (id: string, source: string) => Promise<{ svg: string }>
  const original = loaders.mermaid

  beforeEach(() => {
    loads = 0
    themes.length = 0
    render = async (_id, source) => {
      if (source.includes('bad')) throw new Error('Parse error on line 2')
      return { svg: `<svg data-source="${source.length}"></svg>` }
    }
    loaders.mermaid = async () => {
      loads++
      return {
        initialize: (config: { theme: string }) => themes.push(config.theme),
        render: (id: string, source: string) => render(id, source),
      } as never
    }
    // happy-dom has no layout: each diagram is visible at once.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
        observe() {
          this.callback([{ isIntersecting: true }])
        }
        disconnect() {}
      },
    )
  })
  afterEach(() => {
    loaders.mermaid = original
    vi.unstubAllGlobals()
  })

  test('a file without Mermaid does not load Mermaid', async () => {
    doc = await open('# Title\n\n```js\nx\n```\n')
    await new Promise((r) => setTimeout(r, 50))
    expect(loads).toBe(0)
  })

  test('a Mermaid block shows the diagram', async () => {
    doc = await open('```mermaid\ngraph TD\n  A --> B\n```\n')
    await vi.waitFor(() => expect(blocks()[0].querySelector('.mermaid-diagram svg')).not.toBeNull())
    expect(loads).toBeGreaterThan(0)
  })

  test('an invalid diagram shows the error below the last valid diagram', async () => {
    doc = await open('```mermaid\ngraph TD\n  A --> B\n```\n')
    await vi.waitFor(() => expect(blocks()[0].querySelector('.mermaid-diagram svg')).not.toBeNull())
    const { view } = doc
    view.dispatch(view.state.tr.insertText(' bad', view.state.doc.firstChild!.nodeSize - 1))
    const error = blocks()[0].querySelector<HTMLElement>('.mermaid-error')!
    await vi.waitFor(() => expect(error.hidden).toBe(false), { timeout: 2000 })
    expect(error.textContent).toContain('Parse error')
    expect(blocks()[0].querySelector('.mermaid-diagram svg')).not.toBeNull()
  })

  test('a change between light and dark mode renders the diagram again', async () => {
    // A color scheme that the test can change.
    const media = { matches: false, listeners: new Set<() => void>() }
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return media.matches
      },
      addEventListener: (_: string, listener: () => void) => media.listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => media.listeners.delete(listener),
    }))
    doc = await open('```mermaid\ngraph TD\n  A --> B\n```\n')
    await vi.waitFor(() => expect(themes).toEqual(['neutral']))
    media.matches = true
    media.listeners.forEach((listener) => listener())
    await vi.waitFor(() => expect(themes).toEqual(['neutral', 'dark']))
  })
})
