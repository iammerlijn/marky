// The fields of the front matter panel (design document, section 6.5).
// Simple values show as fields. Other YAML shows as raw YAML. A field edit replaces only the
// source text of its value, so the rest of the YAML keeps its exact formatting.
import { Document, isAlias, isMap, isScalar, isSeq, parseDocument, type Scalar } from 'yaml'

export interface Field {
  key: string
  type: 'text' | 'number' | 'boolean' | 'list'
  value: string
}

export type Fields = { kind: 'fields'; fields: Field[] } | { kind: 'raw' } | { kind: 'error'; message: string }

const plain = (node: unknown): node is Scalar => isScalar(node) && !node.anchor

export function fieldsOf(yaml: string): Fields {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) return { kind: 'error', message: doc.errors[0].message }
  // Comments, anchors and nested values show as raw YAML, so that nothing is lost.
  if (/(^|\s)#/.test(yaml)) return { kind: 'raw' }
  if (doc.contents === null) return { kind: 'fields', fields: [] }
  if (!isMap(doc.contents)) return { kind: 'raw' }
  const fields: Field[] = []
  for (const pair of doc.contents.items) {
    const { key, value } = pair
    if (!plain(key) || isAlias(value)) return { kind: 'raw' }
    if (plain(value)) {
      const type = typeof value.value === 'boolean' ? 'boolean' : typeof value.value === 'number' ? 'number' : 'text'
      fields.push({ key: String(key.value), type, value: String(value.value ?? '') })
    } else if (isSeq(value) && !value.anchor && value.items.every(plain)) {
      fields.push({ key: String(key.value), type: 'list', value: value.items.map((item) => String((item as Scalar).value)).join(', ') })
    } else {
      return { kind: 'raw' }
    }
  }
  return { kind: 'fields', fields }
}

// The YAML source of one scalar, with the quote style of the old value when possible.
function scalarSource(value: unknown, type?: Scalar.Type): string {
  const doc = new Document(value)
  if (type && isScalar(doc.contents)) doc.contents.type = type
  return doc.toString().trimEnd()
}

function parseValue(text: string, number: boolean): unknown {
  if (number && text.trim() !== '' && !Number.isNaN(Number(text))) return Number(text)
  return text
}

export function setField(yaml: string, key: string, text: string): string {
  const doc = parseDocument(yaml)
  const node = doc.get(key, true)
  let source: string
  if (isSeq(node)) {
    const items = text.split(',').map((item) => item.trim()).filter(Boolean)
    if (node.flow) {
      source = `[${items.map((item) => scalarSource(item)).join(', ')}]`
    } else {
      // A block list: the same indent as the first item.
      const start = node.range![0]
      const indent = ' '.repeat(start - yaml.lastIndexOf('\n', start - 1) - 1)
      source = items.map((item) => `- ${scalarSource(item)}`).join(`\n${indent}`)
    }
  } else if (isScalar(node)) {
    const value =
      typeof node.value === 'boolean' ? text === 'true' : parseValue(text, typeof node.value === 'number')
    source = scalarSource(value, typeof value === 'string' ? node.type : undefined)
  } else {
    throw new Error(`No simple field ${key}`)
  }
  const [start, end] = node.range!
  // The range of a block value can end after its newline. Keep that newline.
  const kept = yaml.slice(start, end).match(/\s*$/)![0]
  return yaml.slice(0, start) + source + kept + yaml.slice(end)
}
