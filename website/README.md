# NearBuyGoods — landing page (`/website`)

The marketing site for the NearBuyGoods mobile apps: hero + phone mockups, feature
grid, alternating benefits, a screen-by-screen slider, counters, reviews, pricing,
FAQ and a download section. It shares the **same design tokens as the app**
(`public/css/app.css`) so the landing page, the PWA and the Android shell read as
one product — but the layout and animation language follow the Appzen-style app
landing page the brief asked for.

No build step, no frameworks, no CDN calls: hand-written HTML, one CSS file and
one small vanilla-JS file. Everything (fonts included — system stacks only) is
served from this repository, so the page works offline, behind a strict CSP and
on a 3G phone.

## Preview it

```bash
node server.js          # from the repo root
# → http://localhost:3000/website
```

The same URL works on any deployment of this repo (Vercel included) because
`server.js` serves this folder at `/website` next to the PWA — see
[`docs/WEBSITE.md`](../docs/WEBSITE.md) for the hosting details.
`website/index.html` on its own (opened from disk) will render the markup but
without the stylesheet, because asset paths are absolute (`/website/assets/…`).

## Layout

```
website/
  index.html                  single page, inline SVG sprite for the brand + icons
  robots.txt
  assets/
    css/landing.css           tokens, sections, phone mockups, animations, breakpoints
    js/landing.js             preloader, reveal-on-scroll, counters, sliders,
                              accordion, scroll-spy, parallax, reduce-motion toggle
    img/
      favicon.svg             rounded navy tile + white pin (vector)
      mark.svg                standalone brand mark (navy pin)
      favicon-32.png          raster fallbacks + iOS touch icon
      favicon-192.png
      apple-touch-icon.png
      og-image.png            1200×630 social card
  tools/
    make-site-assets.mjs      regenerates the PNGs above (dependency-free)
```

## Regenerate the raster assets

```bash
node website/tools/make-site-assets.mjs
```

It reuses the exact drawing routines that produce the PWA icons
(`tools/make-icons.js`), so the favicons, the Android launcher icon and the app
icon in the PWA are all the same artwork. `npm run icons` still regenerates the
PWA icons only.

## Editing notes

- **The app is pre-launch, so the page only sells the phone app.** NearBuyGoods
  goes out through the App Store and Google Play and neither listing is live yet.
  Keep the store badges at `href="#"` (with their `Soon` tags) until launch day,
  and keep every other CTA pointed at the on-page `#download` section. Do **not**
  add `/#/…` deep links into the app, "open the web app" buttons, PWA copy or
  APK download links back in — that is the whole point of the current state.
- **Android build** — `website/download/nearbuygoods.apk` is still refreshed by
  `npm run site:apk` for QA, but the page no longer links it: the app ships
  through the stores, not as a sideload.
- **The header collapses to brand + burger at ≤1080 px** (nav and the desktop CTA
  move into the drawer). `landing.js` and the `max-width: 1080px` block in
  `landing.css` are keyed to the same breakpoint — change both together.
- **Social/SEO URLs** are absolute in `index.html` (`canonical`, `og:url`,
  `og:image`, JSON-LD). If the site moves to another domain, update those five
  URLs.
- **Pricing** mirrors `lib/paystack.js` (`PLANS`). Change prices there and here.
- **Demo numbers** (33 endpoints, 74 offers, 28 products, 8 stores, 4.3 average
  of 10 demo reviews) are real values read out of the repo/seed data — keep them
  honest if the dataset changes.
- **Reviews** are labelled in the page as the bundled demo dataset, not customer
  claims.

## Accessibility & motion

44 px touch targets, visible focus rings, skip link, `aria-expanded` on the menu
and accordion, `aria-current` on sliders, semantic landmarks, and the app's own
"reduce motion" behaviour: `prefers-reduced-motion` is honoured automatically and
the footer toggle stores the preference in `localStorage`
(`nbg_reduce_motion`) — the same key the PWA uses.
