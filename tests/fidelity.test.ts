// @vitest-environment happy-dom
// Test plan, section 3: open and save without edits gives 0 changed bytes.
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { open } from './helpers'

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => join(e.parentPath, e.name))
    .filter((p) => !p.includes('/node_modules/') && !p.includes('/.git/'))
    .sort()
}

async function expectRoundTrip(path: string) {
  const bytes = readFileSync(path)
  const text = bytes.toString('utf8')
  // Files that are not valid UTF-8 are not opened for editing (test plan, section 6).
  if (!Buffer.from(text, 'utf8').equals(bytes)) return
  const doc = await open(text)
  try {
    const result = doc.save()
    expect(Buffer.from(result.text, 'utf8').equals(bytes), path).toBe(true)
    expect(result.changed).toBe(false)
  } finally {
    await doc.destroy()
  }
}

describe('public corpus', () => {
  const dir = join(import.meta.dirname, 'corpus')
  test.each(markdownFiles(dir).map((p) => [p.slice(dir.length + 1), p]))('%s', async (_, path) => {
    await expectRoundTrip(path)
  })
})

// Private corpus: MARKY_CORPUS=~/Projects npm test
const privateDir = process.env.MARKY_CORPUS?.replace(/^~/, homedir())
describe.runIf(privateDir)('private corpus', () => {
  test.each(privateDir ? markdownFiles(privateDir) : [])('%s', async (path) => {
    await expectRoundTrip(path)
  })
})
