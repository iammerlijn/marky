# Marky style sheet

## Color
| Token        | Light     | Dark      | Note |
|--------------|-----------|-----------|------|
| Background   | `#ffffff` | `#17181b` | |
| Surface      | `#f7f7f8` | `#1e1f23` | proposed (cards, code blocks) |
| Text         | `#2a2b2f` | `#d6d7da` | |
| Muted text   | `#6b6f76` | `#8b8e95` | dark value proposed; 5.0:1 / 5.4:1 |
| Border       | `#e6e7ea` | `#2a2c31` | dark value proposed |
| Accent       | `#5e6ad2` | `#7c85e0` | white on light accent 4.7:1 |
| Accent text on tint | `#4f5bc4` | — | keeps 4.5:1 on accent tints |
| Secondary button | `#f1f2f4` | — | no border |

## Type
Inter 400 and 600. JetBrains Mono 400 only for markdown syntax.
| Role      | Size (px) | Line height | Weight | Tracking |
|-----------|-----------|-------------|--------|----------|
| Display   | 44–72     | 1.0         | 600    | −0.03em  |
| Heading 1 | 24–30     | 1.25        | 600    | −0.01em  |
| Lead      | 20–24     | 1.4         | 400    | 0        |
| Heading 2 | 18        | 1.3         | 600    | 0        |
| Body      | 17        | 1.6         | 400    | 0        |
| Small     | 14        | 1.5         | 400    | 0        |
| Label     | 13        | 1.4         | 600    | 0        |
| Mono      | 13        | 1.85        | 400    | 0        |
Fluid sizes scale with the container width (clamp + cqi).

## Spacing
Scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 144
- Content column: 960 px; text up to 600 px
- Page padding: 24 px
- Section gap: 88 px (phone) → 144 px (desktop)

## Shape
| Radius | Use |
|--------|-----|
| 5      | kbd keys |
| 6      | tabs, chips |
| 8      | buttons |
| 10–12  | cards, windows |

Shadow (app windows only): `0 0 0 1px #e6e7ea, 0 20px 48px rgba(20,22,30,.08)`

## Buttons
44 px tall, 20 px side padding, Inter 600 at 15 px. One primary per view.

## Motion
Fades only: opacity 0 → 1, 200 ms, ease-out.
