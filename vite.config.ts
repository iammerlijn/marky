import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte()],
  // The app uses top-level await. WKWebView and WebKitGTK support it.
  build: { target: 'esnext' },
  clearScreen: false,
  // The Rust build output must not reload the page.
  server: { watch: { ignored: ['**/src-tauri/**'] } },
})
