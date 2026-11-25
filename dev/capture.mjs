// Screenshots and a screen recording of the dev preview, in Playwright WebKit.
// Runs in the Playwright container (see dev/README.md). OUT is the output folder.
import { renameSync } from 'node:fs'
import { webkit } from 'playwright'

const base = 'http://127.0.0.1:5173/dev/preview.html'
const out = process.env.OUT ?? '/out'
const browser = await webkit.launch()

async function ready(page) {
  await page.waitForSelector('.ProseMirror')
  await page.evaluate(() => document.fonts.ready)
  // Mermaid loads only when a diagram is visible: scroll to each diagram and wait for it.
  for (const diagram of await page.locator('.mermaid-diagram').all()) {
    await diagram.scrollIntoViewIfNeeded()
    await diagram.locator('svg').waitFor({ timeout: 15000 })
  }
  await page.evaluate(() => window.scrollTo(0, 0))
}

for (const colorScheme of ['light', 'dark']) {
  for (const [name, query] of [['sample', ''], ['tables', '?file=tables.md'], ['lists', '?file=lists.md'], ['html', '?file=html.md'], ['frontmatter', '?file=front-matter.md'], ['frontmatter-simple', '?file=front-matter-simple.md']]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 2, colorScheme })
    await page.goto(base + query)
    await ready(page)
    await page.screenshot({ path: `${out}/${name}-${colorScheme}.png`, fullPage: true })
    await page.close()
  }
}

// Recording: edits in the editor, and the diff that a save writes.
const size = { width: 1500, height: 900 }
const context = await browser.newContext({ viewport: size, recordVideo: { dir: out, size } })
const page = await context.newPage()
await page.goto(base + '?diff')
await ready(page)
const pause = (ms = 1200) => page.waitForTimeout(ms)
const typeAtEnd = async (locator, text) => {
  await locator.click()
  await page.keyboard.press('End')
  await page.keyboard.type(text, { delay: 70 })
}
await pause(1500)
await typeAtEnd(page.locator('.ProseMirror').getByText('Fix the three crash reports'), ' (see Sentry)')
await pause()
await typeAtEnd(page.locator('td', { hasText: 'In progress' }), ' (80%)')
await pause()
await typeAtEnd(page.locator('.ProseMirror').getByText('Questions go to'), '')
await page.keyboard.press('Enter')
await page.keyboard.type('A new paragraph at the end.', { delay: 70 })
await pause(1800)
for (let i = 0; i < 12; i++) {
  await page.keyboard.press('ControlOrMeta+z')
  await page.waitForTimeout(120)
}
await pause(2000)
const video = await page.video().path()
await context.close()
renameSync(video, `${out}/recording.webm`)

// The app chrome: tabs, the "changed on disk" bar and the empty window.
for (const colorScheme of ['light', 'dark']) {
  for (const state of ['tabs', 'banner', 'empty', 'raw']) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2, colorScheme })
    await page.goto(`http://127.0.0.1:5173/dev/app.html?state=${state}`)
    await page.waitForSelector('body[data-ready]')
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${out}/app-${state}-${colorScheme}.png` })
    await page.close()
  }
}

// The `/` menu: a screenshot of the open menu, and a recording that inserts blocks with it.
for (const colorScheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2, colorScheme })
  await page.goto(base)
  await ready(page)
  await page.locator('.ProseMirror').getByText('Update the onboarding docs').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  await page.screenshot({ path: `${out}/slash-${colorScheme}.png` })
  await page.close()
}

const slashContext = await browser.newContext({ viewport: size, recordVideo: { dir: out, size } })
const slashPage = await slashContext.newPage()
await slashPage.goto(base + '?diff')
await ready(slashPage)
const slow = (text) => slashPage.keyboard.type(text, { delay: 90 })
await slashPage.waitForTimeout(1200)
await slashPage.locator('.ProseMirror').getByText('Questions go to').click()
await slashPage.keyboard.press('End')
await slashPage.keyboard.press('Enter')
await slow('/')
await slashPage.waitForTimeout(1200)
await slow('bul')
await slashPage.waitForTimeout(900)
await slashPage.keyboard.press('Enter')
await slow('First item')
await slashPage.keyboard.press('Enter')
await slow('Second item')
await slashPage.keyboard.press('Enter')
await slashPage.keyboard.press('Enter')
await slow('/tab')
await slashPage.waitForTimeout(900)
await slashPage.keyboard.press('Enter')
await slow('Name')
await slashPage.keyboard.press('Tab')
await slow('Owner')
await slashPage.waitForTimeout(2500)
const slashVideo = await slashPage.video().path()
await slashContext.close()
renameSync(slashVideo, `${out}/slash.webm`)

await browser.close()
