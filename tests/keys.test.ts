// @vitest-environment happy-dom
// Shortcuts use Cmd on macOS and Ctrl on Linux.
import { describe, expect, test } from 'vitest'
import { modLabel, shortcut } from '../src/app/keys'

const key = (key: string, mods: Partial<KeyboardEventInit> = {}) => new KeyboardEvent('keydown', { key, ...mods })

describe('macOS', () => {
  test('Cmd+O opens and Cmd+S saves', () => {
    expect(shortcut(key('o', { metaKey: true }), true)).toBe('open')
    expect(shortcut(key('s', { metaKey: true }), true)).toBe('save')
    expect(shortcut(key('w', { metaKey: true }), true)).toBe('close-tab')
    expect(shortcut(key('t', { metaKey: true }), true)).toBe('new-tab')
    expect(shortcut(key('n', { metaKey: true }), true)).toBe('new-window')
  })
  test('Ctrl+O, Ctrl+S, Ctrl+T and Ctrl+N do nothing', () => {
    expect(shortcut(key('t', { ctrlKey: true }), true)).toBeNull()
    expect(shortcut(key('n', { ctrlKey: true }), true)).toBeNull()
    expect(shortcut(key('o', { ctrlKey: true }), true)).toBeNull()
    expect(shortcut(key('s', { ctrlKey: true }), true)).toBeNull()
  })
  test('the label is ⌘', () => expect(modLabel(true)).toBe('⌘'))
})

describe('Linux', () => {
  test('Ctrl+O opens and Ctrl+S saves', () => {
    expect(shortcut(key('o', { ctrlKey: true }), false)).toBe('open')
    expect(shortcut(key('s', { ctrlKey: true }), false)).toBe('save')
    expect(shortcut(key('w', { ctrlKey: true }), false)).toBe('close-tab')
    expect(shortcut(key('t', { ctrlKey: true }), false)).toBe('new-tab')
    expect(shortcut(key('n', { ctrlKey: true }), false)).toBe('new-window')
  })
  test('the Super key does nothing', () => {
    expect(shortcut(key('o', { metaKey: true }), false)).toBeNull()
    expect(shortcut(key('s', { metaKey: true }), false)).toBeNull()
  })
  test('the label is Ctrl', () => expect(modLabel(false)).toBe('Ctrl'))
})

test('Cmd+Shift+M on macOS and Ctrl+Shift+M on Linux toggle raw mode', () => {
  expect(shortcut(key('M', { metaKey: true, shiftKey: true }), true)).toBe('toggle-raw')
  expect(shortcut(key('M', { ctrlKey: true, shiftKey: true }), false)).toBe('toggle-raw')
  expect(shortcut(key('m', { ctrlKey: true }), false)).toBeNull()
})

test('Caps Lock and Shift do not matter for the letter', () => {
  expect(shortcut(key('S', { ctrlKey: true }), false)).toBe('save')
})

test('Ctrl+Alt+S is not a shortcut', () => {
  expect(shortcut(key('s', { ctrlKey: true, altKey: true }), false)).toBeNull()
})

test('Ctrl+Q quits on Linux, and the page does not handle Cmd+Q on macOS', () => {
  expect(shortcut(key('q', { ctrlKey: true }), false)).toBe('quit')
  expect(shortcut(key('q', { metaKey: true }), true)).toBeNull()
})

test('Ctrl+, opens the settings on Linux, and the page does not handle Cmd+, on macOS', () => {
  expect(shortcut(key(',', { ctrlKey: true }), false)).toBe('settings')
  expect(shortcut(key(',', { metaKey: true }), true)).toBeNull()
  expect(shortcut(key(',', { metaKey: true }), false)).toBeNull()
})
