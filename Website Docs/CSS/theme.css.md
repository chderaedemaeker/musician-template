# theme.css

**Role**: "CMS Design Settings" override slot — intentionally loaded **last** in `css.liquid` so anything set here wins the cascade. Currently nearly empty (6 lines):

- `:root { --overlay-gradient: ; }` — an empty placeholder token, presumably meant to override the card gradient in [[cards.css]] someday

(The unused render-blocking EB Garamond Google-Fonts import was removed 2026-07 — the serif stack uses the self-hosted AGL font from [[base.css]].)

See [[CSS Overview]].
