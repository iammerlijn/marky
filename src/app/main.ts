// The app window.
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import 'prosemirror-view/style/prosemirror.css'
import '../styles/tokens.css'
import '../styles/document.css'
import '../styles/outline.css'
import '../styles/find.css'
import { editorViewCtx } from '@milkdown/kit/core'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { homeDir } from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { mount } from 'svelte'
import { FIND_EVENT, documentFinder } from '../editor/plugins/find'
import { JUMP_EVENT } from '../editor/plugins/outline'
import { anchor, release, restore, type Anchor } from '../editor/plugins/places'
import { createEditor, markdownOf } from '../editor/setup'
import App from './App.svelte'
import FindBar from './FindBar.svelte'
import {
  getSettings,
  isNotGranted,
  onDroppedFiles,
  onFileChanged,
  onOpenFiles,
  onSettingsChanged,
  openFileDialog,
  saveFileDialog,
  tauriBackend,
} from './backend'
import { History } from './history'
import { listenForShortcuts, modLabel, type Action } from './keys'
import type { RawEditor } from './raw'
import { addRecent, recentFiles, removeRecent } from './recent'
import { Tabs, type CloseAnswer, type Tab } from './tabs'
import { followTheme } from './theme'

// For dev/measure-app.sh (see bench_mark at the end of this file).
void invoke('bench_mark', { label: 'script' })
// A font loads only when text uses it. Then the layout of a long document is done again.
// So load the fonts now, and wait for them before the first file opens.
const fonts = Promise.all(['400 1em Inter', '600 1em Inter', "400 1em 'JetBrains Mono'"].map((f) => document.fonts.load(f)))
const appWindow = getCurrentWindow()
// The theme from the settings, before the first diagram renders. The window is still hidden.
await followTheme(getSettings, onSettingsChanged)
// macOS hides the window buttons in full screen: then the tab bar needs no room for them.
const syncFullscreen = async () =>
  document.documentElement.classList.toggle('fullscreen', await appWindow.isFullscreen())
void syncFullscreen()
void appWindow.onResized(() => void syncFullscreen())
// The first window takes the files from the command line and starts on the welcome screen:
// Marky does not open the files of the last run again. A window from Cmd/Ctrl+N starts with
// a new file.
const isFirstWindow = appWindow.label === 'main'
const editorRoot = document.getElementById('editor')!
// Check for unsaved edits a short time after a change. The editor calls it for each new document.
// Not a check at each frame: a frame loop makes WebKit draw at each display refresh, and costs
// CPU time when nothing changes.
let timer: ReturnType<typeof setTimeout> | undefined
const checkDirty = () => {
  clearTimeout(timer)
  timer = setTimeout(() => tabs.refreshDirty(), 250)
}
const editor = await createEditor(editorRoot, '', checkDirty)
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
const tabs = new Tabs(
  view,
  markdownOf(editor),
  tauriBackend,
  { get: () => window.scrollY, set: (top) => window.scrollTo(0, top) },
  saveFileDialog,
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

// A file from the Recent list that cannot open now goes out of the list. A file of another
// window of this run needs a grant first: the open dialog shows it (src-tauri/src/grants.rs).
async function openRecent(path: string) {
  try {
    await tabs.open(path)
    view.focus()
  } catch (error) {
    if (isNotGranted(error)) {
      const chosen = await openFileDialog(path)
      if (chosen) await openPaths([chosen])
      return
    }
    removeRecent(path)
    await message(error instanceof Error ? error.message : String(error), { kind: 'error' })
  }
}

async function chooseFile() {
  const path = await openFileDialog()
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

// Window title and the visible editor.
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
}
tabs.subscribe(update)
editorRoot.hidden = true
rawRoot.hidden = true

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

// Back and forward. A tab change (also from an opened file) and an outline jump add a place.
interface Place {
  tab: number
  at: Anchor
  scroll: number
}
// A dropped place releases its anchor, so that its position stops following the edits.
const history = new History<Place>((place) => release(place.at))
let shownTab: Tab | null = null
let openTabs = new Set<number>()
let travelling = false
const here = (): Place | null =>
  tabs.active && { tab: tabs.active.id, at: anchor(view.state), scroll: window.scrollY }
tabs.subscribe(() => {
  const ids = new Set(tabs.tabs.map((t) => t.id))
  for (const id of openTabs) if (!ids.has(id)) history.forget(id)
  openTabs = ids
  const previous = shownTab
  if (tabs.active === previous) return
  shownTab = tabs.active
  if (travelling || !tabs.active) return
  // The tab that is not active now keeps its editor state and its scroll position.
  const from = previous && tabs.tabs.includes(previous)
    ? { tab: previous.id, at: anchor(previous.state), scroll: previous.scroll }
    : null
  history.visit(from, here()!)
})
editorRoot.addEventListener(JUMP_EVENT, (event) => {
  const from = (event as CustomEvent<{ pos: number; scroll: number }>).detail
  if (tabs.active) history.visit({ tab: tabs.active.id, at: anchor(view.state, from.pos), scroll: from.scroll }, here()!)
})

function focusActive() {
  if (tabs.active?.rawText != null) raw?.focus()
  else view.focus()
}

function travel(place: Place | null) {
  if (!place) return
  travelling = true
  try {
    tabs.activate(place.tab)
  } finally {
    travelling = false
  }
  // In raw mode the editor document is not visible: only the tab and the scroll position count.
  if (tabs.active?.rawText === null) restore(view, place.at)
  focusActive()
  window.scrollTo(0, place.scroll)
}

const isOpen = (id: number) => tabs.tabs.some((t) => t.id === id)

// The find bar searches the view of the active tab. A new tab, or a change between the document
// and the source view, searches again.
const documentView = documentFinder(view)
const findBar = mount(FindBar, {
  target: chrome,
  props: {
    finder: () => (!tabs.active ? null : tabs.active.rawText === null ? documentView : (raw?.finder ?? null)),
    onClose: focusActive,
  },
})
let searched = ''
tabs.subscribe(() => {
  const shown = tabs.active ? `${tabs.active.id}:${tabs.active.rawText !== null}` : ''
  if (shown === searched) return
  searched = shown
  findBar.refresh()
})
document.addEventListener(FIND_EVENT, () => findBar.update())

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
  else if (action === 'back') travel(history.back(here(), isOpen))
  else if (action === 'forward') travel(history.forward(here(), isOpen))
  else if (action === 'previous-tab' || action === 'next-tab') {
    tabs.activateNext(action === 'next-tab' ? 1 : -1)
    focusActive()
  } else if (action === 'settings') void run(() => invoke('open_settings'))
  else if (action === 'find' || action === 'find-replace') void findBar.open(action === 'find-replace')
}

listenForShortcuts(perform)
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
await onDroppedFiles((paths) => void openPaths(paths))

await onFileChanged((path, version) => void run(() => tabs.changed(path, version)))
await fonts.catch(() => {})

await onOpenFiles(openPaths, isFirstWindow)
if (!isFirstWindow) tabs.newTab()
void invoke('bench_mark', { label: 'opened' })
// The window starts hidden (tauri.conf.json, new_window in src-tauri/src/lib.rs), so that no
// empty window shows. Show it now: the next paint has the document. Not in a frame callback:
// a hidden web view can stop the frames. Then the new file of a new window gets the cursor,
// so that the user can type at once.
void appWindow.show().then(() => {
  if (!isFirstWindow) focusActive()
})

// For dev/measure-app.sh: the time from the process start to the painted files. The backend
// prints it only when MARKY_BENCH is set.
requestAnimationFrame(() => requestAnimationFrame(() => void invoke('bench_mark', { label: 'files-open' })))
