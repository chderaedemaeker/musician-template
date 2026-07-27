# Highlights Page

**Source**: `_input/{lang}/highlights.html` · **URL**: `/{lang}/highlights/` · **Layout**: `default.html` (with `navTransparent: true`)

A grid of full-bleed image cards (`.highlights-grid` / `.highlight-card`, [[cards.css]]), newest first, from the per-language `highlights_{lang}` collection (falls back to English — [[Languages & i18n]]). Each card shows the image with a dark gradient overlay, the `type` label, and the title; it links to the [[Highlight Detail]] page.

## Mobile behavior — "reels"

Below 768 px the grid becomes a **fullscreen vertical snap-scroll reel**: each card is one `100dvh` slide (`scroll-snap-type: y mandatory`). This lives in [[cards.css]] under the `.highlights-section` media query; the transparent nav stays fixed above it ([[navigation.css]]).

## Notes

- Draft/archived highlights are excluded from the collection and get no URL ([[Content & CMS]]).
- Cards use a plain `<img>` here (not the progressive loader), while the [[Highlight Detail]] page uses `{% progressiveImage %}`.

Related: [[Home]]
