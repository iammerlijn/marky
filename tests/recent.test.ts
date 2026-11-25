// @vitest-environment happy-dom
// Recent files on the welcome screen.
import { beforeEach, expect, test } from 'vitest'
import { addRecent, folderOf, recentFiles, removeRecent, whenLabel } from '../src/app/recent'

beforeEach(() => localStorage.clear())

test('a file that opens again goes to the top, once', () => {
  addRecent('/a.md', 1)
  addRecent('/b.md', 2)
  addRecent('/a.md', 3)
  expect(recentFiles()).toEqual([
    { path: '/a.md', at: 3 },
    { path: '/b.md', at: 2 },
  ])
})

test('the list keeps the 8 last files', () => {
  for (let i = 0; i < 10; i++) addRecent(`/${i}.md`, i)
  expect(recentFiles().map((f) => f.path)).toEqual(['/9.md', '/8.md', '/7.md', '/6.md', '/5.md', '/4.md', '/3.md', '/2.md'])
})

test('a removed file is not in the list', () => {
  addRecent('/a.md')
  addRecent('/b.md')
  removeRecent('/a.md')
  expect(recentFiles().map((f) => f.path)).toEqual(['/b.md'])
})

test('invalid storage gives no files', () => {
  localStorage.setItem('marky.recent', 'not json')
  expect(recentFiles()).toEqual([])
})

test('the folder uses ~ for the home folder', () => {
  expect(folderOf('/home/ann/work/plan.md', '/home/ann')).toBe('~/work')
  expect(folderOf('/home/ann/plan.md', '/home/ann/')).toBe('~')
  expect(folderOf('/home/anna/plan.md', '/home/ann')).toBe('/home/anna')
  expect(folderOf('/plan.md', null)).toBe('/')
})

test('the date label', () => {
  const now = new Date(2026, 10, 25, 9).getTime()
  expect(whenLabel(new Date(2026, 10, 25, 1).getTime(), now)).toBe('Today')
  expect(whenLabel(new Date(2026, 10, 24, 23).getTime(), now)).toBe('Yesterday')
  expect(whenLabel(new Date(2026, 10, 12, 12).getTime(), now)).toBe('12 Nov')
})
