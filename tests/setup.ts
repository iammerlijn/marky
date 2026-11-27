// Tests run in happy-dom, which has no Worker. The code blocks highlight in the test process.
// The import is in a hook, after the test file loads: some tests set navigator.platform before
// ProseMirror loads (shortcuts.test.ts).
import { beforeAll } from 'vitest'

beforeAll(async () => {
  const [{ loaders }, { createTokenizer }] = await Promise.all([
    import('../src/editor/plugins/codeblock'),
    import('../src/editor/plugins/highlighter'),
  ])
  loaders.tokenize = createTokenizer()
})
