// Tabs (design document, sections 4.2 and 7). One editor view; each tab keeps its own
// EditorState, so its content, selection and undo history stay when you change tabs.
import { EditorState, type Plugin } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { BlockMapError, load, save, type Markdown, type Source } from '../markdown/preserve'
import type { Backend, SaveError } from './backend'

export interface Tab {
  id: number
  // null for a new tab that is not saved yet.
  path: string | null
  // The blocks of the text that the editor started from: the file, or the text of raw mode.
  source: Source
  // The text on disk after the last open or save. The tab has unsaved edits when its text differs.
  saved: string
  version: string
  // The editor state while the tab is not active. The active tab uses view.state.
  state: EditorState
  dirty: boolean
  scroll: number
  banner: 'changed' | 'conflict' | 'deleted' | 'raw-only' | null
  // Raw mode: the markdown source that the tab shows instead of the editor. null in the editor.
  rawText: string | null
  // The text when raw mode started. Back to the editor without a change keeps the editor state.
  rawStart: string | null
  // The block map cannot read the text: the tab shows only raw mode, and has no editor state.
  rawOnly: boolean
}

export type CloseAnswer = 'save' | 'discard' | 'cancel'

interface Scroll {
  get(): number
  set(top: number): void
}

export class Tabs {
  tabs: Tab[] = []
  active: Tab | null = null
  private nextId = 1
  private plugins: readonly Plugin[]
  private listeners = new Set<() => void>()

  constructor(
    private view: EditorView,
    private md: Markdown,
    private backend: Backend,
    private scroll: Scroll,
    // The Save As dialog. Returns null when the user cancels.
    private choosePath: (tab: Tab) => Promise<string | null> = async () => null,
  ) {
    this.plugins = view.state.plugins
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  private stateOf(tab: Tab): EditorState {
    return tab === this.active ? this.view.state : tab.state
  }

  private find(id: number): Tab {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) throw new Error(`No tab ${id}`)
    return tab
  }

  // Throws when the file cannot be opened. When the block map fails, rawOnly is true: the
  // editor cannot save the file safely, so the tab shows only the markdown source.
  private async read(path: string) {
    const opened = await this.backend.open(path).catch((error) => {
      throw new Error(String(error))
    })
    const mapped = this.tryLoad(opened.text)
    const source = mapped ?? load(this.md, '')
    return { source, saved: opened.text, version: opened.version, state: this.stateFor(source), rawOnly: !mapped }
  }

  private tryLoad(text: string): Source | null {
    try {
      return load(this.md, text)
    } catch (error) {
      if (error instanceof BlockMapError) return null
      throw error
    }
  }

  private stateFor(source: Source): EditorState {
    return EditorState.create({ doc: source.doc, plugins: this.plugins })
  }

  // The text that a save writes now, and if it differs from the file.
  private output(tab: Tab): { text: string; changed: boolean } {
    const text = tab.rawText ?? save(this.md, tab.source, this.stateOf(tab).doc).text
    return { text, changed: text !== tab.saved }
  }

  async open(path: string): Promise<void> {
    const existing = this.tabs.find((t) => t.path === path)
    if (existing) return this.activate(existing.id)
    const read = await this.read(path)
    const raw = read.rawOnly ? read.saved : null
    const banner = read.rawOnly ? 'raw-only' : null
    const tab: Tab = { id: this.nextId++, path, ...read, dirty: false, scroll: 0, banner, rawText: raw, rawStart: raw }
    this.tabs.push(tab)
    this.activate(tab.id)
    await this.backend.watch(path)
  }

  newTab() {
    const source = load(this.md, '')
    const tab: Tab = {
      id: this.nextId++,
      path: null,
      source,
      saved: '',
      version: '',
      state: this.stateFor(source),
      dirty: false,
      scroll: 0,
      banner: null,
      rawText: null,
      rawStart: null,
      rawOnly: false,
    }
    this.tabs.push(tab)
    this.activate(tab.id)
  }

  activate(id: number) {
    const next = this.find(id)
    if (next === this.active) return
    if (this.active) {
      this.active.state = this.view.state
      this.active.scroll = this.scroll.get()
    }
    this.active = next
    this.view.updateState(next.state)
    this.scroll.set(next.scroll)
    this.emit()
  }

  // Compares the active document with the file. Call it a short time after an edit.
  refreshDirty() {
    const tab = this.active
    if (!tab) return
    const dirty = this.output(tab).changed
    if (dirty !== tab.dirty) {
      tab.dirty = dirty
      this.emit()
    }
  }

  dirtyTabs(): Tab[] {
    return this.tabs.filter((tab) => this.output(tab).changed)
  }

  // Returns false when the file was not saved. Throws an Error for a disk error.
  async save(id = this.active?.id): Promise<boolean> {
    if (id === undefined) return true
    const tab = this.find(id)
    const result = this.output(tab)
    if (!result.changed) return true
    if (tab.path === null) return this.saveAs(tab, result.text)
    try {
      tab.version = await this.backend.save(tab.path, result.text, tab.version)
    } catch (error) {
      const e = error as SaveError
      if (e.kind !== 'Conflict') throw new Error(e.kind === 'Io' ? e.message : String(error))
      if (tab.banner !== 'deleted') tab.banner = 'conflict'
      this.emit()
      return false
    }
    // The saved text is the new original: the next save keeps all its blocks.
    tab.source = this.tryLoad(result.text) ?? tab.source
    tab.saved = result.text
    tab.dirty = false
    tab.banner = tab.rawOnly ? 'raw-only' : null
    this.emit()
    return true
  }

  private async saveAs(tab: Tab, text: string): Promise<boolean> {
    const path = await this.choosePath(tab)
    if (!path) return false
    tab.version = await this.backend.create(path, text).catch((error) => {
      throw new Error(String(error))
    })
    tab.path = path
    tab.source = load(this.md, text)
    tab.saved = text
    tab.dirty = false
    this.emit()
    await this.backend.watch(path)
    return true
  }

  async close(id: number, ask: (tab: Tab) => Promise<CloseAnswer>): Promise<boolean> {
    const tab = this.find(id)
    if (this.output(tab).changed) {
      const answer = await ask(tab)
      if (answer === 'cancel') return false
      if (answer === 'save' && !(await this.save(id))) return false
    }
    if (tab.path !== null) await this.backend.unwatch(tab.path)
    const index = this.tabs.indexOf(tab)
    this.tabs.splice(index, 1)
    if (tab === this.active) {
      this.active = null
      const next = this.tabs[index] ?? this.tabs[index - 1]
      if (next) this.activate(next.id)
    }
    this.emit()
    return true
  }

  // A `file-changed` event from the watcher.
  async changed(path: string, version: string | null) {
    const tab = this.tabs.find((t) => t.path === path)
    if (!tab || version === tab.version) return
    if (version === null) {
      tab.banner = 'deleted'
    } else if (!this.output(tab).changed) {
      await this.reload(tab)
    } else {
      tab.banner = 'changed'
    }
    this.emit()
  }

  private async reload(tab: Tab) {
    if (tab.path === null) return
    const { source, saved, version, state, rawOnly } = await this.read(tab.path)
    Object.assign(tab, { source, saved, version, rawOnly, dirty: false, banner: rawOnly ? 'raw-only' : null })
    if (tab.rawText !== null || rawOnly) tab.rawText = tab.rawStart = saved
    if (tab === this.active) {
      const top = this.scroll.get()
      this.view.updateState(state)
      this.scroll.set(top)
    } else {
      tab.state = state
    }
    this.emit()
  }

  // Keep mine: the next save writes the edits over the file on disk.
  async keepMine(id: number) {
    const tab = this.find(id)
    if (tab.path === null) return
    tab.version = (await this.backend.open(tab.path)).version
    tab.banner = null
    this.emit()
  }

  async loadFromDisk(id: number) {
    await this.reload(this.find(id))
  }

  // Raw mode (design document, section 6.6): show the text that a save writes.
  enterRaw(id = this.active?.id) {
    if (id === undefined) return
    const tab = this.find(id)
    tab.rawText = tab.rawStart = this.output(tab).text
    this.emit()
  }

  // The text of the source editor of the active tab, after each change.
  setRawText(text: string) {
    if (this.active?.rawText != null) this.active.rawText = text
  }

  // Back to the editor. Throws when the block map fails for the new text: then the tab
  // stays in raw mode.
  leaveRaw(id = this.active?.id) {
    if (id === undefined) return
    const tab = this.find(id)
    if (tab.rawText === null) return
    if (tab.rawText !== tab.rawStart || tab.rawOnly) {
      // The new text is the new original: a save writes it exactly, and new edits only change
      // their own blocks. Throws a BlockMapError when the text still cannot be mapped.
      tab.source = load(this.md, tab.rawText)
      const state = this.stateFor(tab.source)
      if (tab === this.active) this.view.updateState(state)
      else tab.state = state
    }
    tab.rawText = tab.rawStart = null
    if (tab.rawOnly) {
      tab.rawOnly = false
      tab.banner = null
    }
    this.emit()
  }

  session(): { paths: string[]; active: string | null } {
    const paths = this.tabs.flatMap((t) => (t.path === null ? [] : [t.path]))
    return { paths, active: this.active?.path ?? null }
  }
}
