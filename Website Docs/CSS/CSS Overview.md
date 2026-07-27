# CSS Overview

All styling is hand-written CSS in `_input/css/`, split by concern, no preprocessor or framework. `_includes/css.liquid` is the **manifest** — it emits `<link>` tags in this exact cascade order (later files can override earlier ones):

1. [[base.css]] — design tokens (custom properties), reset, typography — 180 lines
2. [[layout.css]] — container + spacing utilities — 21 lines
3. [[navigation.css]] — nav bar, hamburger, mobile nav, transparent variant — 137 lines
4. [[hero.css]] — hero sections incl. fullscreen home hero — 59 lines
5. [[buttons.css]] — `.btn` family — 31 lines
6. [[cards.css]] — text lists + highlight cards + mobile reels — 253 lines (largest)
7. [[pages.css]] — detail/about/contact pages, forms — 174 lines
8. [[components.css]] — Swiper, search, footer — 105 lines
9. [[responsive.css]] — leftover global media queries — 32 lines
10. [[theme.css]] — CMS "Design Settings" overrides, **loaded last** — 6 lines
11. [[progressive.css]] — progressive image loading states — 48 lines

[[style.css]] is *not* loaded — it's a comment-only stub documenting the split.

## Design language

Warm off-white paper tones (`#f5f4f2` background), near-black text, thin 1 px `--warm-grey` rules as separators, light (300) serif type. Two families: **AGL** (Apple Garamond Light, self-hosted `@font-face` — the file lives at `/images/AppleGaramond-Light.ttf`) for serif, Helvetica Neue for sans labels. All colors, type sizes, spacing, and tracking are custom properties defined in [[base.css]] — pages also use them heavily in inline styles.

## Conventions & quirks

- Media-query breakpoints: **768 px** (nav collapse, mobile reels) and **600/480 px** (lists, hero padding); queries live next to their component, not centralized ([[responsive.css]] only has leftovers).
- Netlify serves `/css/*` with a 1-week cache ([[Build & Deploy]]).
