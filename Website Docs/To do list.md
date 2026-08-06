- [x] Check if languages are correctly set up: german, english and dutch (dutch primary) → German added to the browser-language redirects, the mobile switcher and the CMS locales; Dutch is now the default for unknown languages. French kept. See [[Languages & i18n]].
- [x] language should be detected based on person opening website → was already Netlify edge redirects on `/`; now covers EN/FR/DE with NL as fallback. See [[Build & Deploy]].
- [x] images load slowly, ensure the image loader is quicker and more beautiful → JPEG quality 99→82 (files several times smaller), preloading starts 600px before scroll-in (was 200px), blur-to-sharp reveal shortened from 3.5s to under 1s. See [[progressive.css]] and [[Templates & Includes]].
- [x] when hovering the images and they become bigger, the border radius breaks → the card itself is no longer scaled (Safari bug with overflow+transform); the image inside zooms instead. See [[cards.css]].
- [x] make the webiste title bigger, and all h1, H2 also much bigger → nav brand 1.3→1.7rem, h1 1.2→2.2rem, h2 1.2→1.5rem, hero 1.3→2.6rem. See [[base.css]].
- [x] fix the highlight list being too close to top in website non mobile view → `.highlights-section` gets 120px top padding on desktop; mobile reel untouched.
- [x] fix design inconsitencies → removed unused EB Garamond font import, styled the bare 404 page, fixed the broken concert-title font-size variable, contact forms now land on a real thank-you page instead of the 404.
- [x] in admin, allow a concert to go over multiple dates (12-16 august for example) → new optional "End date" field; shows as "12 – 16 August 2026" everywhere and the concert stays in Upcoming until the last day.
- [x] allow the concert to be without hour → leave the time at 00:00 in the CMS; it's hidden on the site (hint added in the CMS).
- [x] allow concerts to be without specific date (but needs month and year) → new "Month and year only" toggle; shows as "August 2026", stays upcoming until the month ends.
- [x] make title of concerts bigger → list titles now 1.7rem (a broken CSS variable had silently kept them at body size).
- [x] inser the link of the concert appear in the list → "Tickets & info ↗" link on each concert row that has one.
- [x] have the full information of the concert appear in a big popup on the website if possible → clicking a concert row opens a modal with dates, place, composers, collaborators, the full description, a tickets button, and a link to the full page. See [[Concerts Page]].

- [x] have english index on index.html → static `/index.html` now redirects by browser language with English as the default (was Dutch); Netlify edge redirects updated to match.
- [x] make a bento box with all latest update instead of long scrolling on index. all elements visible in a grid. → homepage below the hero is now a bento grid: bio, next three concerts, latest highlight (large image card), projects, contact — all visible at a glance.
- [x] make mandatory to have images of highlights → image is now a required CMS field and the editor blocks saving without one; highlights that still lack an image get a designed placeholder card (tonal gradient + large initial) instead of a broken image.
- [x] Automatically have all fields be in english (copy) if no other language has been provided → the CMS now treats English as the hub on every save: empty English fields are filled from whichever language has content, and empty fields in other languages are filled from English. Works in both directions.
- [x] Highlights filled in from veroniquederaedemaeker.com → "This isn't Silence" (full details + SoundCloud live-recording player), Vasks "Vientulais Engelis", Duo Altiler at Studio Toots, and the missing Garland CD added in en/nl/fr.
- [x] Concerts search bar, upcoming/archive switcher, and previous/next navigation on all detail pages (concerts, highlights, projects) with "back to overview" moved to the top.

## Still open / needs Veronique

- [ ] Social links on [[Contact Page]] are still placeholders (bare facebook.com / instagram.com / youtube.com) — need the real profile URLs.
- [ ] German content (about/highlights/projects) still falls back to English until it's written in the CMS.
- [ ] "Duo Altiler at Studio Toots" highlight has no date yet — set it in the CMS so it sorts correctly.