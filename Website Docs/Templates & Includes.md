# Templates & Includes

Everything in `_input/_includes/`. Template language is **Liquid** (also for markdown, via `markdownTemplateEngine: "liquid"`).

## Layout shells

| File | Used by | Structure |
|---|---|---|
| `layout.html` | [[Home Page]] only | Full HTML shell **without** navigation (the page includes its own transparent nav). Loads Swiper CSS/JS from CDN (currently unused) and the Netlify Identity widget. |
| `default.html` | [[Concerts Page]], [[Highlights Page]], [[Projects Page]], [[Contact Page]], [[404 Page]] | Shell with `navigation.liquid` + `<main>` + footer. |
| `concert.html` | [[Concert Detail]] | Standalone full-page template (own `<html>` shell). |
| `highlight.html` | [[Highlight Detail]] | Standalone, with YouTube embed + progressive image. |
| `project.html` | [[Project Detail]] | Standalone. |
| `about.html` | [[About Page]] | Standalone, appends a projects grid after the bio. |

The detail templates are full HTML documents rather than nesting into `default.html` — a change to `<head>`, nav, or footer wiring must be repeated in each of them (they all repeat the same lang-detection block that maps `page.url` prefix → `lang`).

## Partials

- `css.liquid` — the stylesheet manifest; defines the CSS load order ([[CSS Overview]])
- `navigation.liquid` — desktop nav + hamburger + fullscreen mobile nav + language switcher (`switchLanguage()` rewrites the URL prefix). Supports a `navTransparent` flag for the home hero.
- `footer.liquid` — copyright (year via Liquid `"now"`) + nav links again
- `progressive-loader.liquid` — inline script: IntersectionObserver (600 px rootMargin, so images start fetching well before scroll-in) that swaps `data-src`/`data-srcset` into `img.prog-img`. Observes the wrapper div, not the img — works around an iOS Safari IntersectionObserver bug with transformed elements.
- `concert-list.liquid` — the whole [[Concerts Page]] body (upcoming/archive lists, date-range logic, popup wiring), shared by all four languages
- `concert-modal.liquid` — the concert popup: date+time, title, meta, body HTML, tickets button, full-page link; `openConcertModal()`/`closeConcertModal()`
- `upcoming-concerts.liquid` — the next-3-concerts block on [[Home Page]], same effective-end/date-range logic

## Image pipeline (`.eleventy.js`)

- `{% image src, alt %}` — standard responsive `<picture>` via eleventy-img
- `{% progressiveImage src, alt %}` — builds a 20 px blurry base64 placeholder inline + full progressive JPEGs (600–3200 w, quality 82, mozjpeg) with md5-hashed filenames in `/images/optimized/`; markup is `<div class="prog-img-wrap"><img class="prog-img" …>` styled by [[progressive.css]]
- `optimizedImageUrl` filter — single 1200 w URL for `background-image` use
- `optimizeMarkdownImages` transform — rewrites plain `<img src="/images/…">` in rendered HTML (e.g. from markdown bodies) into the progressive version
- `concertsJson` shortcode — serializes the concerts collection to JSON for client-side rendering on [[Home Page]] and [[Concerts Page]]; includes `dateEnd`, `monthOnly`, `ticket` and the rendered `body` HTML (with `</` escaped for `<script>` safety) for the popup

## Date filters

`concertDate` (month-only / date-range / full aware — used on [[Concert Detail]]), `readableDate` (full, drops midnight times), `shortDate` (`d LLL y`), `machineDate`, `isoDate` — all Luxon, UTC-anchored.

Related: [[Home]], [[Content & CMS]]
