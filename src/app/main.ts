// The app window (design document, sections 4.2 and 7).
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import 'prosemirror-view/style/prosemirror.css'
import '../styles/tokens.css'
import '../styles/document.css'
import { editorViewCtx } from '@milkdown/kit/core'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { mount } from 'svelte'
import { createEditor, markdownOf } from '../editor/setup'
import App from './App.svelte'
import { onFileChanged, onOpenFiles, tauriBackend } from './backend'
import { modLabel, shortcut, type Action } from './keys'
import { RawEditor } from './raw'
import { Tabs, type CloseAnswer, type Tab } from './tabs'

const appWindow = getCurrentWindow()
// The first window restores and saves the session and takes the files from the command line.
// A window from Cmd/Ctrl+N starts empty.
const isFirstWindow = appWindow.label === 'main'
const editorRoot = document.getElementById('editor')!
const editor = await createEditor(editorRoot)
const view = editor.ctx.get(editorViewCtx)
const markdownFiles = [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdx', 'txt'] }]
const tabs = new Tabs(
  view,
  markdownOf(editor),
  tauriBackend,
  { get: () => window.scrollY, set: (top) => window.scrollTo(0, top) },
  () => saveDialog({ defaultPath: 'Untitled.md', filters: markdownFiles }),
)

const name = (tab: Tab) => (tab.path === null ? 'Untitled' : tab.path.split('/').pop()!)

async function run(task: () => Promise<unknown>) {
  try {
    await task()
  } catch (error) {
    await message(error instanceof Error ? error.message : String(error), { kind: 'error' })
  }
}

async function ask(tab: Tab): Promise<CloseAnswer> {
  const answer = await message(`Save the changes to ${name(tab)}?`, {
    kind: 'warning',
    buttons: { yes: 'Save', no: "Don't Save", cancel: 'Cancel' },
  })
  return answer === 'Save' ? 'save' : answer === "Don't Save" ? 'discard' : 'cancel'
}

async function openPaths(paths: string[]) {
  for (const path of paths) await run(() => tabs.open(path))
  view.focus()
}

async function chooseFile() {
  const path = await openDialog({ filters: markdownFiles })
  if (path) await openPaths([path])
}

mount(App, {
  target: document.getElementById('chrome')!,
  props: {
    tabs,
    mod: modLabel(),
    onOpen: chooseFile,
    onNew: () => {
      tabs.newTab()
      view.focus()
    },
    onClose: (id: number) => run(() => tabs.close(id, ask)),
    onKeepMine: (id: number) => run(() => tabs.keepMine(id)),
    onLoad: (id: number) => run(() => tabs.loadFromDisk(id)),
  },
})

// Check for unsaved edits a short time after a change.
let timer: ReturnType<typeof setTimeout> | undefined
const checkDirty = () => {
  clearTimeout(timer)
  timer = setTimeout(() => tabs.refreshDirty(), 250)
}

// Raw mode: the source editor replaces the editor for a tab.
const rawRoot = document.getElementById('raw')!
const raw = new RawEditor(rawRoot, (text) => {
  tabs.setRawText(text)
  checkDirty()
})
const rawTabs = new Set<number>()

// Window title, the visible editor and the session for the next start.
const SESSION = 'marky.session'
tabs.subscribe(() => {
  const active = tabs.active
  for (const id of rawTabs) {
    if (!tabs.tabs.some((t) => t.id === id && t.rawText !== null)) {
      raw.forget(id)
      rawTabs.delete(id)
    }
  }
  const inRaw = active?.rawText != null
  if (inRaw) {
    raw.show(active!.id, active!.rawText!)
    rawTabs.add(active!.id)
  }
  editorRoot.hidden = !active || inRaw
  rawRoot.hidden = !inRaw
  void appWindow.setTitle(active ? `${active.dirty ? '• ' : ''}${name(active)} — Marky` : 'Marky')
  if (!isFirstWindow) return
  try {
    localStorage.setItem(SESSION, JSON.stringify(tabs.session()))
  } catch {
    // Without storage, the next start opens no tabs.
  }
})
editorRoot.hidden = true
rawRoot.hidden = true

// Milkdown owns dispatchTransaction, so check for a new document at each frame.
let shown = view.state.doc
const watchDoc = () => {
  if (view.state.doc !== shown) {
    shown = view.state.doc
    checkDirty()
  }
  requestAnimationFrame(watchDoc)
}
watchDoc()

function toggleRaw() {
  const active = tabs.active
  if (!active) return
  if (active.rawText === null) {
    tabs.enterRaw()
    raw.focus()
  } else {
    void run(async () => {
      tabs.leaveRaw()
      view.focus()
    })
  }
}

function perform(action: Action) {
  if (action === 'open') void chooseFile()
  else if (action === 'save') void run(() => tabs.save())
  else if (action === 'close-tab' && tabs.active) void run(() => tabs.close(tabs.active!.id, ask))
  else if (action === 'new-tab') {
    tabs.newTab()
    view.focus()
  } else if (action === 'new-window') void run(() => invoke('new_window'))
  else if (action === 'toggle-raw') toggleRaw()
}

window.addEventListener('keydown', (event) => {
  const action = shortcut(event)
  if (!action) return
  event.preventDefault()
  perform(action)
})
// The macOS menu bar sends the same actions (src-tauri/src/menu.rs).
await listen<Action>('menu', ({ payload }) => perform(payload))

await appWindow.onCloseRequested(async (event) => {
  const dirty = tabs.dirtyTabs()
  if (dirty.length === 0) return
  event.preventDefault()
  const question = dirty.length === 1 ? `Save the changes to ${name(dirty[0])}?` : `Save the changes to ${dirty.length} files?`
  const answer = await message(question, { kind: 'warning', buttons: { yes: 'Save', no: "Don't Save", cancel: 'Cancel' } })
  if (answer === 'Cancel') return
  if (answer === 'Save') {
    for (const tab of dirty) {
      let saved = false
      await run(async () => (saved = await tabs.save(tab.id)))
      if (!saved) return
    }
  }
  await appWindow.destroy()
})

await onFileChanged((path, version) => void run(() => tabs.changed(path, version)))

// Reopen the tabs of the last session. A file that is gone now is skipped without a message.
if (isFirstWindow) try {
  const session = JSON.parse(localStorage.getItem(SESSION) ?? 'null') as ReturnType<Tabs['session']> | null
  for (const path of session?.paths ?? []) await tabs.open(path).catch(() => {})
  const active = tabs.tabs.find((t) => t.path === session?.active)
  if (active) tabs.activate(active.id)
} catch {
  // No session.
}

await onOpenFiles((paths) => void openPaths(paths), isFirstWindow)
