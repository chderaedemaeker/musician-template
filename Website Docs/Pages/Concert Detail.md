# Concert Detail

**Source**: `_input/en/concerts/*.md` (front-matter `layout: concert.html`) · **URL**: `/en/concerts/{date-slug}/` · **Template**: `_includes/concert.html` (standalone shell)

One page per concert. Shows:

- Date via the `concertDate` filter: month-only → "September 2026"; with `date_end` → "12 – 16 August 2026"; otherwise weekday + full date (time dropped if midnight)
- `title` as `h1`, then a meta block: `place`, *composers* (italic), "With {collaborators}"
- Markdown body (optional "Additional information" in the CMS)
- **Tickets & Info** button if `link` is set
- Back-to-overview button → [[Concerts Page]]

Styled by `.concert-detail` in [[pages.css]].

## Notes

- Detail pages only exist under `/en/…`; the listing pages of all languages link to them ([[Languages & i18n]]).
- `_input/fr/concerts/` holds stale copies that render orphan pages — nothing links to them.
- Fields and slug format are defined in the CMS config — [[Content & CMS]].

Related: [[Templates & Includes]]
