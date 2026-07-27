# base.css

**Role**: design tokens, reset, base typography, typography utilities. Loaded first — everything else builds on its custom properties. (180 lines)

## The `:root` tokens

- **Colors**: `--white #f6f6f4`, `--off-white #f5f4f2` (body bg), `--warm-grey #e8e6e1` (borders/dividers), `--mid-grey #b5b0a8` (muted/empty states), `--dark-grey #6b665e` (meta text), `--charcoal #3a3732`, `--near-black #1a1a19` (text)
- **Fonts**: `--font-serif: 'AGL', Georgia, serif` (AGL = Apple Garamond Light, `@font-face` weight 300, src `/images/AppleGaramond-Light.ttf`); `--font-sans: 'Helvetica Neue'`
- **Type sizes**: sans sizes are all `0.9rem` (`--sans-caption/label/body`); serif `--serif-body 1.2rem`, `--serif-heading 2.2rem` (h1), `--serif-subheading 1.5rem` (h2), `--serif-hero 2.6rem`, `--serif-brand 1.7rem` (enlarged 2026-07 per the to-do list)
- **Line heights** `--leading-tight 0.95` → `--leading-relaxed 1.7`; **tracking** `--tracking-tight -0.03em` → `--tracking-wider 0.15em`
- **Spacing scale**: `--space-xs 0.5rem`, `sm 1rem`, `md 2rem`, `lg 4rem`, `xl 6rem`
- **Layout**: `--max-width 1400px`, `--content-width 600px`, `--radius 8px`
- Legacy aliases `--font-size-serif`/`--font-size-sans` kept for backward compat (still used by [[buttons.css]])

## Base rules

Universal box-sizing/margin/padding reset · `html { font-size: 16px }` · body = serif, off-white, near-black · images block-level and fluid · links inherit color, underline on hover · lists unstyled · h1–h3 all font-weight 300 (h1 at `--serif-heading`, h2 at `--serif-subheading`, h3 sized at `--sans-body`).

## Utilities

One-property classes for every token: `.sans-label`, `.serif-hero`, `.font-sans`, `.leading-snug`, `.tracking-wide`, `.color-grey`, `.uppercase`, `.weight-300`… plus `.section-title` — the small uppercase centered grey label used as a section heading across pages (0.6rem sans, 0.08em tracking).

Used by literally everything; see [[CSS Overview]] for load order.
