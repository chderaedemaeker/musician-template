# Veronique De Raedemaeker — Website Docs

Documentation vault for the website of **Veronique De Raedemaeker**, Belgian violinist based in Cologne. The site lives in the repo `chderaedemaeker/musician-template` on GitHub and is deployed on Netlify.

## Tech stack

- **Eleventy 2.0.1** static site generator — source in `_input/`, output in `_site/`
- **Decap CMS** (Netlify CMS successor) at `/admin/` for content editing — see [[Content & CMS]]
- **Netlify** hosting: forms, identity, language redirects — see [[Build & Deploy]]
- **@11ty/eleventy-img** for the progressive image pipeline — see [[Templates & Includes]]
- Four languages (EN/NL/FR/DE) — see [[Languages & i18n]]

## Site map (per language, `/{lang}/…`)

| URL | Note |
|---|---|
| `/{lang}/` | [[Home Page]] |
| `/{lang}/about/` | [[About Page]] |
| `/{lang}/concerts/` | [[Concerts Page]] → [[Concert Detail]] |
| `/{lang}/highlights/` | [[Highlights Page]] → [[Highlight Detail]] |
| `/{lang}/projects/` | [[Projects Page]] → [[Project Detail]] |
| `/{lang}/contact/` | [[Contact Page]] |
| `/404.html` | [[404 Page]] |

Navigation (in `_data/navigation.js`) links About, Concerts, Highlights, Contact. **Projects is not in the nav** — project pages are reached via the grid at the bottom of [[About Page]].

## Styling

All CSS is hand-written, split by concern into 12 files in `_input/css/` and loaded via `_includes/css.liquid`. Start at [[CSS Overview]].

## Working on the site

```bash
npm install
npm start        # decap-server + eleventy --serve --watch
npm run build    # eleventy → _site/
```

## Known quirks

- Social links on [[Contact Page]] are placeholder URLs (bare facebook.com etc.) — needs real profile URLs
- German about/highlights/projects content falls back to English until written in the CMS
- Swiper JS/CSS is loaded by the home layout but never initialized — vestigial
- [[style.css]] is a documentation stub, not loaded by the site

See [[To do list]] for status of the 2026-07 improvement round (languages, image speed, typography, concert popup…).
