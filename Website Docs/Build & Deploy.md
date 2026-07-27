# Build & Deploy

Hosting is **Netlify**, configured in `netlify.toml` at the repo root.

## Build

```toml
[build]
  command = "npm install && npx @11ty/eleventy"
  publish = "_site"
```

Locally: `npm start` (decap-server + eleventy serve), `npm run build`.

Eleventy dirs: input `_input`, output `_site`, data `_data`, includes `_includes`. Passthrough copies: `admin/`, `images/`, `css/`.

## Language redirects

Browser-language detection at the edge — `/` 302s to `/en`, `/fr` or `/de` when the `Language` header matches, otherwise force-redirects to `/nl` (Dutch primary). See [[Languages & i18n]].

## Headers

- All routes: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection`, `Permissions-Policy` (camera/mic/geo off)
- `/images/optimized/*`: `max-age=31536000, immutable` — safe because filenames are content-hashed ([[Templates & Includes]])
- `/css/*`: `max-age=604800` (1 week)

## Netlify platform features in use

- **Forms**: contact + newsletter forms on [[Contact Page]] use `data-netlify="true"`; they post to `/{lang}/contact/success/`, a real thank-you page per language (`contact-success.html`)
- **Identity + git-gateway**: powers Decap CMS logins ([[Content & CMS]]); the identity widget script is loaded on every page

Related: [[Home]]
