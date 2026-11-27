// Find and replace in the document. The matches are decorations: they are not in the file.
// The text of each text block is searched: paragraphs, headings, table cells, code blocks (also the
// source of a Mermaid diagram) and the blocks in collapsibles. A match does not go across blocks.
// The front matter panel and the summary of a collapsible are fields, not document text: find
// does not search them. The source view searches all of the file.
// A replace changes only the text of the matches, so the other blocks stay the same node objects
// and keep their original text at save (preserve.ts).
import type { Node } from '@milkdown/kit/prose/model'
import { closeHistory } from '@milkdown/kit/prose/history'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { openAround } from './collapsible'

export interface Query {
  text: string
  caseSensitive: boolean
  wholeWord: boolean
}

// What the find bar (src/app/FindBar.svelte) uses: the document view and the source view
// (src/app/raw.ts) each give one.
export interface Finder {
  // Highlight the matches, or none for null.
  search(query: Query | null): void
  // Select the next or the previous match. With stay, a match at the cursor counts: the find
  // bar uses it while you type, so that the selected match grows with the text.
  go(direction: 1 | -1, stay?: boolean): void
  // Replace the selected match and select the next one. Without a selected match, select the next one.
  replace(text: string): void
  replaceAll(text: string): void
  // current is 0 when the selection is not a match.
  status(): { current: number; total: number }
}

export interface Match {
  from: number
  to: number
}

// An inline node that is not text (an image, a line break) is this one character in the
// searched text, so that a match does not go across it.
const OBJECT = '￼'
const WORD = /[\p{L}\p{N}_]/u

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The matches in one string, as [start, end] offsets.
export function matchesIn(text: string, query: Query): [number, number][] {
  const found: [number, number][] = []
  if (!query.text) return found
  const pattern = new RegExp(escape(query.text), query.caseSensitive ? 'gu' : 'giu')
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    const end = m.index + m[0].length
    if (query.wholeWord && (WORD.test(text[m.index - 1] ?? '') || WORD.test(text[end] ?? ''))) {
      pattern.lastIndex = m.index + 1
      continue
    }
    found.push([m.index, end])
  }
  return found
}

export function findMatches(doc: Node, query: Query): Match[] {
  const matches: Match[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => (text += child.isText ? child.text : OBJECT))
    for (const [start, end] of matchesIn(text, query)) matches.push({ from: pos + 1 + start, to: pos + 1 + end })
    return false
  })
  return matches
}

interface FindState {
  query: Query | null
  matches: Match[]
  decorations: DecorationSet
}

// The editor element sends this event when the matches or the selection change while find is
// on, so that the find bar shows the new count. The source view sends it too.
export const FIND_EVENT = 'marky-find'

const findKey = new PluginKey<FindState>('marky-find')

function build(doc: Node, query: Query | null): FindState {
  const matches = query ? findMatches(doc, query) : []
  const decorations = DecorationSet.create(doc, matches.map((m) => Decoration.inline(m.from, m.to, { class: 'find-match' })))
  return { query, matches, decorations }
}

// The index of the match that the selection is, or -1.
function currentIndex(state: EditorState): number {
  const { from, to } = state.selection
  const { matches } = findKey.getState(state)!
  return matches.findIndex((m) => m.from === from && m.to === to)
}

export const find = $prose(
  () =>
    new Plugin({
      key: findKey,
      state: {
        init: (_, state) => build(state.doc, null),
        apply(tr, value) {
          const query = tr.getMeta(findKey) as Query | null | undefined
          if (query !== undefined) return build(tr.doc, query)
          return tr.docChanged && value.query ? build(tr.doc, value.query) : value
        },
      },
      props: {
        decorations(state) {
          const { query, matches, decorations } = findKey.getState(state)!
          if (!query) return null
          const match = matches[currentIndex(state)]
          return match ? decorations.add(state.doc, [Decoration.inline(match.from, match.to, { class: 'find-current' })]) : decorations
        },
      },
      view: () => ({
        update(view, prev) {
          const now = findKey.getState(view.state)!
          if (now === findKey.getState(prev) && view.state.selection.eq(prev.selection)) return
          if (now.query || findKey.getState(prev)?.query) view.dom.dispatchEvent(new CustomEvent(FIND_EVENT, { bubbles: true }))
        },
      }),
    }),
)

function select(view: EditorView, match: Match) {
  // A match in a closed collapsible: open it first, so that the match is visible.
  openAround(view, match.from)
  const { state } = view
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, match.from, match.to)))
  // Not scrollIntoView of the transaction: it scrolls only when the editor has the focus, and the
  // focus is in the find bar. The center of the window is below the tab bar.
  view.dom.querySelector('.find-current')?.scrollIntoView({ block: 'center' })
}

export function documentFinder(view: EditorView): Finder {
  const matches = () => findKey.getState(view.state)!.matches
  const finder: Finder = {
    search(query) {
      if (query?.text) view.dispatch(view.state.tr.setMeta(findKey, query))
      else if (findKey.getState(view.state)!.query) view.dispatch(view.state.tr.setMeta(findKey, null))
    },
    go(direction, stay = false) {
      const all = matches()
      if (!all.length) return
      const { from, to } = view.state.selection
      const match =
        direction === 1
          ? (all.find((m) => m.from >= (stay ? from : to)) ?? all[0])
          : (all.findLast((m) => m.to <= from) ?? all.at(-1)!)
      select(view, match)
    },
    replace(text) {
      const match = matches()[currentIndex(view.state)]
      if (!match) return finder.go(1, true)
      const tr = text ? view.state.tr.insertText(text, match.from, match.to) : view.state.tr.delete(match.from, match.to)
      view.dispatch(closeHistory(tr))
      finder.go(1)
    },
    replaceAll(text) {
      const all = matches()
      if (!all.length) return
      // One transaction, so that one undo reverses it. From the end, so that the positions
      // of the matches before do not change.
      const tr = view.state.tr
      for (const m of [...all].reverse()) {
        if (text) tr.insertText(text, m.from, m.to)
        else tr.delete(m.from, m.to)
      }
      view.dispatch(closeHistory(tr))
    },
    status: () => ({ current: currentIndex(view.state) + 1, total: matches().length }),
  }
  return finder
}
