// Back and forward through the places of a window.
import { beforeEach, expect, test } from 'vitest'
import { History } from '../src/app/history'
import { LIMIT } from '../src/editor/plugins/places'

interface Place {
  tab: number
  pos: number
  scroll: number
}
const at = (tab: number, pos = 0, scroll = 0): Place => ({ tab, pos, scroll })
const open = new Set<number>()
const isOpen = (tab: number) => open.has(tab)
let history: History<Place>

beforeEach(() => {
  history = new History()
  open.clear()
  for (const tab of [1, 2, 3]) open.add(tab)
})

test('an empty history has no back and no forward', () => {
  expect(history.back(null, isOpen)).toBeNull()
  expect(history.forward(null, isOpen)).toBeNull()
})

test('back and forward follow the tab changes', () => {
  history.visit(null, at(1))
  history.visit(at(1), at(2))
  history.visit(at(2), at(3))
  expect(history.back(at(3), isOpen)).toEqual(at(2))
  expect(history.back(at(2), isOpen)).toEqual(at(1))
  expect(history.back(at(1), isOpen)).toBeNull()
  expect(history.forward(at(1), isOpen)).toEqual(at(2))
  expect(history.forward(at(2), isOpen)).toEqual(at(3))
  expect(history.forward(at(3), isOpen)).toBeNull()
})

test('a place keeps the position from just before the jump', () => {
  history.visit(null, at(1, 0, 0))
  // The user moves the cursor and scrolls in tab 1, then changes the tab.
  history.visit(at(1, 40, 300), at(2))
  expect(history.back(at(2), isOpen)).toEqual(at(1, 40, 300))
})

test('an outline jump in the same tab adds a place', () => {
  history.visit(null, at(1, 0))
  history.visit(at(1, 5, 0), at(1, 90, 800))
  expect(history.back(at(1, 90, 800), isOpen)).toEqual(at(1, 5, 0))
})

test('back keeps the place where the user is, so that forward comes back to it', () => {
  history.visit(null, at(1))
  history.visit(at(1), at(2, 0))
  expect(history.back(at(2, 70, 500), isOpen)).toEqual(at(1))
  expect(history.forward(at(1), isOpen)).toEqual(at(2, 70, 500))
})

test('a new jump after a back removes the forward places', () => {
  history.visit(null, at(1))
  history.visit(at(1), at(2))
  history.back(at(2), isOpen)
  history.visit(at(1), at(3))
  expect(history.forward(at(3), isOpen)).toBeNull()
  expect(history.back(at(3), isOpen)).toEqual(at(1))
  expect(history.back(at(1), isOpen)).toBeNull()
})

test('the places of a closed tab are skipped', () => {
  history.visit(null, at(1))
  history.visit(at(1), at(2))
  history.visit(at(2), at(3))
  open.delete(2)
  expect(history.back(at(3), isOpen)).toEqual(at(1))
  expect(history.forward(at(1), isOpen)).toEqual(at(3))
})

test('the history keeps only the newest places', () => {
  history.visit(null, at(1, 0))
  for (let i = 1; i <= LIMIT + 50; i++) history.visit(at(1, i - 1), at(1, i))
  let steps = 0
  let here = at(1, LIMIT + 50)
  for (let place; (place = history.back(here, isOpen)); here = place) steps++
  expect(steps).toBe(LIMIT - 1)
  expect(here).toEqual(at(1, 51))
})

test('when all earlier tabs are closed, back does nothing and the place stays', () => {
  history.visit(null, at(1))
  history.visit(at(1), at(2))
  open.delete(1)
  expect(history.back(at(2), isOpen)).toBeNull()
  open.add(1)
  expect(history.back(at(2), isOpen)).toEqual(at(1))
})
