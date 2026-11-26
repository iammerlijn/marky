// The worker that highlights code blocks (highlighter.ts).
import { createTokenizer } from './highlighter'

const tokenize = createTokenizer()

onmessage = async ({ data }: MessageEvent<{ id: number; code: string; language: string }>) => {
  // A failed load shows plain code. The answer must come, because the page waits for it.
  const spans = await tokenize(data.code, data.language).catch(() => null)
  postMessage({ id: data.id, spans })
}
