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
