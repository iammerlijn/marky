// Dev preview of the app chrome (tabs, bars) without Tauri: files are in memory.
// ?state=tabs (default) | banner | empty
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import 'prosemirror-view/style/prosemirror.css'
import '../src/styles/tokens.css'
import '../src/styles/document.css'
import '../src/styles/outline.css'
import { editorViewCtx } from '@milkdown/kit/core'
import { mount } from 'svelte'
import App from '../src/app/App.svelte'
import type { Backend } from '../src/app/backend'
import { modLabel } from '../src/app/keys'
import { RawEditor } from '../src/app/raw'
import { Tabs } from '../src/app/tabs'
import { createEditor, markdownOf } from '../src/editor/setup'
import sample from './sample.md?raw'

const corpus = import.meta.glob<string>('../tests/corpus/*.md', { query: '?raw', import: 'default', eager: true })
const files = new Map<string, { text: string; version: number }>([
  ['/home/user/notes/release-plan.md', { text: sample, version: 1 }],
  ['/home/user/notes/tables.md', { text: corpus['../tests/corpus/tables.md'], version: 1 }],
  ['/home/user/notes/lists.md', { text: corpus['../tests/corpus/lists.md'], version: 1 }],
])
const backend: Backend = {
  open: async (path) => ({ text: files.get(path)!.text, version: String(files.get(path)!.version) }),
  save: async (path, text) => {
    const version = files.get(path)!.version + 1
    files.set(path, { text, version })
    return String(version)
  },
  create: async (path, text) => {
    files.set(path, { text, version: 1 })
    return '1'
  },
  watch: async () => {},
  unwatch: async () => {},
}

const editorRoot = document.getElementById('editor')!
const rawRoot = document.getElementById('raw')!
const editor = await createEditor(editorRoot)
const view = editor.ctx.get(editorViewCtx)
const tabs = new Tabs(view, markdownOf(editor), backend, { get: () => window.scrollY, set: (top) => window.scrollTo(0, top) })
const raw = new RawEditor(rawRoot, (text) => tabs.setRawText(text))
tabs.subscribe(() => {
  const inRaw = tabs.active?.rawText != null
  if (inRaw) raw.show(tabs.active!.id, tabs.active!.rawText!)
  editorRoot.hidden = !tabs.active || inRaw
  rawRoot.hidden = !inRaw
})
editorRoot.hidden = true
mount(App, {
  target: document.getElementById('chrome')!,
  props: {
    tabs,
    mod: modLabel(),
    home: '/home/user',
    recent: () => {
      const day = 86_400_000
      return [
        { path: '/home/user/notes/release-plan.md', at: Date.now() },
        { path: '/home/user/code/marky/README.md', at: Date.now() - day },
        { path: '/home/user/notes/tables.md', at: new Date(2026, 10, 12).getTime() },
      ]
    },
    onOpen: () => {},
    onOpenRecent: (path: string) => void tabs.open(path),
    onNew: () => tabs.newTab(),
    onClose: (id: number) => tabs.close(id, async () => 'discard'),
    onKeepMine: (id: number) => tabs.keepMine(id),
    onLoad: (id: number) => tabs.loadFromDisk(id),
  },
})

// ?state=tabs (default) | banner | empty | raw
const state = new URLSearchParams(location.search).get('state') ?? 'tabs'
if (state !== 'empty') {
  for (const path of files.keys()) await tabs.open(path)
  // Unsaved edits in the lists tab.
  view.dispatch(view.state.tr.insertText('Edited ', 1))
  tabs.refreshDirty()
  tabs.activate(tabs.tabs[0].id)
  if (state === 'banner') {
    files.set('/home/user/notes/release-plan.md', { text: sample + '\nChanged by another app.\n', version: 2 })
    view.dispatch(view.state.tr.insertText('Mine ', 1))
    await tabs.changed('/home/user/notes/release-plan.md', '2')
  }
}
if (state === 'raw') tabs.enterRaw()
document.body.dataset.ready = 'true'
