// @vitest-environment happy-dom
// Test plan, section 4: content-loss test. Random documents, one random edit each.
// Each block that the edit did not touch must stay in the file without change.
import { expect, test } from 'vitest'
import { open } from './helpers'

const parts = [
  (n: number) => `# Heading ${n}`,
  (n: number) => `Heading ${n}\n---------`,
  (n: number) => `Paragraph ${n} with [a link](https://example.com/${n}) and *emphasis*.`,
  (n: number) => `Text ${n} with &mdash; and <kbd>inline</kbd> HTML  \nand a hard break.`,
  (n: number) => `* item ${n}\n* item with \`code\`\n  * nested ${n}`,
  (n: number) => `1) step ${n}\n2) step two`,
  (n: number) => `- [ ] task ${n}\n- [x] done`,
  (n: number) => `| col ${n} | b |\n|:--|--:|\n| ![img](./${n}.png) | \\| |`,
  (n: number) => '```ts\nconst n = ' + n + '\n```',
  // Without blank lines, so that it is one HTML block. The tests in edit.test.ts cover the other form.
  (n: number) => `<details>\n<summary>Summary ${n}</summary>\nBody ${n}\n</details>`,
  (n: number) => `<details open>\n<summary>Collapsible ${n}</summary>\n\nBody ${n} with *emphasis*.\n\n- item\n\n</details>`,
  (n: number) => `+++ Linear ${n}\n\nBody ${n}.\n\n+++`,
  (n: number) => `<!-- comment ${n} -->`,
  (n: number) => `> quote ${n}\n> > nested`,
  (n: number) => `***`,
]

// mulberry32: small seeded random number generator, so that a failure can be repeated.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const runs = Number(process.env.MARKY_FUZZ_RUNS ?? 200)

test(`content loss: ${runs} random documents`, async () => {
  for (let seed = 1; seed <= runs; seed++) {
    const rnd = random(seed)
    const pick = (n: number) => Math.floor(rnd() * n)
    // A list directly after a list of the same type joins into one list. Put a paragraph between blocks.
    const blocks: string[] = []
    const count = 2 + pick(8)
    for (let i = 0; i < count; i++) {
      if (i > 0) blocks.push(`Separator ${i}.`)
      blocks.push(parts[pick(parts.length)](i))
    }
    const source = blocks.join(['\n\n', '\n\n\n'][pick(2)]) + ['\n', '', '\n\n'][pick(3)]

    const doc = await open(source)
    try {
      const { view } = doc
      const target = pick(view.state.doc.childCount)
      let from = 0
      for (let i = 0; i < target; i++) from += view.state.doc.child(i).nodeSize
      const node = view.state.doc.child(target)
      const operation = ['type', 'delete', 'move'][pick(3)]
      let touched = -1
      if (operation === 'type') {
        let pos = -1
        node.descendants((child, p) => {
          if (pos < 0 && child.isTextblock) pos = from + 1 + p + 1
        })
        if (pos >= 0) {
          view.dispatch(view.state.tr.insertText('typed ', pos))
          touched = target
        }
      } else if (operation === 'delete') {
        view.dispatch(view.state.tr.delete(from, from + node.nodeSize))
        touched = target
      } else {
        const tr = view.state.tr.delete(from, from + node.nodeSize)
        view.dispatch(tr.insert(pick(2) ? 0 : tr.doc.content.size, node))
      }

      const { text } = doc.save()
      blocks.forEach((block, i) => {
        if (i === touched) return
        expect(text.includes(block), `seed ${seed}, ${operation} block ${target}: lost\n${block}\n--- result:\n${text}`).toBe(true)
      })
    } finally {
      await doc.destroy()
    }
  }
}, 120_000)
