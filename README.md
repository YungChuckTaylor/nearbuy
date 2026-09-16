# NearBuyGoods 🛍️📍

**Upload any item. Find it at stores near you. Instantly.**

Mobile-first web app + PWA with an API-first backend — the same REST service is the
foundation for the future iOS/Android apps (see `docs/ARCHITECTURE.md`).

## Quick start

```bash
node server.js          # zero dependencies — Node 18+ only
# → http://localhost:3000
```

Optional: `npm run icons` regenerates PWA icons from the brand mark.

### Previewing it properly (why opening index.html shows nothing)

`public/index.html` is only the PWA shell — the app logic is ES modules and all data
comes from the bundled REST service, so **the folder must be served by the server,
never opened as a file**:

| Where | How |
|---|---|
| Same computer | `node server.js` → open `http://localhost:3000` |
| Phone on same Wi‑Fi | `http://<computer-LAN-IP>:3000` (camera/GPS/push need HTTPS, see below) |
| Phone with full features | HTTPS tunnel: `cloudflared tunnel --url http://localhost:3000` (or ngrok/localtunnel), open the https URL it prints |
| Installed app feel | Desktop Chrome/Edge/Brave → install icon in address bar (PWA) |

Opening `public/index.html` straight from disk now shows an instruction card instead
of a blank page (`js/boot-check.js` guard).

## Demo accounts (password `demo1234`)

| Role | Email | Sees |
|---|---|---|
| Shopper | shopper@nearbuygoods.app | watchlist, alerts, reservations |
| Store owner | owner@nearbuygoods.app | business dashboard (2 Lagos stores) |
| Admin | admin@nearbuygoods.app | platform stats, moderation, feature flags |

Guest mode works for search/discovery; login unlocks saves, reservations, alerts.

## Try the core loop

1. Tap the orange **camera FAB** → take/upload a photo (or barcode / URL / voice / text).
2. The recognizer returns ranked candidates with confidence + evidence (`matched_on`).
3. Open a candidate → **cross-store price comparison**, price history, stock & open-now.
4. **Reserve** for pickup → the owner's dashboard queue updates → shopper gets an alert.
5. Owner: edit a price down or restock → watchers receive price-drop / back-in-stock alerts.

## What's inside

- **PWA**: installable manifest, service worker (offline shell + cached API fallback),
  safe-area aware UI, bottom tab bar + center camera FAB, bottom sheets, 44 px targets.
- **API**: 33 documented endpoints (`/api/docs`, `/api/openapi.json`), JWT auth, roles,
  rate limits, geo-radius search (Haversine + geohash fields), notification engine,
  gamification, business analytics, admin moderation & feature flags.
- **Docs**: `docs/RESEARCH.md` — engineering research for all 21 feature categories
  (vision vendors, payments NG, push, spatial DBs, Capacitor native path, …).

## Android app (built & shipped)

`android/` contains a **signed, installable APK** wrapping this PWA in a
dependency-free native shell (WebView on a private secure origin + native
camera/GPS/file-picker/download bridges + configurable API address):

```bash
cd android && ./build-apk.sh        # → NearBuyGoods-v*-debug.apk (no Gradle needed)
# or open android/ in Android Studio and press Run
```

Install on your phone, enter `http://<computer-ip>:3000` on first run for
Wi‑Fi testing (or your deployed `https://` URL), done. Guide, release signing,
Play checklist and the FCM push roadmap: [`docs/ANDROID.md`](docs/ANDROID.md).
Capacitor remains the alternative path for plugin-heavy native builds and iOS
(`docs/ARCHITECTURE.md` §3).

## Changelog

**v1.1-cloud — Vercel full-stack deploy**
- `api/handler.js` + `vercel.json`: the same `server.js` handler runs as a Vercel serverless function; `public/` served statically beside it.
- Storage mode for serverless: whole DB (+VAPID keys) persisted as one gzip blob in Vercel KV (free); ephemeral seed fallback without KV; local `node server.js` unchanged. Verified: KV round-trip across simulated cold starts.
- Guide: `docs/VERCEL.md` (GitHub import → KV attach → NBG_SECRET → phone connect).

**v1.1-android — native Android app**
- `android/`: installable debug-signed APK (zero-dependency WebView shell around the PWA; minSdk 24 / target 34), first-run server dialog + Profile row, camera/GPS/file-picker/Downloads bridges, adaptive icon + splash from brand assets, Gradle-free CLI build *and* AGP 8 Studio project.
- Web: `?api=` server injection persisted in config.js; wrapper-aware push/export/docs/footer; SW v1.1.2. Docs: `docs/ANDROID.md`.

**v1.1 — gap closure release**
- Manual location entry: geocoded search (Nominatim proxy + offline gazetteer), coordinate pinning, recents; brand + min/max price filters with active-count badge.
- Real Web Push: zero-dep VAPID + aes128gcm push service, SW push/click handlers, subscribe UI — alerts land with the app closed.
- Paystack checkout (test mode): reservation prepay + subscription plans on `#/premium`, branded simulator without keys, live mode via `PAYSTACK_SECRET_KEY`, signed webhooks, receipts.
- Search history (re-run, delete, clear, incognito) + named collections on the Saved page.

**v1.0 — MVP**: recognition wizard, geo discovery, price comparison, reservations,
business dashboard, admin, gamification, PWA shell, 33-endpoint API.

## Data

Demo dataset is a fictional Lagos market (Ikeja, Lekki, Yaba, Surulere, VI, Oniru,
Allen Ave). State persists in `data/db.json`; delete it to reseed.
