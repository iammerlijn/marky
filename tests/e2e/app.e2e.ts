// The app in a real window: keys, the real backend and changes on disk.
// The tests run in order and share one app session. CI runs them on Linux, so the
// shortcuts use Ctrl.
import { $, $$, browser, expect } from '@wdio/globals'
import { readFileSync, writeFileSync } from 'node:fs'
import { Key, type ChainablePromiseElement } from 'webdriverio'
import { fixture, original } from './fixture'

const onDisk = () => readFileSync(fixture, 'utf8')
const editor = () => $('#editor .ProseMirror')
// WebKitWebDriver returns an empty text for some elements that show text, so read textContent.
const text = (element: ChainablePromiseElement) => element.getProperty('textContent') as Promise<string>

describe('Marky', () => {
  it('opens the file from the command line', async () => {
    await editor().$('h1').waitForExist()
    expect((await text($('.tab-name'))).trim()).toBe('fixture.md')
    expect(await text(editor().$('h1'))).toBe('Fixture')
  })

  it('saves with Ctrl+S, and only the edited block changes on disk', async () => {
    await editor().$('p=First paragraph.').click()
    await browser.keys([Key.Home])
    await browser.keys('New ')
    await browser.keys([Key.Ctrl, 's'])
    await browser.waitUntil(() => onDisk() !== original, { timeoutMsg: 'the file was not saved' })
    expect(onDisk()).toBe(original.replace('First paragraph.', 'New First paragraph.'))
  })

  it('reloads the tab when another app changes the file', async () => {
    writeFileSync(fixture, onDisk() + '\nAdded by another app.\n')
    await editor().$('p=Added by another app.').waitForExist()
  })

  it('shows the bar when the file changes on disk and the tab has unsaved edits', async () => {
    await editor().$('h1').click()
    await browser.keys([Key.End])
    await browser.keys(' mine')
    // Wait for the dirty check (250 ms) before the change on disk.
    await browser.pause(600)
    writeFileSync(fixture, '# Theirs\n')
    await $('.banner').waitForDisplayed()
    expect(onDisk()).toBe('# Theirs\n')
    await $('button=Load from disk').click()
    await browser.waitUntil(async () => (await text(editor().$('h1'))) === 'Theirs')
  })

  it('opens a new tab with Ctrl+T and closes it with Ctrl+W', async () => {
    await browser.keys([Key.Ctrl, 't'])
    await browser.waitUntil(async () => (await $$('.tab')).length === 2)
    expect((await text($$('.tab-name')[1])).trim()).toBe('Untitled')
    await browser.keys([Key.Ctrl, 'w'])
    await browser.waitUntil(async () => (await $$('.tab')).length === 1)
  })

  it('shows the markdown source with Ctrl+Shift+M, and goes back', async () => {
    await editor().click()
    await browser.keys([Key.Ctrl, Key.Shift, 'M'])
    await $('#raw .cm-content').waitForDisplayed()
    expect(await text($('#raw .cm-content'))).toContain('# Theirs')
    await browser.keys([Key.Ctrl, Key.Shift, 'M'])
    await editor().waitForDisplayed()
  })

  // Last test: it closes the app.
  it('closes the window with Ctrl+W when no tab is open', async () => {
    await browser.keys([Key.Ctrl, 'w'])
    await browser.waitUntil(async () => (await $$('.tab')).length === 0, { timeoutMsg: 'the last tab did not close' })
    // The window closes during this key action, so the driver can lose its session before the
    // action ends. The next step checks that the window is gone.
    await browser.keys([Key.Ctrl, 'w']).catch(() => {})
    // When the window is closed, each command fails.
    await browser.waitUntil(
      async () => {
        try {
          return (await browser.getWindowHandles()).length === 0
        } catch {
          return true
        }
      },
      { timeoutMsg: 'the window did not close' },
    )
  })
})
