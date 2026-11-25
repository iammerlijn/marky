import {
  Editor,
  defaultValueCtx,
  parserCtx,
  remarkCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  schemaCtx,
  serializerCtx,
} from '@milkdown/kit/core'
import { ParserState } from '@milkdown/kit/transformer'
import { history } from '@milkdown/kit/plugin/history'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm, remarkGFMPlugin } from '@milkdown/kit/preset/gfm'
import type { Root, RootContent } from 'mdast'
import type { Markdown } from '../markdown/preserve'
import { boxDrawing } from './plugins/boxdrawing'
import { codeblock } from './plugins/codeblock'
import { collapsible } from './plugins/collapsible'
import { frontmatter } from './plugins/frontmatter'
import { placeholder } from './plugins/placeholder'
import { slash } from './plugins/slash'

// Serializer settings that gave the fewest changes in the fidelity test
// (design document, section 3).
const stringifyOptions = {
  bullet: '-',
  emphasis: '_',
  strong: '*',
  listItemIndent: 'one',
  // A divider is written as `---`, the same as the `/` menu and the shortcut (section 6.8).
  rule: '-',
} as const

export async function createEditor(root: HTMLElement, text = ''): Promise<Editor> {
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, text)
      ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, ...stringifyOptions }))
      ctx.set(remarkGFMPlugin.options.key, { tablePipeAlign: false })
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(frontmatter)
    .use(collapsible)
    .use(codeblock)
    .use(slash)
    .use(placeholder)
    .use(boxDrawing)
    .create()
}

type Span = { start: number; end: number }

const span = (node: RootContent): Span => ({ start: node.position!.start.offset!, end: node.position!.end.offset! })

// A transform can remove a block: link definitions are removed after the links are resolved.
// Such a block has no editor node, and Marky keeps its text. Both lists are in text order.
function withHidden(shown: Span[], raw: Span[]) {
  const blocks = shown.map((s) => ({ ...s, hidden: false }))
  let j = 0
  for (const r of raw) {
    while (j < shown.length && shown[j].end < r.end) j++
    const inside = j < shown.length && shown[j].start <= r.start && r.end <= shown[j].end
    if (!inside) blocks.push({ ...r, hidden: true })
  }
  return blocks.sort((a, b) => a.start - b.start)
}

export function markdownOf(editor: Editor): Markdown {
  const ctx = editor.ctx
  return {
    parse: (text) => ctx.get(parserCtx)(text),
    serialize: (doc) => ctx.get(serializerCtx)(doc),
    // One parse for the editor document and the block map, because a parse of a long file is
    // slow. The block map uses the same transforms as the editor, so that a block that a plugin
    // makes (for example a collapsible) is one block in both.
    read: (text) => {
      const remark = ctx.get(remarkCtx)
      const tree = remark.parse(text)
      const raw = tree.children.map(span)
      const transformed = remark.runSync(tree, text) as Root
      const state = new ParserState(ctx.get(schemaCtx))
      state.next(transformed as never)
      return { doc: state.toDoc(), blocks: withHidden(transformed.children.map(span), raw) }
    },
  }
}
