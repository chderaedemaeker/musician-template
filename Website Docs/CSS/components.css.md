# components.css

**Role**: smaller shared components — Swiper slides, search bar, footer, and the **concert modal**.

- **Concert modal** (`.concert-modal*`) — the popup opened from [[Concerts Page]] rows: fixed overlay with dark backdrop, off-white panel (max 640 px, 85 vh scroll), ✕ close button, date/title/meta/body sections and a `.concert-modal-actions` row (tickets + full-page buttons). `body.modal-open` locks page scroll. Also `.concert-row { cursor: pointer }` and `.text-list-ticket` (the underlined "Tickets & info ↗" link in list rows).

- **Swiper** (`.swiper`, `.swiper-slide` with date/title/place styling) — for a concert carousel. **Currently dormant**: Swiper's CDN bundle is loaded by `layout.html` but no page initializes a Swiper instance; the concerts JSON is rendered as plain lists instead ([[Concerts Page]]).
- **Search** (`.search-container`) — underline-style input + button, matching the form language in [[pages.css]]. `languages.js` still carries `search_placeholder`/`search_button` strings, but no current page renders a search box — also dormant.
- **Footer** (`.footer`) — 95% wide, top `--warm-grey` border, flex row: tiny 0.7em grey copyright left, nav links right. Rendered by `footer.liquid` on every page ([[Templates & Includes]]).

See [[CSS Overview]].
