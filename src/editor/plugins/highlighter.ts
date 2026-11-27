// Shiki highlighting of one code block. It runs in a worker (highlight.worker.ts): Shiki makes
// much garbage, and WebKit gives that memory back only when the worker stops (issue 2).
import type { HighlighterCore } from 'shiki/core'
import { languageModule } from './languages'

export interface Span {
  from: number
  to: number
  style: string
}

// The spans of the code, or null when the language is not known.
export type Tokenize = (code: string, language: string) => Promise<Span[] | null>

export function createTokenizer(): Tokenize {
  let highlighter: Promise<HighlighterCore> | null = null
  const languages = new Map<string, Promise<boolean>>()

  // Loads the language once. Resolves to false for an unknown language.
  function loadLanguage(name: string): Promise<boolean> {
    let loading = languages.get(name)
    if (!loading) {
      highlighter ??= (async () => {
        const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
          import('shiki/core'),
          import('shiki/engine/javascript'),
        ])
        return createHighlighterCore({
          themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
          langs: [],
          engine: createJavaScriptRegexEngine(),
        })
      })()
      const language = languageModule(name)
      loading = language ? highlighter.then((h) => h.loadLanguage(language)).then(() => true) : Promise.resolve(false)
      languages.set(name, loading)
    }
    return loading
  }

  return async (code, language) => {
    if (!(await loadLanguage(language))) return null
    const { tokens } = (await highlighter!).codeToTokens(code, {
      lang: language,
      themes: { light: 'github-light', dark: 'github-dark' },
    })
    // token.offset is the offset in the whole code text.
    const result: Span[] = []
    for (const token of tokens.flat()) {
      const style = Object.entries(token.htmlStyle ?? {})
        .map(([key, value]) => `${key}:${value}`)
        .join(';')
      if (style) result.push({ from: token.offset, to: token.offset + token.content.length, style })
    }
    return result
  }
}
