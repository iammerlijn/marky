// @vitest-environment happy-dom
// The chosen theme (System, Light or Dark) on <html>, and the system theme under it.
import { afterEach, expect, test, vi } from 'vitest'
import { applyTheme, isDark, onThemeChange } from '../src/app/theme'

// A system theme that the test can change.
const system = { dark: false, listeners: new Set<() => void>() }
vi.stubGlobal('matchMedia', () => ({
  get matches() {
    return system.dark
  },
  addEventListener: (_: string, listener: () => void) => system.listeners.add(listener),
  removeEventListener: (_: string, listener: () => void) => system.listeners.delete(listener),
}))
const setSystem = (dark: boolean) => {
  system.dark = dark
  system.listeners.forEach((listener) => listener())
}

afterEach(() => {
  applyTheme('system')
  system.dark = false
})

test('System follows the system theme', () => {
  applyTheme('system')
  expect(document.documentElement.dataset.theme).toBeUndefined()
  expect(isDark()).toBe(false)
  system.dark = true
  expect(isDark()).toBe(true)
})

test('Light and Dark override the system theme', () => {
  system.dark = true
  applyTheme('light')
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(isDark()).toBe(false)
  system.dark = false
  applyTheme('dark')
  expect(isDark()).toBe(true)
})

test('a change of the chosen theme or of the system theme calls back, until stop', async () => {
  const calls = vi.fn()
  const stop = onThemeChange(calls)
  applyTheme('dark')
  // MutationObserver calls back after the current task.
  await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1))
  setSystem(true)
  expect(calls).toHaveBeenCalledTimes(2)
  stop()
  applyTheme('light')
  setSystem(false)
  await new Promise((r) => setTimeout(r, 10))
  expect(calls).toHaveBeenCalledTimes(2)
})
