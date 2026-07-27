# Languages & i18n

The site is served in **English, Dutch, French, and German** under `/{lang}/…` paths.

## How it fits together

- **EleventyI18nPlugin** (in `.eleventy.js`) with `defaultLanguage: "en"` and `errorMode: "allow-fallback"`.
- **Page sets per language**: `_input/en/`, `_input/nl/`, `_input/fr/`, `_input/de/` each contain `index.html`, `concerts.html`, `highlights.html`, `projects.html`, `contact.html` plus a `{lang}.json` (`{"lang": "en"}` etc.) that puts `page.lang` into the data cascade.
- **UI strings**: `_input/_data/languages.js` — one object per language with every label on the site (nav subtitle, button texts, form placeholders, "no upcoming concerts" messages…). Templates read `languages[page.lang].some_key`.
- **Nav labels**: `_input/_data/navigation.js` — per-language arrays of `{text, url}`.
- **Language detection at the edge**: `netlify.toml` redirects `/` → `/en`, `/fr`, `/de` based on the browser `Language` header, falling back to `/nl` — **Dutch is the primary language** (see [[Build & Deploy]]).
- **Language switcher**: a `<select>` in `_includes/navigation.liquid`; `switchLanguage()` rewrites the `/{lang}/` prefix of the current path.

## Content fallback to English

Collections for about/highlights/projects are defined **per language** in `.eleventy.js` (`highlights_nl`, `projects_fr`, …) via `collectionWithFallback()`: if the language folder has no files, the English collection is used instead.

- `_input/about/` has `en`, `fr`, `nl` — **German falls back to English**
- `_input/highlights/` and `_input/projects/` have `en`, `fr`, `nl` folders
- **Concerts are English-only by design**: one list in `_input/en/concerts/`, used for every language (dates are localized client-side with `toLocaleDateString`)

## Quirks

- `_input/fr/concerts/` contains old copies of concert markdown files. They still generate orphan detail pages but are not part of the `concerts` collection (which only globs `en/concerts`), so nothing links to them.
- German about/highlights/projects fall back to English until the content is written in the CMS (locales now include `de`).

Related: [[Home]], [[Templates & Includes]]
