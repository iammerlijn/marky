// An empty document shows a hint for the `/` menu. The hint is a decoration: it is not in the file.
import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export const placeholderText = 'Type / to insert a block'

export const placeholder = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const { doc } = state
          const first = doc.firstChild
          if (doc.childCount !== 1 || first?.type.name !== 'paragraph' || first.content.size > 0) return null
          return DecorationSet.create(doc, [
            Decoration.node(0, first.nodeSize, { class: 'is-empty', 'data-placeholder': placeholderText }),
          ])
        },
      },
    }),
)
