// Benchmark for the performance targets (design document, section 9), in the browser engine.
// The result is in document.body.dataset.result (JSON). See dev/bench.mjs.
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import 'prosemirror-view/style/prosemirror.css'
import '../src/styles/tokens.css'
import '../src/styles/document.css'
import '../src/styles/outline.css'
import { editorViewCtx } from '@milkdown/kit/core'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { createEditor, markdownOf } from '../src/editor/setup'
import { load, save } from '../src/markdown/preserve'

// A realistic document: each section has 25 lines. ?lines=N sets the length (5,000 by default).
const length = Number(new URLSearchParams(location.search).get('lines') ?? 5000)
function generate(): string {
  const lines: string[] = []
  for (let i = 0; lines.length < length; i++) {
    lines.push(
      `## Section ${i}`,
      '',
      `This is paragraph ${i} with **bold**, _emphasis_, \`code\` and a [link](https://example.com/${i}).`,
      'A second line of the same paragraph, to make it longer than one line in the window.',
      '',
      `- First item of list ${i}`,
      '- Second item with more text',
      '  - A nested item',
      '',
      '| Name | Owner | Status |',
      '|------|-------|-------:|',
      `| Row ${i} | Anna | Done |`,
      '| Another row | Joris | In review |',
      '',
      '```ts',
      `const value${i} = compute(${i})`,
      'console.log(value)',
      '```',
      '',
      '> A quote with some text.',
      '',
      `1. Step one of ${i}`,
      '2. Step two',
      '',
      '---',
    )
  }
  return lines.slice(0, length).join('\n') + '\n'
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)]
const round = (value: number) => Math.round(value * 10) / 10

const text = generate()
let t = performance.now()
const editor = await createEditor(document.getElementById('editor')!)
const createMs = performance.now() - t
const view = editor.ctx.get(editorViewCtx)
const md = markdownOf(editor)

const parts: Record<string, number> = {}
t = performance.now(); md.parse(text); parts.parse = round(performance.now() - t)
t = performance.now(); md.read(text); parts.read = round(performance.now() - t)
t = performance.now()
const source = load(md, text)
const loadMs = performance.now() - t
view.updateState(EditorState.create({ doc: source.doc, plugins: view.state.plugins }))
await frame()
await frame()
const openMs = performance.now() - t

// Typing in the middle of the document.
let pos = Math.floor(view.state.doc.content.size / 2)
view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))))
pos = view.state.selection.from
const typing: number[] = []
for (let i = 0; i < 100; i++) {
  const start = performance.now()
  view.dispatch(view.state.tr.insertText('x'))
  await frame()
  typing.push(performance.now() - start)
}

const saves: number[] = []
for (let i = 0; i < 10; i++) {
  const start = performance.now()
  save(md, source, view.state.doc)
  saves.push(performance.now() - start)
}

document.body.dataset.result = JSON.stringify({
  parts,
  lines: text.split('\n').length - 1,
  blocks: source.blocks.length,
  createEditorMs: round(createMs),
  loadMs: round(loadMs),
  openToFirstPaintMs: round(openMs),
  typingMedianMs: round(median(typing)),
  typingP95Ms: round(p95(typing)),
  saveMedianMs: round(median(saves)),
})
