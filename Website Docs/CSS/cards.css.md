# cards.css

**Role**: the two main listing presentations — text lists and image cards — plus the mobile "reels" mode. Largest file (253 lines).

## `.text-list` — concerts & projects lists

700 px centered column of rows divided by 1 px `--warm-grey` lines. Each `.text-list-item` is a flex row: `.text-list-left` (date `.text-list-type`, `.text-list-title`, details) and `.text-list-right` (composers/collaborators or the ↗ `.text-list-arrow`). Hover fades the row (`opacity: 0.6`). Under 600 px the row stacks vertically.

Used by [[Concerts Page]] and [[Projects Page]]. `.text-list-title` is `1.7rem` (an undefined variable used to keep titles at body size; fixed 2026-07). Concert rows are now `<div class="text-list-item concert-row">` (clickable → popup) instead of one big `<a>`; the row cursor and the `.text-list-ticket` link style live in [[components.css]].

## `.highlights-grid` / `.highlight-card` — image cards

Flex-wrap grid (max 1100 px, `gap: 40px 20px`) of 4:5 image cards with 16 px radius: cover image pinned top-center, dark gradient overlay (`.highlight-card-overlay`), white sans type/title at the bottom. On hover the **inner image** zooms (`.highlight-card:hover img { scale(1.03) }`) — the card itself is never transformed, because scaling an `overflow:hidden` rounded container breaks the border-radius clipping in Safari (fixed 2026-07). Includes an `aspect-ratio` fallback (`padding-top: 125%`) for iOS ≤ 14. The odd flex values (`flex-grow: 3; flex-shrink: 0.9; flex-basis: 45%`) make cards pair up two per row and stretch to fill. `.highlights-section` carries `padding-top: 120px` on desktop so the grid clears the nav (the mobile reel resets it).

Used by [[Highlights Page]], the latest-highlight block on [[Home Page]], and the projects grid on [[About Page]].

## Mobile reels (≤ 768 px)

`.highlights-section` turns the grid into a fullscreen vertical snap-scroll reel: the section is `100dvh`, the grid becomes a `scroll-snap-type: y mandatory` scroller (scrollbars hidden, `overscroll-behavior-y: contain`), each card a full-screen borderless slide with `clamp()`-sized titles. Comment in the file warns: **no `overflow: hidden` on the outer wrapper** — it breaks touch-scroll in iOS Safari.

## `.card-grid`

An older simple stacked-links grid; effectively unused by current pages.

See [[CSS Overview]].
