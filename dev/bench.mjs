// Runs dev/bench.html in WebKit 3 times and prints the results. Start `npm run dev` first.
// Runs in the Playwright container, as dev/capture.mjs does.
import { webkit } from '@playwright/test'

const browser = await webkit.launch()
for (let run = 1; run <= 3; run++) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
  await page.goto(process.env.BENCH_URL ?? 'http://127.0.0.1:5173/dev/bench.html')
  await page.waitForSelector('body[data-result]', { timeout: 120000 })
  console.log(`run ${run}:`, await page.evaluate(() => document.body.dataset.result))
  await page.close()
}
await browser.close()
