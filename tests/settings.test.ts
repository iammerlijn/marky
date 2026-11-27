// The changes of the settings window: after a failed save, the controls show the last saved settings.
import { expect, test } from 'vitest'
import { settingsSaver, type Settings } from '../src/app/backend'

const saved: Settings = { warnBeforeQuit: true, theme: 'system' }
const dark: Settings = { warnBeforeQuit: true, theme: 'dark' }
const light: Settings = { warnBeforeQuit: true, theme: 'light' }
const fail = () => Promise.reject(new Error('Read-only file system'))

test('a saved change shows the new settings', async () => {
  const written: Settings[] = []
  const change = settingsSaver(saved, async (settings) => written.push(settings))
  expect(await change(dark)).toBe(dark)
  expect(written).toEqual([dark])
})

test('a failed save shows the last saved settings again', async () => {
  expect(await settingsSaver(saved, fail)(dark)).toBe(saved)
})

test('two quick changes with failed saves end on the last saved settings', async () => {
  const change = settingsSaver(saved, fail)
  // Dark, then Light before the save of Dark fails.
  const results = await Promise.all([change(dark), change(light)])
  expect(results).toEqual([saved, saved])
})

test('after a saved change, a failed change goes back to that change', async () => {
  let works = true
  const change = settingsSaver(saved, async () => {
    if (!works) throw new Error('Disk full')
  })
  await change(dark)
  works = false
  expect(await change(light)).toBe(dark)
})
