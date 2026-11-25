// The documents and the app chrome in light and dark mode. After an intended change of the
// look, approve the new images: `npm run test:visual -- --update-snapshots`.
import { expect, test, type Page } from '@playwright/test'

async function ready(page: Page) {
  await page.waitForSelector('.ProseMirror')
  await page.evaluate(() => document.fonts.ready)
  // Mermaid loads only when a diagram is visible.
  for (const diagram of await page.locator('.mermaid-diagram').all()) {
    await diagram.scrollIntoViewIfNeeded()
    await diagram.locator('svg').waitFor()
  }
  // Highlighting loads per language.
  if (await page.locator('.code-block[data-language="ts"]').count()) {
    await page.locator('.code-block[data-language="ts"] code span[style]').first().waitFor()
  }
  await page.evaluate(() => window.scrollTo(0, 0))
}

test('outline: keyboard', async ({ page }) => {
  await page.goto('/dev/preview.html')
  await ready(page)
  await expect(page.locator('.outline-item').first()).toHaveAttribute('aria-current', 'location')
  await page.locator('.outline-rail').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.outline-item').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.outline-panel')).toBeHidden()
  await expect(page.locator('.outline-rail')).toBeFocused()
  // Enter on the last heading scrolls to it and puts the cursor in it.
  await page.keyboard.press('Enter')
  const items = page.locator('.outline-item')
  for (let i = 1; i < (await items.count()); i++) await page.keyboard.press('ArrowDown')
  const last = await items.last().textContent()
  await page.keyboard.press('Enter')
  await expect(page.locator('.outline-panel')).toBeHidden()
  const heading = page.locator('.ProseMirror').getByRole('heading', { name: last! })
  await expect(heading).toBeInViewport()
  expect(await page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest('h1, h2, h3, h4, h5, h6')?.textContent)).toBe(last)
})

const documents = [
  ['sample', '/dev/preview.html'],
  ['tables', '/dev/preview.html?file=tables.md'],
  ['lists', '/dev/preview.html?file=lists.md'],
  ['html', '/dev/preview.html?file=html.md'],
  ['frontmatter', '/dev/preview.html?file=front-matter-simple.md'],
  ['empty', '/dev/preview.html?file=empty.md'],
  ['box-drawing', '/dev/preview.html?file=box-drawing.md'],
]

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme })

    for (const [name, url] of documents) {
      test(`document: ${name}`, async ({ page }) => {
        await page.goto(url)
        await ready(page)
        await expect(page).toHaveScreenshot(`${name}-${colorScheme}.png`, { fullPage: true })
      })
    }

    for (const state of ['tabs', 'banner', 'empty', 'raw']) {
      test(`app: ${state}`, async ({ page }) => {
        await page.goto(`/dev/app.html?state=${state}`)
        await page.waitForSelector('body[data-ready]')
        await page.evaluate(() => document.fonts.ready)
        await expect(page).toHaveScreenshot(`app-${state}-${colorScheme}.png`)
      })
    }

    // The tab bar and the banner stay at the top while the window scrolls.
    for (const state of ['banner', 'raw']) {
      test(`app: ${state}, scrolled`, async ({ page }) => {
        await page.goto(`/dev/app.html?state=${state}`)
        await page.waitForSelector('body[data-ready]')
        await page.evaluate(() => document.fonts.ready)
        await page.evaluate(() => window.scrollTo(0, 400))
        expect(await page.evaluate(() => window.scrollY)).toBe(400)
        expect((await page.locator('.tab-bar').boundingBox())?.y).toBe(0)
        await expect(page).toHaveScreenshot(`app-${state}-scrolled-${colorScheme}.png`)
      })
    }

    test('outline: closed', async ({ page }) => {
      await page.goto('/dev/preview.html?file=outline.md')
      await ready(page)
      await page.evaluate(() => window.scrollTo(0, 300))
      // The dash of the current section updates while you scroll.
      await expect(page.locator('.outline-dash.is-current')).not.toHaveCount(0)
      await expect(page.locator('.outline-dash').first()).not.toHaveClass(/is-current/)
      await expect(page).toHaveScreenshot(`outline-closed-${colorScheme}.png`)
    })

    test('outline: open', async ({ page }) => {
      await page.goto('/dev/preview.html?file=outline.md')
      await ready(page)
      await page.evaluate(() => window.scrollTo(0, 300))
      // Not hover(): the open panel covers the rail, so Playwright would wait for the rail.
      const rail = (await page.locator('.outline-rail').boundingBox())!
      await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2)
      await expect(page.locator('.outline-panel')).toBeVisible()
      await expect(page).toHaveScreenshot(`outline-open-${colorScheme}.png`)
      // The panel closes after the mouse leaves it.
      await page.mouse.move(600, 400)
      await expect(page.locator('.outline-panel')).toBeHidden()
    })

    test('slash menu', async ({ page }) => {
      await page.goto('/dev/preview.html')
      await ready(page)
      await page.locator('.ProseMirror').getByText('Update the onboarding docs').click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await page.keyboard.type('/')
      await expect(page.locator('.slash-menu')).toBeVisible()
      await expect(page).toHaveScreenshot(`slash-${colorScheme}.png`)
    })
  })
}
