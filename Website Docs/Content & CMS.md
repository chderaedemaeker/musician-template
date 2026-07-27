# Content & CMS

Content is markdown with front-matter, editable through **Decap CMS** at `/admin/` (`_input/admin/config.yml`, passthrough-copied to the site). Backend: `git-gateway` on branch `master`, via Netlify Identity (the identity widget is loaded on every page and redirects to `/admin/` after login). `local_backend: true` allows local editing through `npx decap-server` (part of `npm start`).

Media: uploads go to `_input/images` and are served from `/images` (then optimized at build time — see [[Templates & Includes]]).

## Collections

### Concerts — `_input/en/concerts/*.md`
English-only source of truth (see [[Languages & i18n]]). Slug: `{{year}}-{{month}}-{{day}}-{{slug}}`.
Fields: `title`, `date` (datetime — leave time at 00:00 for "no specific hour", it's hidden on the site), `date_end` (optional, multi-day concerts → "12 – 16 August 2026"), `month_only` (boolean — only month+year known → "August 2026"; set the date to any day in that month), `place`, `composers`, `collaborators`, `link` (tickets URL), body markdown.
Rendered by [[Concerts Page]] (listing + popup, client-side) and [[Concert Detail]].

### Projects — `_input/projects/{en,nl,fr,de}/*.md`
CMS i18n `multiple_folders`. Fields: `title`, `collaborators`, `image` (required), body.
Rendered by [[Projects Page]], [[Project Detail]], and the grid on [[About Page]].

### Highlights — `_input/highlights/{en,nl,fr,de}/*.md`
Fields include `title`, `slug`, `date`, `type` (e.g. "Concerto"), `image`, `link` (**YouTube video ID**, embedded on the detail page), `place`, `collaborators`.
Rendered by [[Highlights Page]] and [[Highlight Detail]].

### About — `_input/about/{en,nl,fr}/about.md`
Single page per language. Front-matter includes `summaryabout` — the short bio shown on [[Home Page]]. Body is the full biography with images.

## Draft / archived status

`highlights.11tydata.js` and `projects.11tydata.js` set `permalink: false` when `status` is `draft` or `archived`, and the per-language collections in `.eleventy.js` filter those items out (`notHidden`). So a `status: draft` item disappears from both listings and URLs.

Related: [[Home]], [[Build & Deploy]]
