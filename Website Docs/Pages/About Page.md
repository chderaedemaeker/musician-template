# About Page

**Source**: `_input/about/{lang}/about.md` (front-matter `layout: about.html`, explicit `permalink: {lang}/about/index.html`) · **Template**: `_includes/about.html` (standalone shell)

The biography page:

1. **Bio content** (`.about-page`, max-width 800 px, [[pages.css]]) — the markdown body, opening with a portrait image. Plain `<img>` tags in the markdown get upgraded to progressive loading by the `optimizeMarkdownImages` transform ([[Templates & Includes]]).
2. **Projects grid** — appended below the bio: all projects of the current language as `.highlight-card`s ([[cards.css]]). This is the main way visitors discover [[Projects Page]] content, since projects aren't in the nav.

## Front-matter worth knowing

- `summaryabout` — the short bio string that [[Home Page]] displays on the landing page. Editing the about page in the CMS updates both.
- Exists in EN/FR/NL; German falls back to English ([[Languages & i18n]]).

Related: [[Content & CMS]]
