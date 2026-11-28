// Task lists. The checkbox is drawn by CSS left of the list item (styles/document.css), so a
// click on it has the list item as target, left of its box. Such a click checks or unchecks the task.
import { Plugin } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

export const tasks = $prose(
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
