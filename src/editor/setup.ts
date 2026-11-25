import {
  Editor,
  defaultValueCtx,
  parserCtx,
  remarkCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core'
import { history } from '@milkdown/kit/plugin/history'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm, remarkGFMPlugin } from '@milkdown/kit/preset/gfm'
import type { Root, RootContent } from 'mdast'
import type { Markdown } from '../markdown/preserve'
import { codeblock } from './plugins/codeblock'
import { collapsible } from './plugins/collapsible'
import { frontmatter } from './plugins/frontmatter'
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
    .create()
}

export function markdownOf(editor: Editor): Markdown {
  const ctx = editor.ctx
  return {
    parse: (text) => ctx.get(parserCtx)(text),
    serialize: (doc) => ctx.get(serializerCtx)(doc),
    blocks: (text) => {
      const remark = ctx.get(remarkCtx)
      const span = (node: RootContent) => ({ start: node.position!.start.offset!, end: node.position!.end.offset! })
      // The same transforms as the editor parser, so that a block that a plugin makes
      // (for example a collapsible) is one block here too.
      const shown = (remark.runSync(remark.parse(text), text) as Root).children.map(span)
      // A transform can remove a block: link definitions are removed after the links are
      // resolved. Such a block has no editor node, and Marky keeps its text.
      const hidden = remark
        .parse(text)
        .children.map(span)
        .filter((raw) => !shown.some((s) => raw.start >= s.start && raw.end <= s.end))
      return [...shown.map((s) => ({ ...s, hidden: false })), ...hidden.map((s) => ({ ...s, hidden: true }))].sort(
        (a, b) => a.start - b.start,
      )
    },
  }
}
