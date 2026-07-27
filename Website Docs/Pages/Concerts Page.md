# Concerts Page

**Source**: `_input/{lang}/concerts.html` — now just front-matter plus `{% include "concert-list.liquid" %}` (the list markup/script lives once in `_includes/concert-list.liquid`, shared by all four languages).

Two text lists — **Upcoming Concerts** (ascending) and **Archive** (descending) — rendered **client-side**: `{% concertsJson collections.concerts %}` embeds the full concert list (incl. rendered body HTML for the popup) and the script splits it at page load.

- A concert stays in Upcoming until its **effective end**: `date_end` for multi-day concerts, end of the month for month-only entries, end of the day otherwise.
- Date display handles all three modes: "Thursday January 9, 2025", "12 – 16 August 2026", "September 2026" (localized via `toLocaleDateString`).
- Rows show date, title, place (left) and composers/collaborators (right) plus a **"Tickets & info ↗"** link when the concert has a ticket URL (`.text-list-ticket`, [[components.css]]).
- **Clicking a row opens the concert popup** (`_includes/concert-modal.liquid`): full date/time, title, meta, description body, tickets button, and a "Full page ↗" link to the [[Concert Detail]] page. Closes on ✕, backdrop click, or Escape. Styles in [[components.css]].
- Empty state shows `languages[lang].no_upcoming`.

## Notes

- Because filtering happens in the browser, "upcoming vs archive" is always correct relative to the visitor's clock — no rebuild needed as dates pass.
- Content source is English-only (`_input/en/concerts/*.md`), shared by all languages — see [[Languages & i18n]] and [[Content & CMS]].

Related: [[Home]]
