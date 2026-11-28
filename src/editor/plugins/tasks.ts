// Task lists. The checkbox is drawn by CSS left of the list item (styles/document.css), so a
// click on it has the list item as target, left of its box. Such a click checks or unchecks the task.
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { splitListItem } from '@milkdown/kit/prose/schema-list'
import { type Command, Plugin } from '@milkdown/kit/prose/state'
import { $inputRule, $prose, $useKeymap } from '@milkdown/kit/utils'

// "[ ] " or "[x] " at the start of a paragraph out of a list makes a list with one task.
// In a list item, the GFM preset does it.
const taskInput = $inputRule(
  () =>
    new InputRule(/^\[([ xX])\]\s$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start)
      if ($start.parent.type.name !== 'paragraph') return null
      for (let d = $start.depth - 1; d > 0; d--) if ($start.node(d).type.name === 'list_item') return null
      const { bullet_list, list_item } = state.schema.nodes
      const tr = state.tr.delete(start, end)
      const range = tr.doc.resolve(start).blockRange()
      if (!range) return null
      const checked = match[1] !== ' '
      return tr.wrap(range, [{ type: bullet_list }, { type: list_item, attrs: { checked } }])
    }),
)

// Enter in a checked task with text: the new task is not checked. Other cases go to the
// Enter of the list items (priority 50).
const splitCheckedTask: Command = (state, dispatch) => {
  const { $from } = state.selection
  const item = $from.node(-1)
  if ($from.depth < 2 || item.type.name !== 'list_item' || item.attrs.checked !== true) return false
  if ($from.parent.content.size === 0) return false
  return splitListItem(item.type)(
    state,
    dispatch &&
      ((tr) => {
        const $cursor = tr.selection.$from
        dispatch(tr.setNodeAttribute($cursor.before(-1), 'checked', false))
      }),
  )
}

const taskKeymap = $useKeymap('taskKeymap', {
  SplitCheckedTask: { shortcuts: 'Enter', priority: 60, command: () => splitCheckedTask },
})

const toggle = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          mousedown(view, event) {
            const item = event.target as HTMLElement
            if (event.button !== 0 || !view.editable || !item.matches?.('li[data-item-type="task"]')) return false
            if (event.clientX >= item.getBoundingClientRect().left) return false
            const pos = view.posAtDOM(item, 0) - 1
            const node = view.state.doc.nodeAt(pos)
            if (node?.attrs.checked == null) return false
            view.dispatch(view.state.tr.setNodeAttribute(pos, 'checked', !node.attrs.checked))
            // No cursor move and no selection start.
            event.preventDefault()
            return true
          },
        },
      },
    }),
)

export const tasks = [toggle, taskInput, taskKeymap].flat()
