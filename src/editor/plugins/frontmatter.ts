// Front matter: YAML between `---` lines shows as a panel
// above the document. A front matter that you do not edit keeps its original text (preserve.ts).
import type { Node } from '@milkdown/kit/prose/model'
import type { EditorView, NodeView } from '@milkdown/kit/prose/view'
import { $node, $remark, $view } from '@milkdown/kit/utils'
import remarkFrontmatter from 'remark-frontmatter'
import { fieldsOf, setField } from './fields'

export const remarkYaml = $remark('remarkFrontmatter', () => remarkFrontmatter, ['yaml'])

export const frontmatterNode = $node('frontmatter', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  attrs: { value: { default: '' } },
  parseDOM: [{ tag: 'div[data-type="frontmatter"]', getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? '' }) }],
  toDOM: (node) => ['div', { 'data-type': 'frontmatter', 'data-value': node.attrs.value }],
  parseMarkdown: {
    match: (node) => node.type === 'yaml',
    runner: (state, node, type) => {
      state.addNode(type, { value: node.value })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'frontmatter',
    runner: (state, node) => {
      state.addNode('yaml', undefined, node.attrs.value)
    },
  },
}))

// The panel: a field for each simple value, or a text area with the raw YAML.
class FrontmatterView implements NodeView {
  dom: HTMLElement
  private shown = ''

  constructor(
    private node: Node,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'frontmatter'
    this.dom.contentEditable = 'false'
    this.render()
  }

  private change(value: string) {
    const pos = this.getPos()
    if (pos === undefined) return
    // The panel already shows this value: do not build it again while you type.
    this.shown = value
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { value }))
  }

  private render() {
    const value: string = this.node.attrs.value
    this.shown = value
    const fields = fieldsOf(value)
    this.dom.replaceChildren()
    if (fields.kind === 'fields') {
      for (const field of fields.fields) {
        const row = document.createElement('div')
        row.className = 'frontmatter-field'
        const label = document.createElement('label')
        label.textContent = field.key
        const input = document.createElement('input')
        input.dataset.key = field.key
        const id = `frontmatter-${field.key}`
        input.id = id
        label.htmlFor = id
        if (field.type === 'boolean') {
          input.type = 'checkbox'
          input.checked = field.value === 'true'
          input.addEventListener('change', () => this.change(setField(this.node.attrs.value, field.key, String(input.checked))))
        } else {
          input.value = field.value
          input.addEventListener('input', () => this.change(setField(this.node.attrs.value, field.key, input.value)))
        }
        row.append(label, input)
        this.dom.append(row)
      }
      return
    }
    if (fields.kind === 'error') {
      const error = document.createElement('div')
      error.className = 'frontmatter-error'
      error.textContent = `The front matter is not valid YAML: ${fields.message}`
      this.dom.append(error)
    }
    const area = document.createElement('textarea')
    area.value = value
    area.rows = Math.min(12, value.split('\n').length + 1)
    area.spellcheck = false
    area.addEventListener('input', () => this.change(area.value))
    this.dom.append(area)
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false
    this.node = node
    if (node.attrs.value !== this.shown) this.render()
    return true
  }

  stopEvent() {
    return true
  }

  ignoreMutation() {
    return true
  }
}

export const frontmatterView = $view(frontmatterNode, () => (node, view, getPos) => new FrontmatterView(node, view, getPos))

export const frontmatter = [remarkYaml, frontmatterNode, frontmatterView].flat()
