# navigation.css

**Role**: everything for `_includes/navigation.liquid` — desktop bar, hamburger, fullscreen mobile nav, transparent home variant. (137 lines)

## Default nav (`.nav`)

Sticky top bar, 95% wide, bottom `--warm-grey` border on the `--off-white` background. `.nav-inner` is a flex row: brand left, links right. The brand renders the name on **two stacked lines** (`.brand-line`, tight leading, serif 1.3rem). Active page link gets a thin underline (`.nav-links a.active`). `.lang-switcher select` is an unstyled transparent `<select>`.

## Transparent variant (`.nav-transparent`)

Used on [[Home Page]] (and the highlights reel keeps it fixed): absolutely positioned over the hero, no background/border, all text and hamburger lines white. Below 768 px it switches to `position: fixed` so it stays over the mobile reel while scrolling.

## Mobile

- `.hamburger` — three 1 px lines, hidden on desktop; shown under 768 px (the hiding of `.nav-links` lives in [[responsive.css]])
- `.mobile-nav` — fullscreen fixed overlay (`inset: 0`, white), vertical centered links in serif heading size; `.open` toggles display, JS also locks body scroll. Links animate in with staggered `animation-delay` set inline by the template — though no `@keyframes` exist, so the delays currently do nothing.

See [[CSS Overview]] · quirk: the mobile language select is missing DE ([[Languages & i18n]]).
