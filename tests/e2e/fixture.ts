// The file that the app opens at the start of the app tests.
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const fixture = join(tmpdir(), 'marky-e2e', 'fixture.md')

// Non-default syntax (`*` bullets, compact table), so that a block that is written again shows.
export const original = `# Fixture

First paragraph.

* star list
* two

|a|b|
|-|-|
|1|2|
`
