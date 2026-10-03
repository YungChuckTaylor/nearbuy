# Serving the landing page (`/website`)

The marketing site lives in [`website/`](../website) and is published **by the same
deployment as the app**, at `/website`. Nothing extra to configure: no second
Vercel project, no separate domain, no build step.

```
   https://<your-deployment>/            → the PWA / web app   (public/)
   https://<your-deployment>/website     → the landing page    (website/)
   https://<your-deployment>/api/docs    → the API reference
```

## How the routing works

`vercel.json` already rewrites **every** path to the serverless function
(`/:path*` → `/api/handler`), and `server.js` decides what to do with it. The
static-file block was extended so that:

| Request | Served from |
|---|---|
| `/…` (anything except `/website…`) | `public/` — unchanged PWA behaviour |
| `/website` and `/website/` | `website/index.html` |
| `/website/assets/…` | `website/assets/…` |
| `/website/download/nearbuygoods.apk` | the APK shipped inside `website/download/` (`npm run site:apk` copies the newest `android/*.apk` there) |
| unknown `/website/…` | a real 404 page (not the app shell) |

Because the mapping is inside `server.js`, `node server.js` behaves identically to
the deployed function — you can develop the landing page locally:

```bash
node server.js
# → http://localhost:3000/website
```

### Function bundle

The serverless function reads `website/` from disk at runtime (the tracer cannot
see dynamic `fs.readFile` paths), so `vercel.json` lists it in `includeFiles`
alongside `docs/**` and `seed/**`:

```json
"includeFiles": "{docs/**,seed/**,website/**}"
```

Without that line the function route would 404 even though the folder exists in
the repo.

### If Vercel serves the folder itself

On some project settings Vercel's filesystem pass answers before the rewrite does.
That is fine: `website/index.html` is a plain file at the repo root, its asset
paths are absolute (`/website/assets/…`), and `/website` still resolves — either
straight from the CDN (faster) or through the function (identical HTML). Both
routes were exercised locally; nothing breaks if Vercel short-circuits the
function.

## Content Security Policy

Landing pages get their own CSP header, computed per response:

```
default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
script-src 'self' 'sha256-…'; connect-src 'self'; manifest-src 'self';
media-src 'self' blob:; font-src 'self'; base-uri 'self'; form-action 'self'
```

`script-src` uses a SHA-256 hash of each inline `<script>` (the JSON-LD block)
instead of `'unsafe-inline'`, so the page needs no third-party scripts, no CDN and
no inline event handlers. If you edit the JSON-LD in `website/index.html`, the
hash is recomputed automatically on every request — nothing to maintain.

## Checking a deployment

```bash
curl -sI https://<deployment>/website | head -12          # 200 + CSP
curl -s  https://<deployment>/website | grep -c fcard     # 8 feature cards
curl -sI https://<deployment>/website/download/nearbuygoods.apk | head -3
curl -s  https://<deployment>/api/health                  # {"ok":true,…}
```

Local equivalents (plus the full interactive check) live in the PR that added the
page: 24 DOM assertions covering the preloader, reveal animations, counters,
sliders, accordion, drawer, reduce-motion toggle, sticky header and JSON-LD.

## Updating the page

- Launch state: the app isn't in the stores yet, so the page sells the phone app
  only — store badges stay at `href="#"` and no web-app, PWA or APK links belong
  on it (see the editing notes in [`website/README.md`](../website/README.md)).
- HTML/CSS/JS: edit `website/`, push, Vercel redeploys. Assets are cached for a
  day (`Cache-Control: public, max-age=86400`); HTML is always `no-cache`.
- Social card / favicons: `node website/tools/make-site-assets.mjs`.
- Domain change: update the absolute `canonical`, `og:url`, `og:image` and
  JSON-LD URLs in `website/index.html` (five lines).
