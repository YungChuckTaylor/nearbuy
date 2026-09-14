# NearBuyGoods — Feature Engineering Research

How each of the 21 feature categories from the product brief is built: what ships in this
MVP today, and the production-grade path for each (vendors, APIs, patterns, costs).
Researched 2026-09-14.

---

## 0. Platform strategy (cross-cutting)

**Decision: API-first web service + installable PWA, wrapped later with Capacitor.**
The web app is the source of truth; native iOS/Android shells reuse the same REST API and
the same UI code inside a WebView, adding native plugins only where the browser falls short
(camera performance, background push, biometrics). This is the industry-standard path for
PWA→native: build production web assets, `npx cap init`, `npx cap add ios/android`,
`npx cap sync`, then wire native plugins where needed ([Capgo: Transform your PWA to a native app](https://capgo.app/blog/transform-pwa-to-native-app-with-capacitor/), [pkglog Capacitor guide](https://pkglog.com/en/blog/capacitor-hybrid-app-guide/)).
Details in `docs/ARCHITECTURE.md`.

Supporting choices made in this repo:

| Concern | MVP (this repo) | Production path |
|---|---|---|
| Backend | Zero-dependency Node 18+ HTTP server, JSON document store | Node (Fastify/Nest) or keep this server behind a proxy; Postgres + PostGIS |
| Auth | scrypt password hash + HMAC-SHA256 JWT (30-day expiry) | Same JWT contract; add OAuth2/OIDC (Google/Apple), OTP via Termii/Twilio, WebAuthn/biometrics via Capacitor plugin |
| Geo | Haversine radius filter, geohash field stored on writes | PostGIS `ST_DWithin(geography)` or geohash prefix + Haversine re-filter ([geohash pattern](https://medium.com/@krthiak/geohashing-66dfc72e5062), [PostGIS example](https://www.reddit.com/r/SQL/comments/191iug6/)) |
| Maps | Offline SVG schematic map (zero deps) + Google Maps deep links | Mapbox/Google Maps SDK in native shell; keep SVG map as offline fallback |
| Vision | Client signal extraction (color quantization, filename/OCR tokens, BarcodeDetector) + server catalog matching | Google Vision Product Search / Clarifai / self-hosted CLIP+Qdrant (see §2) |
| Payments | Simulated reservations + wallet hooks | Paystack (NG-first, best DX) with Flutterwave fallback ([gateway comparison](https://smartsmssolutions.com/resources/blog/ng/ng03-s02-payment-gates?highlight=WyJteW50biJd)) |
| Push | In-app notification center + foreground Web Notifications | Web Push (VAPID) on web; FCM/APNs via Capacitor Push Notifications plugin |

---

## 1. User Management & Authentication

**MVP shipped:** email+password register/login (scrypt, salted), JWT sessions, roles
(`shopper`, `store_owner`, `admin`), preference store (radius, units, currency, notification
and accessibility prefs), guest mode, demo OTP request endpoint.

**Production build-out:**
- **Social login / SSO:** OIDC providers — Google Identity Services, Sign in with Apple (required by App Store review when other social logins exist), Facebook, X. Use `passport.js`/`@fastify/oauth2` or Auth.js; Apple needs a services ID + key from the developer portal.
- **Phone OTP:** Nigeria-friendly providers: Termii, Africa's Talking, Twilio. Verify server-side with short TTL + attempt limits (endpoint rate-limited here: 5/min).
- **Passwordless magic links:** signed single-use URL tokens (same HMAC infra as JWT).
- **Biometrics:** on web, WebAuthn/passkeys (`navigator.credentials`); in the native shell, `@capacitor/biometrics` (Face ID/Touch ID/fingerprint) unlocking a refresh token from the Keychain/Keystore.
- **2FA:** TOTP (otpauth URI → Google Authenticator) or SMS OTP as second factor; store recovery codes.
- **Age verification:** gate regulated categories (pharmacy presets) with a DOB check + store-side ID policy note; full KYC only where law requires.

## 2. Item Upload & Recognition (core feature)

**MVP shipped:** camera capture sheet (rear-camera `getUserMedia`), gallery upload with
client-side downscale/compress, dominant-color extraction via canvas quantization,
`BarcodeDetector` barcode/QR decode where supported (Chrome/Android), URL & voice & text
inputs, server-side recognition scoring (barcode exact → 0.95; token overlap; color distance;
category/brand hints) returning ranked candidates with confidence + `matched_on` evidence,
refine & re-run loop, deep-link into offers.

**Production build-out (ranked options, Dec 2025/2026 landscape):**
1. **Google Cloud Vision Product Search** — managed catalog similarity: upload your product
   catalog as `Product`/`ProductSet`/`ReferenceImage`, query with user photos; ~$3.50/1k
   queries plus label/OCR costs (~$1.50/1k). Best fit because NearBuyGoods *is* a catalog
   matcher; integrates with Google Shopping ([tutorial/architecture](https://www.devopsschool.com/tutorials/google-cloud-vision-api-product-search-tutorial-architecture-pricing-use-cases-and-hands-on-guide-for-industry-solutions/)).
2. **Clarifai** — custom models + strong dev tooling when you need domain-specific classes
   (local fabrics, NAFDAC labels); free community tier, paid from ~$30/mo ([2026 API comparison](https://www.techno-pulse.com/2026/05/blog-post.html)).
3. **Self-hosted CLIP embeddings + Qdrant/FAISS** — lowest marginal cost at scale, full
   control, enables cross-modal "search by text or image" ([visual search API ranking](https://mixpeek.com/curated-lists/best-visual-search-apis)).
4. **On-device first pass:** TensorFlow.js MobileNet/Cloud Vision lite in the PWA and
   CoreML/MLKit in native shells for <200 ms "did you mean" before cloud round-trip.
- **OCR on packaging:** Vision `TEXT_DETECTION` or ML Kit Text Recognition; feed tokens into the same matcher used by the MVP.
- **Video search:** extract key frames server-side (ffmpeg `select=gt(scene,0.3)`) and run frame-level recognition — mirrors the brief's "auto-frame extraction".
- **Multi-item detection:** object-detection model (Vertex AI / Rekognition boxes) then per-box recognition.
- **Barcode:** web uses BarcodeDetector with `@zxing/library` fallback (Firefox/Safari lack the API) ([barcode in JS](https://theproductguy.in/blogs/barcode-reader-javascript/), [zxing-js/browser](https://github.com/zxing-js/browser)); native uses ML Kit Barcode — the MVP's `detectBarcode()` is the swap point.

## 3. Store Discovery & Matching

**MVP shipped:** GPS with graceful fallback, manual city default (Lagos), radius preference,
Haversine distance on every offer/store, open/closed computed from per-weekday hours +
timezone offset, list⇄schematic-map views with price pins & radius ring, sort (best value /
distance / price / rating), filters (stock, open now, delivery, rating, max price, category),
store profiles with hours table, payments, accessibility, verified badge, directions via
Google Maps deep link, inventory with stock badges & updated timestamps.

**Production build-out:**
- **Spatial index:** PostGIS `GEOGRAPHY` column + GiST index, `ST_DWithin(..., radius_m)`;
  or geohash column + prefix query + exact Haversine re-filter (rectangular-cell false
  positives must be filtered) ([geohashing trade-offs](https://medium.com/@krthiak/geohashing-66dfc72e5062)).
- **Real maps:** Mapbox GL (custom styling, offline packs) or Google Maps Platform (Street
  View, Places details); clustering via supercluster; travel times via Distance Matrix API.
- **Geofencing & proximity alerts:** native geofence APIs (CoreLocation /
  Play Services) through Capacitor plugin; web equivalent = periodic background sync +
  server-side radius checks to avoid battery drain.
- **Inventory truth:** POS integrations (Square, Shopify POS, Clover, Lightspeed, Toast)
  polling/webhooks; MVP's `updated_at` + "call to confirm" is the honest fallback.

## 4. Price Comparison & Deals

**MVP shipped:** cross-store offer table sorted by price with best-deal/closest badges,
price history per offer (8-week seeded series + live points on owner edits), savings
calculation, deal cards with radius-targeted notifications, watchlist price-drop &
back-in-stock alerts.

**Production build-out:** price-history time series in Postgres (`offer_price_points`
hypertable via TimescaleDB); tax estimation per LGA/jurisdiction table; total-cost
calculator = price + estimated transport (Distance Matrix fare heuristics); coupon
aggregation via store-submitted codes + affiliate feeds; "wait or buy" prediction from
seasonality + history (simple exponential smoothing first, gradient-boosted later).

## 5. Social & Community

**MVP shipped:** store & product reviews with star ratings, owner responses, helpful votes,
verified-style attribution, share via Web Share API/clipboard, referral-ready points.

**Production build-out:** photo/video reviews (object storage + CDN), review fraud
detection (device graph + text similarity), AI pros/cons summaries (LLM batch over review
clusters), forums/Q&A (threaded comments), collaborative lists (CRDT or last-write-wins
with presence), follow graphs (edge table + feed fan-out on write for <1k followers,
on read beyond).

## 6. Store Owner / Business Dashboard

**MVP shipped:** multi-store switcher, KPI cards (views, matches, clicks, reservations,
attributed revenue, conversion), 7-day sparklines, top products, inventory CRUD with live
price/stock edits that trigger watcher alerts, deal publishing with radius push,
reservation queue (pending → ready → completed/cancelled) with shopper notifications,
new-store registration (verification-pending).

**Production build-out:** CSV/Excel bulk import (streaming parser), POS/IMS/ERP connectors
as queued workers with idempotent upserts, staff accounts with RBAC scopes, A/B promo
testing via feature-flag service, heatmap tiles from anonymized search origins (H3 hexes),
report exports (Parquet/CSV via background job).

## 7. Advanced Search & Discovery

**MVP shipped:** text search with token matching across name/brand/tags/category, voice
search (Web Speech API), barcode/URL/photo entry points, category & brand browsing,
trending searches, search history via trending counters, saved collections, filter sheet,
"best value" relevance sort (price + travel-distance proxy).

**Production build-out:** OpenSearch/Typesense for typo tolerance, faceting, synonyms and
vector hybrid search (embeddings for "red party sneakers"); query understanding layer
(spellcheck → category intent → attribute extraction); personalization = session-based
co-occurrence ("people who searched X also bought Y") upgrading to two-tower retriever.

## 8. Notifications & Alerts

**MVP shipped:** server-side notification center (price drop, back-in-stock, deal-in-radius,
reservation status, review replies, badges), unread badges, read/all-read, deep links,
per-category prefs, foreground Web Notifications opt-in, 45 s poll while app open.

**Production build-out:** Web Push with VAPID keys (service worker `push` event) for
browser; FCM HTTP v1 for Android/Capacitor, APNs for iOS; SMS via Termii/Twilio for
transactional reservation codes; email digests via transactional provider (Resend/SES);
quiet hours & frequency capping enforced in a notification-dispatcher service; proximity
alerts via native geofence events.

## 9. Payments & Transactions

**MVP shipped:** reservation holds with stock deduction & restore-on-cancel, digital receipt
data (code, store, items), payment-method preference stubs, subscription tier definitions.

**Production build-out:** **Paystack** as primary for Nigeria (best docs/DX, 1.5% + ₦100 cap)
with **Flutterwave** fallback for pan-African cards — both expose subscriptions endpoints
for shopper/store plans; server-side `initialize → verify` webhook flow never trusting the
client; wallets via double-entry ledger table; Apple/Google Pay through Payment Request
API (and IAP rules for digital subscriptions in native shells); crypto optional via
regulated processor only. See [Nigerian gateway comparison 2026](https://smartsmssolutions.com/resources/blog/ng/ng03-s02-payment-gates?highlight=WyJteW50biJd) and [2025 fee review](https://prowebnigeria.ng/blog/best-payment-gateways-nigeria).

## 10. Delivery & Fulfillment

**MVP shipped:** BOPIS reservation flow, pickup/curbside/delivery flags per store, hold code
with status lifecycle.

**Production build-out:** third-party dispatch APIs (DoorDash Drive, Uber Direct, local
couriers e.g. Gokada/Kwik in Lagos) behind a fulfillment-adapter interface; ETA from
Distance Matrix + courier SLA; locker partnerships via carrier API; multi-store batching =
VRP solver (start greedy, OR-Tools later).

## 11. AR Features

**MVP shipped:** none (flagged `ar_beta` in admin feature flags).

**Production build-out:** WebXR/`model-viewer` for furniture preview on web (USDZ/GLB
assets); native: ARKit/ARQuickLook (iOS) and Sceneform/ARCore (Android) via Capacitor
plugins; virtual try-on = segmentation + 3D accessory anchors (Banuba/Perfect Corp SDKs);
AR wayfinding = VPS (Google Geospatial API) outdoors, IMU dead-reckoning indoors.

## 12. Accessibility & Inclusivity

**MVP shipped:** font-scale (A-/A/A+), high-contrast theme, reduce-motion mode, 44 px+ touch
targets, ARIA labels/roles on nav, switches, sheets and map pins, focus-visible rings,
semantic headings, screen-reader-friendly badges, keyboard-operable map pins.

**Production build-out:** WCAG 2.1 AA audit cycle (axe-core in CI), VoiceOver/TalkBack test
matrix, RTL layout pass with logical CSS properties, 20-locale i18n (ICU message format,
per-locale plural rules), simplified "easy mode" UI variant, haptics via Capacitor Haptics
plugin, captions on all video (WebVTT).

## 13. Security & Privacy

**MMP shipped:** scrypt hashing, signed JWTs, per-IP rate limits on auth, CORS scoped to API,
security headers (CSP, nosniff), input validation, role guards, GDPR export & delete flows,
guest mode, privacy prefs.

**Production build-out:** TLS everywhere + HSTS, AES-256 at rest (RDS/LUKS), OAuth2/JWT with
short-lived access + rotating refresh, WAF/DDoS (Cloudflare), dependency & container
scanning in CI, pen-test cadence, SOC 2 track; privacy: NDPA (Nigeria) + GDPR/CCPA
datasubject workflows, cookie consent, per-purpose location permission (while-using vs
always), moderation: vision-model NSFW/counterfeit screening + human queue (MVP flag queue
exists in admin).

## 14. Performance & Technical

**MVP shipped:** PWA (manifest + service worker: precached shell, network-first API with
cache fallback), offline banners with cached GETs, lazy image-free emoji tiles (tiny
payloads), debounced search, pagination, zero-dependency bundle (<120 KB total JS).

**Production build-out:** CDN (Cloudflare) in front of API + assets, HTTP/3, Brotli, image
pipeline (AVIF/WebP + srcset), route-level code splitting when bundling is introduced,
background sync queue for offline writes, battery-safe location (significant-change API),
app-size budget <50 MB native via WebView asset packs, SLO: recognition p95 <2 s (cache
embeddings, pre-warm catalog index).

## 15. User-Facing Analytics

**MVP shipped:** points/badges gamification, savings delta on watchlist ("▼ ₦X since save"),
search/reservation counters.

**Production build-out:** personal dashboard (spend by category from receipts, savings vs
radius median price, carbon delta local-vs-ship via distance × mode factors), year-in-review
generated job, budget tools with envelope categories.

## 16. Gamification

**MVP shipped:** points (search +2, recognize +3, save +5, reserve +10, review +20), badge
engine with unlock notifications, welcome credits.

**Production build-out:** streaks, challenges, leaderboards (Redis sorted sets), seasonal
scavenger hunts (geofenced check-ins), store loyalty stamps (QR-verified), anti-abuse
(velocity limits, device fingerprint).

## 17. Customer Support

**MVP shipped:** in-app docs links, API docs page, feedback via reviews/flags.

**Production build-out:** help center (knowledge-base CMS), AI chatbot with human handoff
(RAG over help articles), ticketing (Zendesk/Freshdesk API), CSAT/NPS prompts post-
reservation, screenshot-annotated bug reports (Shake/Instabug SDKs).

## 18. Admin & Moderation

**MVP shipped:** platform stats, health probe, top searches, moderation flag queue
(resolve/dismiss), feature flags (`ar_beta`, `group_shopping`, `ai_assistant`).

**Production build-out:** RBAC admin roles, audit log (append-only), A/B experiment
console, segmented push composer, taxonomy manager, API key issuance with scopes &
quotas, compliance exports.

## 19. Monetization

MVP implements the *rails*: subscription tier metadata, promoted-listing badge slots,
deal sponsorships, attributed-revenue KPI for stores. Production adds Paystack
subscription billing, ad server (targeted, frequency-capped), anonymized trend reports
(k-anonymity ≥ 5 per cell), marketplace commission on in-app transactions, white-label
tenanting (per-mall branding via host header).

## 20. Future / Stretch

Flag-gated in admin. Technical seeds: AI assistant (LLM function-calling over this API —
the OpenAPI spec at `/api/openapi.json` is the tool schema), visual lens (continuous
frame recognition), indoor mapping (IMU + floorplan ML), P2P marketplace (same offer
table with `seller_type=user`), warranty vault (receipt OCR), recipe mode (multi-item
recognition → cart assembly).

## 21. Onboarding

**MVP shipped:** 3-slide brand onboarding, permission priming (location request with
explanation, notification opt-in in profile), guest "try now" mode, demo accounts,
progressive disclosure (business/admin surfaces appear by role).

**Production build-out:** interactive first-search tutorial (coach marks), interest
selection feeding cold-start recommendations, store-owner quick-start wizard (license
upload → verification queue), localized flows, welcome offer credited on first search.

---

## 22. v1.1 implementation notes (gap closure)

- **Web Push, zero dependencies (`lib/webpush.js`):** VAPID P-256 keys generated once and
  persisted; ES256 JWTs with DER→raw signature conversion; payload encryption follows the
  RFC 8291 two-stage HKDF chain — `ikm = HKDF(auth_secret → shared, "WebPush: info‖ua‖as")`,
  then `cek/nonce = HKDF(salt → ikm, "Content-Encoding: aes128gcm|nonce‖")` — with the
  server public key carried in the aes128gcm `keyid`. Delivery tries `Authorization: WebPush <jwt>`
  then the legacy `vapid t=, k=` scheme; 404/410 prunes dead subscriptions. The service worker
  renders `push` events and deep-links on `notificationclick`.
- **Paystack (`lib/paystack.js`):** amounts in **kobo**; hosted-checkout `initialize → verify`
  plus `charge.success` webhook verified with HMAC-SHA512 (`x-paystack-signature`, timing-safe).
  Without keys, `/pay/sim` serves a branded test checkout that exercises the *same* fulfilment
  path (reservation → `paid` + owner alert; subscription → `user.plan` + renewal date), so the
  loop is demonstrable today and production-ready by setting `PAYSTACK_SECRET_KEY`.
- **Geocoding under CSP:** the browser stays `connect-src 'self'`; `GET /geo/geocode` proxies
  Nominatim server-side (proper User-Agent, 3.5 s abort), re-ranks Nigeria/Lagos first, and
  falls back to an offline gazetteer of serviced cities — manual entry works fully offline.
- **History & collections schema:** `user.history[]` (q, ts, result count, cap 40, incognito
  bypass) and `collections[]` with `saved.collection_id` foreign key; deleting a collection
  returns its items to "All" rather than orphaning them.

---

### Sources consulted (key)
- Visual search vendor landscape & pricing: [Mixpeek 2026 ranking](https://mixpeek.com/curated-lists/best-visual-search-apis), [Techno-Pulse API comparison](https://www.techno-pulse.com/2026/05/blog-post.html), [GCV Product Search tutorial](https://www.devopsschool.com/tutorials/google-cloud-vision-api-product-search-tutorial-architecture-pricing-use-cases-and-hands-on-guide-for-industry-solutions/)
- PWA→native: [Capgo](https://capgo.app/blog/transform-pwa-to-native-app-with-capacitor/), [pkglog Capacitor guide](https://pkglog.com/en/blog/capacitor-hybrid-app-guide/)
- Barcode on web: [Barcode in JS](https://theproductguy.in/blogs/barcode-reader-javascript/), [zxing-js/browser](https://github.com/zxing-js/browser)
- Geospatial: [Geohashing](https://medium.com/@krthiak/geohashing-66dfc72e5062), [PostGIS vs geohash discussion](https://www.reddit.com/r/SQL/comments/191iug6/)
- Payments NG: [SmartSMS gateway review 2026](https://smartsmssolutions.com/resources/blog/ng/ng03-s02-payment-gates?highlight=WyJteW50biJd), [ProWeb Nigeria 2025](https://prowebnigeria.ng/blog/best-payment-gateways-nigeria)
