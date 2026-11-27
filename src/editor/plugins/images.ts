// Remote images. An image from another server shows a placeholder, so that opening a document
// does not send a request to that server (it would give the server the IP address of the user).
// "Load remote images" loads them, for this document only. Local images (a relative path, an
// embedded data: image or a file through the asset: protocol) load as before.
import type { Node } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export const blockedText = 'Remote image not loaded'
export const loadText = 'Load remote images'

const LOCAL = new Set(['data:', 'asset:'])

// The browser resolves the src against the page, so this does the same. A src that is not a
// URL counts as remote: it is better to block an image than to load one by mistake.
export function isRemote(src: string, base = document.baseURI): boolean {
  try {
    const url = new URL(src, base)
    const page = new URL(base)
    if (LOCAL.has(url.protocol)) return false
    return url.protocol !== page.protocol || url.host !== page.host
  } catch {
    return true
  }
}

interface State {
  allowed: boolean
  // A decoration on each remote image when they are allowed: it makes ProseMirror call
  // update() on the node views, which then show the images.
  set: DecorationSet
}

const key = new PluginKey<State>('marky-images')

const allowed = (view: EditorView) => key.getState(view.state)?.allowed ?? false

function remoteImages(doc: Node): DecorationSet {
  const list: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'image' && isRemote(node.attrs.src)) {
      list.push(Decoration.node(pos, pos + node.nodeSize, {}, { remote: true }))
    }
  })
  return DecorationSet.create(doc, list)
}

function image(node: Node): HTMLImageElement {
  const img = document.createElement('img')
  img.src = node.attrs.src
  if (node.attrs.alt) img.alt = node.attrs.alt
  if (node.attrs.title) img.title = node.attrs.title
  return img
}

function placeholder(node: Node, view: EditorView): HTMLElement {
  const box = document.createElement('span')
  box.className = 'remote-image'
  box.contentEditable = 'false'
  box.title = `${node.attrs.src}\nMarky does not load images from other servers without your consent.`
  const label = document.createElement('span')
  label.textContent = node.attrs.alt ? `${blockedText}: ${node.attrs.alt}` : blockedText
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = loadText
  button.addEventListener('click', () => view.dispatch(view.state.tr.setMeta(key, true)))
  box.append(label, button)
  return box
}

class ImageView implements NodeView {
  dom: HTMLElement
  private blocked: boolean

  constructor(private node: Node, view: EditorView) {
    this.blocked = isRemote(node.attrs.src) && !allowed(view)
    this.dom = this.blocked ? placeholder(node, view) : image(node)
  }

  // Make the view again when the image changes, or when a blocked image is now allowed.
  update(node: Node, decorations: readonly Decoration[]) {
    if (!node.sameMarkup(this.node)) return false
    return !(this.blocked && decorations.some((d) => d.spec.remote))
  }

  // The button gets its own clicks: the editor does not select the image for them.
  stopEvent(event: Event) {
    return event.target instanceof HTMLButtonElement
  }
}

export const images = $prose(
  () =>
    new Plugin<State>({
      key,
      state: {
        init: () => ({ allowed: false, set: DecorationSet.empty }),
        apply(tr, value) {
          if (tr.getMeta(key) && !value.allowed) return { allowed: true, set: remoteImages(tr.doc) }
          return tr.docChanged ? { ...value, set: value.set.map(tr.mapping, tr.doc) } : value
        },
      },
      props: {
        decorations: (state) => key.getState(state)?.set,
        nodeViews: { image: (node, view) => new ImageView(node, view) },
      },
    }),
)
