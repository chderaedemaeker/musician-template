# pages.css

**Role**: page-level containers for detail pages, about, contact, and all form styling. (174 lines)

## Containers

- `.concert-detail`, `.detail-page` — `--content-width` (600 px) centered column, `padding-top: 120px` to clear the sticky nav. Used by [[Concert Detail]], [[Highlight Detail]], [[Project Detail]].
- `.about-page` — same but 800 px wide ([[About Page]])
- `.contact-page` — 480 px, `padding-top: 150px` ([[Contact Page]])
- `.page-404` / `.page-success` — centered narrow columns with nav clearance for the [[404 Page]] and the contact thank-you pages
- Shared: light-weight serif `h1`s; `.date` / `.meta` lines in small grey sans (concert meta is italic)
- `.featured-image` — rounded, overflow hidden; `.video-wrap` — 16:9 responsive YouTube iframe box

## Forms (contact + newsletter)

Minimal underline style: transparent inputs with only a 1 px `--warm-grey` bottom border that darkens to near-black on focus; serif text, italic grey placeholders; textarea min-height 150 px. `.newsletter-form` is a flex row (input + small ↗ button). `.contact-divider` and `.contact-footer` structure the lower half of the contact page; `.socials-list` styles the social links in small grey sans.

See [[CSS Overview]].
