# hero.css

**Role**: hero sections. (59 lines)

## `.hero`

Simple centered padded heading block — generic, little used.

## `.hero-fullscreen` — the [[Home Page]] hero

- Full viewport height: `100vh` fallback + `100dvh` for iOS browser chrome
- Flex container aligned to the bottom (`align-items: flex-end`) with `--space-xl` padding — content sits in the lower-left
- The image (whatever form it takes: plain `img`, `picture`, or the progressive `.prog-img-wrap` from [[progressive.css]]) is forced to cover the whole section with `position: absolute !important; inset: 0` + `object-fit: cover` — the `!important`s override eleventy-img's inline sizing
- `.hero-content` floats above at `z-index: 2`, white serif heading (currently empty in the template)

Mobile padding shrink lives in [[responsive.css]] (480 px). See [[CSS Overview]].
