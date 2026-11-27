/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte()],
  // The app uses top-level await. WKWebView and WebKitGTK support it.
  // Two pages: the editor window and the settings window.
  build: { target: 'esnext', rolldownOptions: { input: ['index.html', 'settings.html'] } },
  // The highlight worker loads each Shiki language as a chunk: that needs an ES module worker.
  worker: { format: 'es' },
  clearScreen: false,
  // The Playwright tests in tests/visual are *.spec.ts and run with `npm run test:visual`.
  test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
  // The Rust build output must not reload the page.
  server: { watch: { ignored: ['**/src-tauri/**'] } },
})
