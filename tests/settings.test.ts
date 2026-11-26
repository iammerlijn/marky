// A change in the settings window: the controls show the old settings when the save fails.
import { expect, test } from 'vitest'
import { saveOrKeep, type Settings } from '../src/app/backend'

const old: Settings = { warnBeforeQuit: true, theme: 'system' }
const next: Settings = { warnBeforeQuit: true, theme: 'dark' }

test('a saved change shows the new settings', async () => {
  const saved: Settings[] = []
  expect(await saveOrKeep(old, next, async (settings) => saved.push(settings))).toBe(next)
  expect(saved).toEqual([next])
})

test('a failed save shows the old settings again', async () => {
  expect(await saveOrKeep(old, next, () => Promise.reject(new Error('Read-only file system')))).toBe(old)
})
