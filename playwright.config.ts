// Visual tests: screenshots compared with approved images.
// WebKit is the engine of Tauri on macOS and Linux. Run them in the Playwright container,
// so that fonts and rendering are the same on each machine: `npm run test:visual`.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/visual',
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  fullyParallel: true,
  use: {
    browserName: 'webkit',
    viewport: { width: 1000, height: 800 },
    baseURL: 'http://127.0.0.1:5173',
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' } },
  webServer: {
    // --force: scan all dependencies before the first page. A stale node_modules/.vite (the CI
    // cache keeps it) makes Vite find a dependency during a test and reload the page.
    command: 'npm run dev -- --force',
    url: 'http://127.0.0.1:5173/dev/preview.html',
    reuseExistingServer: true,
  },
})
