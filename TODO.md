# To do

## Revise the open time for long files

The first target was < 300 ms to open a 5,000-line file (design document, section 9).
On 2026-11-25 the measured time was ~970 ms, so the target changed to < 1 s for 5,000 lines
and < 300 ms for 1,000 lines.

- About 355 ms is the parse and the block map. The rest is the DOM for ~1,600 blocks.
- `content-visibility: auto` on the blocks gave 740 ms, but it changes the layout: margins do
  not collapse and the collapsible arrow is clipped. The visual tests show this.
- Options: render a long document in parts, parse in a web worker, or a cheaper DOM for blocks
  that are not visible.
- Measure with `dev/bench.mjs` (see the comment in that file), also with `?lines=N`.
