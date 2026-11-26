// The app window (design document, sections 4.2 and 7).
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import 'prosemirror-view/style/prosemirror.css'
import '../styles/tokens.css'
import '../styles/document.css'
import '../styles/outline.css'
import { editorViewCtx } from '@milkdown/kit/core'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { homeDir } from '@tauri-apps/api/path'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { mount } from 'svelte'
import { createEditor, markdownOf } from '../editor/setup'
import App from './App.svelte'
import { onFileChanged, onOpenFiles, tauriBackend } from './backend'
import { modLabel, shortcut, type Action } from './keys'
import type { RawEditor } from './raw'
import { addRecent, recentFiles, removeRecent } from './recent'
import { Tabs, type CloseAnswer, type Tab } from './tabs'

// For dev/measure-app.sh (see bench_mark at the end of this file).
void invoke('bench_mark', { label: 'script' })
// A font loads only when text uses it. Then the layout of a long document is done again (design
// document, section 9). So load the fonts now, and wait for them before the first file opens.
const fonts = Promise.all(['400 1em Inter', '600 1em Inter', "400 1em 'JetBrains Mono'"].map((f) => document.fonts.load(f)))
const appWindow = getCurrentWindow()
// macOS hides the window buttons in full screen: then the tab bar needs no room for them.
const syncFullscreen = async () =>
  document.documentElement.classList.toggle('fullscreen', await appWindow.isFullscreen())
void syncFullscreen()
void appWindow.onResized(() => void syncFullscreen())
// The first window restores and saves the session and takes the files from the command line.
// A window from Cmd/Ctrl+N starts empty.
const isFirstWindow = appWindow.label === 'main'
const editorRoot = document.getElementById('editor')!
const editor = await createEditor(editorRoot)
const view = editor.ctx.get(editorViewCtx)
void invoke('bench_mark', { label: 'editor' })
// The tab bar and the banner stick at the top of the window. When the editor scrolls to the
// cursor, keep the cursor below them.
const chrome = document.getElementById('chrome')!
const chromeBottom = () => chrome.getBoundingClientRect().bottom
view.setProps({
  scrollThreshold: { get top() { return chromeBottom() }, right: 0, bottom: 0, left: 0 },
  scrollMargin: { get top() { return chromeBottom() + 8 }, right: 5, bottom: 5, left: 5 },
})
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

// A file from the Recent list that cannot open now goes out of the list.
async function openRecent(path: string) {
  try {
    await tabs.open(path)
    view.focus()
  } catch (error) {
    removeRecent(path)
    await message(error instanceof Error ? error.message : String(error), { kind: 'error' })
  }
}

async function chooseFile() {
  const path = await openDialog({ filters: markdownFiles })
  if (path) await openPaths([path])
}

const home = await homeDir().catch(() => null)
mount(App, {
  target: document.getElementById('chrome')!,
  props: {
    tabs,
    mod: modLabel(),
    home,
    recent: recentFiles,
    onOpen: chooseFile,
    onOpenRecent: (path: string) => void openRecent(path),
    onNew: () => {
      tabs.newTab()
      view.focus()
    },
    onClose: (id: number) => run(() => tabs.close(id, ask)),
    onKeepMine: (id: number) => run(() => tabs.keepMine(id)),
    onLoad: (id: number) => run(() => tabs.loadFromDisk(id)),
    onToggleRaw: () => toggleRaw(),
  },
})

// Check for unsaved edits a short time after a change.
let timer: ReturnType<typeof setTimeout> | undefined
const checkDirty = () => {
  clearTimeout(timer)
  timer = setTimeout(() => tabs.refreshDirty(), 250)
}

// Raw mode: the source editor replaces the editor for a tab. CodeMirror is not in the main
// script: it loads the first time raw mode opens.
const rawRoot = document.getElementById('raw')!
let raw: RawEditor | undefined
let rawLoad: Promise<RawEditor> | undefined
const loadRaw = () =>
  (rawLoad ??= import('./raw').then(({ RawEditor }) => (raw = new RawEditor(rawRoot, (text) => {
    tabs.setRawText(text)
    checkDirty()
  }))))
const rawTabs = new Set<number>()
// A file that a tab shows for the first time goes to the top of the Recent list.
const known = new Map<number, string>()

// Window title, the visible editor and the session for the next start.
const SESSION = 'marky.session'
function update() {
  const active = tabs.active
  for (const id of rawTabs) {
    if (!tabs.tabs.some((t) => t.id === id && t.rawText !== null)) {
      raw!.forget(id)
      rawTabs.delete(id)
    }
  }
  for (const tab of tabs.tabs) {
    if (tab.path !== null && known.get(tab.id) !== tab.path) {
      known.set(tab.id, tab.path)
      addRecent(tab.path)
    }
  }
  const inRaw = active?.rawText != null
  // A file that the block map cannot read opens in raw mode, maybe before CodeMirror is loaded.
  if (inRaw && !raw) void run(async () => {
    await loadRaw()
    update()
  })
  else if (inRaw) {
    raw!.show(active!.id, active!.rawText!)
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
}
tabs.subscribe(update)
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
    void run(async () => {
      const editor = await loadRaw()
      // While CodeMirror loads, the user can go to another tab or press the shortcut again.
      if (tabs.active !== active || active.rawText !== null) return
      tabs.enterRaw()
      editor.focus()
    })
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
  else if (action === 'close-tab') {
    // With no tabs, Cmd/Ctrl+W closes the window: the same path as the close button of the
    // window, so that the unsaved-changes check runs (onCloseRequested below).
    if (tabs.active) void run(() => tabs.close(tabs.active!.id, ask))
    else void run(() => appWindow.close())
  }
  else if (action === 'new-tab') {
    tabs.newTab()
    view.focus()
  } else if (action === 'new-window') void run(() => invoke('new_window'))
  else if (action === 'toggle-raw') toggleRaw()
  else if (action === 'quit') void run(() => invoke('quit_app'))
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

// A markdown file that is dropped on the window opens in a tab.
const isMarkdown = (path: string) => markdownFiles[0].extensions.some((ext) => path.toLowerCase().endsWith(`.${ext}`))
await getCurrentWebview().onDragDropEvent(({ payload }) => {
  if (payload.type === 'drop') void openPaths(payload.paths.filter(isMarkdown))
})

await onFileChanged((path, version) => void run(() => tabs.changed(path, version)))
await fonts.catch(() => {})

// Reopen the tabs of the last session. A file that is gone now is skipped without a message.
if (isFirstWindow) try {
  const session = JSON.parse(localStorage.getItem(SESSION) ?? 'null') as ReturnType<Tabs['session']> | null
  for (const path of session?.paths ?? []) await tabs.open(path).catch(() => {})
  const active = tabs.tabs.find((t) => t.path === session?.active)
  if (active) tabs.activate(active.id)
} catch {
  // No session.
}

await onOpenFiles(openPaths, isFirstWindow)
void invoke('bench_mark', { label: 'opened' })
// The window starts hidden (tauri.conf.json, new_window in src-tauri/src/lib.rs), so that no
// empty window shows. Show it now: the next paint has the document. Not in a frame callback:
// a hidden web view can stop the frames.
void appWindow.show()

// For dev/measure-app.sh: the time from the process start to the painted files. The backend
// prints it only when MARKY_BENCH is set.
requestAnimationFrame(() => requestAnimationFrame(() => void invoke('bench_mark', { label: 'files-open' })))
