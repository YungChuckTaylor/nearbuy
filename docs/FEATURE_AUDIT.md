# NearBuyGoods — Feature Audit vs. Uploaded Feature List

Legend: ✓ built & testable in the MVP · ◐ partial (works in reduced form, or backend-only, or UI missing) · ✗ left out (documented production path in RESEARCH.md)

Audited line-by-line against the 21 sections of `nearbuygoods..htm`. Totals: **✓ 111 · ◐ 82 · ✗ 294** of ~487 line items.

## 1. User Management & Authentication — ✓6 ◐5 ✗12
- ✓ Search-radius preference · notification preferences · accessibility preferences (font scale, high contrast, reduce motion) · Shopper role · Store Owner role · Admin role
- ◐ Email/password registration (no verification email) · phone OTP (dev request endpoint only, no verify/UI) · profile photo/name/bio (name only) · preferred units (saved, not applied to labels) · language & currency (currency yes, language no)
- ✗ Social login (Google/Apple/Facebook/X) · SSO · biometrics · 2FA · magic links · age verification · saved home/work/custom locations · privacy visibility settings · linked payment methods · Store Employee, Brand Rep, Moderator roles

## 2. Item Upload & Recognition — ✓12 ◐8 ✗24
- ✓ In-app camera capture · library upload · free-text description · voice-to-text · #tag input · product-URL input · color detection (real canvas quantization) · similar-item suggestions · confidence score display · category auto-classification · edit/correct & re-run refinement
- ◐ Multi-image (single only) · screenshot recognition (via generic upload) · structured fields (category/brand/words only) · barcode/QR (image-based, no live viewfinder loop) · CNN recognition (signal-matching pipeline with pluggable vision API) · brand/logo detection (token-based) · exact-vs-similar toggle (UI present, not enforced server-side) · price-range refinement (max-price filter lives on search)
- ✗ 10-image multi-angle · crop/rotate/zoom · auto-enhance · drag-and-drop · bulk upload · clipboard paste · all 6 video bullets · autocomplete suggest · OCR · pattern/texture · shape/silhouette · multi-item detection · model/variant ID · food/furniture/fashion style · material detection · condition preference · quantity in refine

## 3. Store Discovery & Matching — ✓18 ◐11 ✗17
- ✓ GPS detection · map view with pins (+ radius ring) · list view with distance/price/availability · sort by distance/price/rating/relevance · in-stock, open-now, delivery, rating, category filters · stock indicators · turn-by-turn (Google Maps deep link) · store description · address · live open/closed · verified badge · tags · accessibility info · payment methods · cross-store price comparison · price history graph · best-deal/closest badges · stock timestamps · reserve/hold
- ◐ Geofenced deal alerts (server-radius notifications, not OS geofences) · sorting by availability · filter completeness (brand/store-type exist in API, not UI) · "available nearby" badge (other badges instead) · store name/logo/cover (emoji + gradient, no uploads) · holiday hours · contact (phone shown, email in API only) · overall-only ratings · product cards (emoji tiles, no photos) · bundle/related (similar items only) · call-to-confirm (store-level call button)
- ✗ Manual address entry · drop-pin · saved frequent locations · auto-suggest · multi-location search · travel mode · split view · map clustering · travel-time estimates · Street View · AR navigation · photo gallery · category-based ratings · parking · return policy · social feed · announcements · variant display

## 4. Price Comparison & Deals — ✓6 ◐1 ✗12
- ✓ Side-by-side comparison · historical price tracking · price-drop alerts · best-value algorithm · store-posted deals · flash-sale notifications
- ◐ Deal-of-the-day (deals sorted by expiry, no curation)
- ✗ Online-retailer toggle · price-match info · tax estimation · total-cost calculator · coupon aggregation · cashback · clearance alerts · bundle suggestions · student/military/senior discounts · loyalty integration · seasonal calendars · wait/buy prediction

## 5. Social & Community — ✓5 ◐5 18
- ✓ Rate stores · rate products · text reviews · share results · share store profiles
- ◐ Helpfulness voting (upvote only) · owner responses (displayed, no reply UI) · moderation/reporting (admin flag queue, no user report action) · deep linking (hash routes, no universal links) · wishlists (single private list)
- ✗ Photo/video reviews · verified-purchase reviews · AI review summaries · category ratings · share alerts · referral program · collaborative lists · success stories · social proof · forums/Q&A · ask-community · follow stores/users · activity feed · request board · upvotes · local groups · expert recs

## 6. Store Owner / Business Dashboard — ✓13 ◐9 ✗37
- ✓ Multi-location management · manual listing · real-time stock updates · auto-deduction on reservation · overview KPIs (views/matches/clicks/reservations/revenue) · product performance · revenue attribution · create/manage promotions · push campaigns to nearby shoppers · reservation/hold requests · order queue management · categorization & tagging
- ◐ Business registration (creates unverified store, no license upload) · profile create/edit (create via API, no edit UI) · verification badge system · price tools (individual only) · search-trend data (admin-level) · conversion funnel (single conversion KPI) · broadcast announcements (via deals) · BOPIS scheduling (instant, no slots) · digital receipts (reservation record)
- ✗ Hours management UI · staff RBAC accounts · subscription management · CSV bulk upload · POS/IMS/ERP integrations · barcode listing scanner · low-stock owner alerts · variants · bulk/scheduled pricing · seasonal/archive/visibility controls · demographics · competitor benchmarking · heatmaps · peak hours · sentiment · report exports · A/B tools · featured/sponsored listings · email/social marketing · coupon codes · loyalty creation · events · cross-promotion · retargeting · messaging/chatbot/inquiries/review-response UI/feedback · curbside coordination · delivery management · returns processing

## 7. Advanced Search & Discovery — ✓13 ◐10 ✗21
- ✓ Photo search · text search · voice search · barcode search · URL search · category browsing · trending searches · save/bookmark · distance radius · min rating · availability · open-now · delivery filters
- ◐ Screenshot search (via upload) · search-by-example (similar chips) · brand browsing (API filter only) · search history export (via GDPR export) · trending-nearby & personalized feed (popular-near-you list) · re-stock reminders (watch alerts) · brand/price/store-type filters (partial surfaces)
- ✗ Video search · reverse search · per-user history UI + re-search + archive + clear + incognito · named collections · also-bought · stores-you-might-like · complete-the-look · seasonal · new arrivals · condition/curbside/payment/accessibility/eco/local/organic filters

## 8. Notifications & Alerts — ✓6 ◐5 11
- ✓ Back-in-stock · price-drop · flash-sale/deal-in-radius · reservation-ready · in-app notification center (read/unread/mark-all, deep links)
- ◐ Push/browser (foreground Web Notifications + polling, no server push) · notification center archive · per-category preferences (deal/stock/email switches) · wishlist-found-nearby (via stock/deal alerts)
- ✗ New-store-carrying-saved-item · inquiry/review-response alerts · followed-store reviews · referral updates · weekly digest · proximity alerts · email/SMS channels · quiet hours · frequency controls

## 9. Payments & Transactions — ✓0 ◐1 ✗16
- ◐ Digital receipts (reservation codes)
- ✗ All in-app payment bullets (prepay, deposits, wallet, card/Apple/Google/PayPal, crypto, split, gift cards, refunds, payment history) · all subscription tier purchasing (shopper ×3, store ×4) — rails & research only

## 10. Delivery & Fulfillment — ✓1 ◐3 9
- ✓ In-store pickup (reservation flow)
- ◐ Curbside & same-day delivery (store capability flags only) · hold-at-store (no expiration timer)
- ✗ Scheduled delivery · ship-to-home · lockers · all third-party courier integration bullets (tracking, cost/time estimates, ratings, batching)

## 11. AR Features — ✓0 ◐0 ✗8 — all left out (gated behind `ar_beta` feature flag; paths in RESEARCH.md §11)

## 12. Accessibility & Inclusivity — ✓2 ◐4 7
- ✓ Dynamic font sizing · high-contrast mode
- ◐ Screen-reader support (ARIA labels/roles throughout, not audited) · voice navigation (voice search only) · keyboard navigation (focus rings, keyboard-map pins, not audited) · WCAG 2.1 AA (design target, not certified)
- ✗ Color-blind modes · haptics · closed captions · RTL · multi-language · simplified elderly mode · one-handed mode

## 13. Security & Privacy — ✓8 ◐8 ✗13
- ✓ Rate limiting · JWT/OAuth-style bearer auth · input validation · GDPR data download · account deletion · guest/anonymous browsing · human moderation queue · (TLS at deploy)
- ◐ TLS/SSL (deploy-dependent) · CSRF/XSS (CSP + token auth, no cookie session) · CCPA/LGPD (same tools as GDPR) · granular privacy controls · location data controls · transparent policy · privacy dashboard · store verification
- ✗ E2E message encryption · AES-256 at rest · SOC 2 · audits/pentests · vulnerability scanning · cookie consent (no cookies used) · personalization opt-out · third-party opt-out · AI moderation · community reporting UI · counterfeit detection · review-fraud detection · user blocking

## 14. Performance & Technical — ✓6 ◐4 ✗21
- ✓ Offline mode (SW shell + cached API) · PWA · app-size (<120 KB JS) · public API + OpenAPI · responsive web
- ◐ Sub-2 s recognition (local matching yes; production vision pending) · lazy loading/image opt (no raster images at all) · background sync (polling) · infinite scroll ("load more" paging)
- ✗ CDN · adaptive quality · background location · iOS/Android/watch/wear/extensions/TV apps (Capacitor path documented) · webhooks · POS/e-com/ERP/CRM/Shopping/social/calendar/contacts/Lens/Zapier integrations

## 15. User-Facing Analytics — ✓0 ◐1 ✗8
- ◐ Savings tracker (watchlist price deltas + "save ₦X vs priciest")
- ✗ Spending insights · frequency · carbon footprint · most-visited stores · search patterns · budgets · category breakdown · year-in-review

## 16. Gamification & Engagement — ✓3 ◐1 ✗8
- ✓ Achievement badges · points/rewards · Local Hero badge (in badge engine)
- ◐ Milestone celebrations (badge-unlock notifications)
- ✗ Streaks · leaderboards · challenges · seasonal events · referral tiers · stamp cards · spin-the-wheel · surprise rewards

## 17. Customer Support — ✓0 ◐2 ✗15
- ◐ Interactive tutorials / guided tours (onboarding slides only)
- ✗ FAQ/help center · video tutorials · knowledge base · forums · troubleshooting wizards · live chat · AI chatbot · email tickets · phone · social support · bug reports · feature voting · feedback forms · CSAT/NPS · account managers

## 18. Admin & Moderation Panel — ✓7 ◐1 ✗8
- ✓ Content moderation queue · flagged-content management · system analytics dashboard · search-trend analytics · infrastructure health · feature flags & A/B management · role-based access control
- ◐ Compliance tools (export/delete flows)
- ✗ User suspend/ban/verify UI · store approve/suspend UI · revenue metrics · global push composer · promo-code management · taxonomy management · API key management · audit logs

## 19. Monetization — ✓0 ◐2 9
- ◐ Commission/referral rails (attributed-revenue KPI) · API access (public API exists, no billing)
- ✗ Freemium billing · promoted listings · sponsored results · advertising · data insights sales · white-label · affiliate links · premium support · event sponsorship

## 20. Future / Stretch — ✓0 ◐0 ✗17 — all left out by design (flags exist: `ar_beta`, `group_shopping`, `ai_assistant`)

## 21. Onboarding & FTUE — ✓5 ◐1 ✗3
- ✓ Animated 3-slide intro · permission priming with explanations (location, notifications) · "try it now" guest mode · skip option · welcome offer (25 points + welcome alert)
- ◐ Progressive onboarding (role-gated surfaces)
- ✗ Interest/category selection · interactive first-search tutorial · store-owner quick-start wizard

---
## v1.1-android addendum — native Android shell (delivered)

The mobile-wrap strategy moved from *planned* to *shipped*: `android/` produces
a signed APK bundling this PWA in a secure WebView origin with native bridges
(camera + geolocation runtime permissions, file picker, MediaStore downloads,
user-configurable API origin via `?api=`/`NBGBridge`). Web Push is intentionally
off inside the wrapper (FCM is the v1.2 roadmap item); the same 46-endpoint
REST API now serves browser PWA and Android app alike. Per-feature statuses in
the tables above are unchanged — this addendum records the delivery of the
native foundation itself (see `docs/ANDROID.md`).

## v1.1 gap-closure addendum (delivered after the first audit)

Four gap clusters were closed end-to-end; statuses below supersede the matrix above.
Running totals now: **✓ 124 · ◐ 80 · ✗ 284**.

**(a) Manual location entry + full filter surface**
- §3 "Manual location entry (address, zip, city)" ✗→**✓**: location sheet (top-bar chip + Profile) with debounced geocode search → server proxy to OSM Nominatim (CSP stays `'self'`), Nigeria-first re-ranking, offline gazetteer of serviced cities, raw lat/lng pinning, GPS button, recent-locations chips.
- §3 "Save frequent locations" ✗→****: last 5 locations remembered as recents (named home/work slots still open).
- §7 brand filter ◐→**✓** and price range ◐→**✓**: filter sheet now exposes brand, min price, max price plus the existing switches, with an active-filter count badge on the filter button.

**(b) Real Web Push (alerts with the app closed)**
- §8 "Push notifications (mobile)/browser" ◐→**✓**: zero-dependency RFC 8291 (aes128gcm) + RFC 8292 (VAPID ES256) server (`lib/webpush.js`), persistent VAPID keys, subscription store, push fan-out inside `notify()`, dead-endpoint pruning on 404/410, dual `Authorization: WebPush`/`vapid t=,k=` scheme fallback; service worker `push` + `notificationclick` handlers open the deep link; Profile row subscribes/unsubscribes with live status text. Email/SMS channels remain ✗.

**(c) Paystack test-mode checkout**
- §9 "Pre-pay for in-store pickup" ✗→**✓** and "Multiple payment methods" ✗→**◐** (card via Paystack hosted checkout): reservation sheet gained Pay-at-pickup ⇄ Pay-now segment; payment initializes in kobo, opens hosted checkout (or the branded `/pay/sim` test checkout when no keys are set), verify endpoint fulfils idempotently (reservation → `paid`, owner notified "prepaid"), HMAC-SHA512 webhook route for live mode.
- §9 subscription tiers ✗→**✓** (shopper ×2, store ×2 plans on new `#/premium` page with active-plan banner, renew date, subscribe flow); "Payment history and export" ✗→**✓** (receipts list on Premium page + GDPR export includes payments via reservations).
- Live switch is one env var: `PAYSTACK_SECRET_KEY` (amounts in kobo, webhook signature verified, simulator auto-disables).

**(d) Search history + collections**
- §7 history bullets ✗→**✓**: per-user history recorded on search (result counts, capped 40), recent-search chips with one-tap re-run, per-entry delete, clear-all, and **incognito mode** switch that suppresses recording.
- §7 "Create named collections/wishlists" ✗→**✓**: collections CRUD, Saved page collection chips with counts, move-to-collection sheet, delete returns items to All; seeded example collection included.

---
### Reading the numbers
The MVP concentrates on the **core promise** — upload → recognize → compare nearby → reserve — plus the multi-role loops that make it demonstrable (shopper / owner / admin), the PWA mobile shell, and the API contract the native apps will reuse. Everything marked ✗ has a researched production path in `docs/RESEARCH.md` (same section numbering).
