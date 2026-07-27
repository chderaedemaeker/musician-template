# Highlight Detail

**Source**: `_input/highlights/{lang}/*.md` (front-matter `layout: highlight.html`) · **Template**: `_includes/highlight.html` (standalone shell)

Detail page for one highlight (performance video, concerto, recital…):

1. **YouTube embed** if `link` is set — the `link` field holds a **YouTube video ID**, not a URL (`https://www.youtube.com/embed/{{ link }}` in a responsive 16:9 `.video-wrap`, [[pages.css]])
2. Featured image via `{% progressiveImage %}` if `image` is set
3. `title`, meta line (`type`, `place`, `collaborators`, `shortDate`)
4. Markdown body
5. Back-to-overview button → [[Highlights Page]]

Styled by `.detail-page` in [[pages.css]].

Related: [[Content & CMS]], [[Templates & Includes]]
