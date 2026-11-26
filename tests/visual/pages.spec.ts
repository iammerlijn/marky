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

test('app: markdown source button', async ({ page }) => {
  await page.goto('/dev/app.html')
  await page.waitForSelector('body[data-ready]')
  const button = page.getByRole('button', { name: 'Markdown source' })
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#raw')).toBeVisible()
  // The source view is set for each tab.
  await page.locator('.tab-name').nth(1).click()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('#raw')).toBeHidden()
  await page.locator('.tab-name').first().click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('#editor')).toBeVisible()
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
        // Mermaid loads only when a diagram is visible: wait for the diagrams in view after the scroll.
        for (const diagram of await page.locator('.mermaid-diagram').all()) {
          const inView = await diagram.evaluate((el) => {
            const box = el.getBoundingClientRect()
            return box.bottom > 0 && box.top < window.innerHeight
          })
          if (inView) await diagram.locator('svg').waitFor()
        }
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

// A theme from the settings overrides the system theme. The pages look the same as with that
// system theme, so the tests use the same images.
for (const [system, theme] of [['dark', 'light'], ['light', 'dark']] as const) {
  test.describe(`${theme} theme on a ${system} system`, () => {
    test.use({ colorScheme: system })

    test('document: sample', async ({ page }) => {
      await page.goto(`/dev/preview.html?theme=${theme}`)
      await ready(page)
      await expect(page).toHaveScreenshot(`sample-${theme}.png`, { fullPage: true })
    })

    test('app: tabs', async ({ page }) => {
      await page.goto(`/dev/app.html?state=tabs&theme=${theme}`)
      await page.waitForSelector('body[data-ready]')
      await page.evaluate(() => document.fonts.ready)
      await expect(page).toHaveScreenshot(`app-tabs-${theme}.png`)
    })

    // A change of the theme also draws the Mermaid diagrams again.
    test('document: sample, theme changed after the diagrams', async ({ page }) => {
      await page.goto('/dev/preview.html')
      await ready(page)
      const diagram = page.locator('.mermaid-diagram svg')
      await diagram.evaluate((svg) => svg.setAttribute('data-old', ''))
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme)
      await expect(page.locator('.mermaid-diagram svg:not([data-old])')).toBeAttached()
      await page.evaluate(() => window.scrollTo(0, 0))
      await expect(page).toHaveScreenshot(`sample-${theme}.png`, { fullPage: true })
    })
  })
}

// The settings window: macOS has "Warn Before Quitting", Linux has the About section. The
// viewport is the size of the window (show_settings in src-tauri/src/lib.rs). The open theme menu
// must fit in the window.
for (const [os, height] of [['mac', 192], ['linux', 226]] as const) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`settings: ${os}, ${colorScheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await page.setViewportSize({ width: 480, height })
      await page.goto(`/dev/settings.html?os=${os}`)
      await page.waitForSelector('body[data-ready]')
      await expect(page.getByRole('button', { name: 'Appearance System' })).toBeVisible()
      expect(await page.evaluate(() => document.body.offsetHeight)).toBe(height)
      await expect(page).toHaveScreenshot(`settings-${os}-${colorScheme}.png`)
      await page.getByRole('button', { name: 'Appearance System' }).click()
      const menu = await page.getByRole('listbox').boundingBox()
      expect(menu!.y + menu!.height).toBeLessThanOrEqual(height)
      await expect(page).toHaveScreenshot(`settings-${os}-${colorScheme}-menu.png`)
    })
  }
}

test('settings: a choice in the theme menu changes the theme at once', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/dev/settings.html')
  await page.waitForSelector('body[data-ready]')
  await page.getByRole('button', { name: 'Appearance System' }).click()
  await page.getByRole('option', { name: 'Dark' }).click()
  await expect(page.getByRole('listbox')).toBeHidden()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Appearance Dark' })).toBeFocused()

  // The keyboard: open, move up, choose.
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option', { name: 'Dark' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')

  // Escape and a click outside close the menu without a change.
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toBeHidden()
  await page.keyboard.press(' ')
  await page.mouse.click(10, 180)
  await expect(page.getByRole('listbox')).toBeHidden()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme')
})
