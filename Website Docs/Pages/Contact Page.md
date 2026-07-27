# Contact Page

**Source**: `_input/{lang}/contact.html` · **URL**: `/{lang}/contact/` · **Layout**: `default.html`

Narrow single column (`.contact-page`, max-width 480 px, [[pages.css]]) with:

1. **Contact form** — name / email / message, minimal underline-style inputs. A **Netlify Form** (`data-netlify="true"`, `name="contact"`).
2. Divider, then **newsletter form** — single email field + ↗ button, also a Netlify form (`name="newsletter"`).
3. **Social links** — Facebook / Instagram / YouTube.

Both forms post to `/{lang}/contact/success/` — served by `_input/{lang}/contact-success.html` (a simple thank-you page, `.page-success` in [[pages.css]], strings from `languages.js`).

## Issues

- The social links are **placeholders** (`https://www.facebook.com/` etc.) — real profile URLs still need to be filled in.

Related: [[Home]], [[Build & Deploy]]
