/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte()],
  // The app uses top-level await. WKWebView and WebKitGTK support it.
  build: { target: 'esnext' },
  clearScreen: false,
  // The Playwright tests in tests/visual are *.spec.ts and run with `npm run test:visual`.
  test: { include: ['tests/**/*.test.ts'] },
  // The Rust build output must not reload the page.
  server: { watch: { ignored: ['**/src-tauri/**'] } },
})
