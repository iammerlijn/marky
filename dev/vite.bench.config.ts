// A production build of the benchmark page: `npx vite build --config dev/vite.bench.config.ts`,
// then `npx vite preview --config dev/vite.bench.config.ts`. See dev/bench.mjs.
import { defineConfig, mergeConfig } from 'vite'
import base from '../vite.config'

export default mergeConfig(
  base,
  defineConfig({
    build: { outDir: 'dist-bench', rollupOptions: { input: 'dev/bench.html' } },
    preview: { port: 5174, strictPort: true, host: '127.0.0.1' },
  }),
)
