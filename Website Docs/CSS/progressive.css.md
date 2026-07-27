# progressive.css

**Role**: visual states for the progressive image loading pipeline (markup from `{% progressiveImage %}` + the loader script — see [[Templates & Includes]]). (48 lines)

## The three states of `img.prog-img`

1. **Initial**: invisible (`opacity: 0`), blurred 10 px, desaturated 40%, scaled 1.05 (pushes blurred edges outside the clipping wrapper)
2. **`.prog-reveal`** (added when scrolled into view): fades in the tiny base64 placeholder — 0.8 s opacity ease
3. **`.prog-loaded`** (full JPEG decoded): blur/saturation/scale ease back to normal over 0.9 s — the crisp image "develops" into place

(Timings shortened from 3.5 s/1.3 s in 2026-07 — combined with quality 82 files and the 600 px preload margin, images now appear far faster.)

## `.prog-img-wrap`

The wrapper div: `overflow: hidden`, off-white `#f5f4f0` background while loading, and an `::after` **texture overlay** — `/images/Texture.jpg` tiled at 600 px with `mix-blend-mode: overlay` over every progressive image (z-index 1, pointer-events none). This gives all photos on the site their subtle paper-grain look.

Used wherever `{% progressiveImage %}` or the markdown image transform runs: home hero ([[hero.css]]), detail featured images, about portrait.

See [[CSS Overview]].
