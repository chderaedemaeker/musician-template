# Home Page

**Source**: `_input/{lang}/index.html` · **URL**: `/{lang}/` · **Layout**: `layout.html` (the only page using it)

The landing page. Uses the transparent navigation variant (`navTransparent = true`, styled in [[navigation.css]]).

## Sections, top to bottom

1. **Fullscreen hero** (`.hero-fullscreen`, [[hero.css]]) — the portrait from `_data/site.json` (`hero_image: /images/veronique-20.jpeg`) rendered with `{% progressiveImage %}`; fills `100dvh`, nav floats transparently on top. The `.hero-content` block is currently empty.
2. **Short bio** — pulls `summaryabout` from the about collection entry for the current language, plus a "Read the full biography" button → [[About Page]].
3. **Upcoming concerts** — client-side: `{% concertsJson %}` embeds all concerts as JSON; a script filters to future dates, sorts ascending, shows the next **3** as a simple list. The whole section hides itself if none are upcoming.
4. **Latest highlight** — newest entry of the per-language highlights collection as a single `.highlight-card` ([[cards.css]]), plus a "See all highlights" button → [[Highlights Page]].
5. **Contact button** → [[Contact Page]].

## Notes

- Section spacing/typography is largely inline `style=""` using the [[base.css]] custom properties, not classes.
- `layout.html` loads Swiper CSS/JS from CDN here, but nothing on the page initializes Swiper — vestigial.
- Concert dates are localized with `toLocaleDateString('{lang}')`, so the EN-only concert data still shows localized dates ([[Languages & i18n]]).

Related: [[Home]], [[Templates & Includes]]
