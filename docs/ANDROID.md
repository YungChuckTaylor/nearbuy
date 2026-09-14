# NearBuyGoods — Android app (v1.1.0)

The native Android build promised by the original brief ("web service as the
foundation for the mobile app") is **delivered**: a signed, installable APK that
wraps this exact PWA in a dependency-free native shell. One code base, three
surfaces: browser PWA → Android app → (later) iOS via the same assets.

| Deliverable | Path |
|---|---|
| Installable app (debug-signed) | `android/NearBuyGoods-v1.1.0-debug.apk` (~336 KB) |
| Android Studio project (AGP 8.5) | `android/` (open the folder, press Run) |
| CLI build without Gradle/Studio | `android/build-apk.sh` |
| Native shell source (zero libraries) | `android/app/src/main/java/app/nearbuygoods/android/MainActivity.java` |
| Icon/splash generators (from web assets) | `android/tools/make-icons.py` |

Min SDK 24 (Android 7.0+, ~97% of devices) · target SDK 34 (Play-eligible) ·
package `app.nearbuygoods.android`.

---

## 1. How it works

```
┌─────────────────────────── APK ───────────────────────────┐
│  MainActivity (1 Activity, no androidx, no deps)          │
│                                                           │
│  WebView ── loads ──► https://app.nearbuygoods.local      │
│        ▲                    (private origin, intercepted) │
│        │ shouldInterceptRequest                           │
│  assets/www/  ◄── synced copy of ../public (the PWA)      │
│                                                           │
│  Native bridges the page cannot do alone:                 │
│   • camera        getUserMedia → runtime CAMERA perm      │
│   • GPS           geolocation  → runtime FINE_LOCATION    │
│   • <input file>  onShowFileChooser → native picker       │
│   • downloads     NBGBridge.saveText → MediaStore         │
│   • server config NBGBridge.changeServer / ?api=… inject  │
│   • external URLs → browser / dialer / maps intents       │
└───────────────┬───────────────────────────────────────────┘
                │ REST + JSON (Bearer JWT) — same 46-endpoint API as the web
                ▼
        Your NearBuyGoods server   (http://<lan-ip>:3000 while testing,
                                    https://your-domain in production)
```

Why a private origin instead of `file:///android_asset`? ES modules,
`localStorage`, camera and geolocation all require a **secure context**; the
intercepted `https://app.nearbuygoods.local` origin provides that with the
assets served straight from the APK (instant load, no network needed for the
shell, no stale service-worker cache — SW registration is skipped inside the
wrapper).

Server address flow: first-run dialog → saved in `SharedPreferences` → injected
as `?api=…` → `public/js/config.js` persists it to `localStorage` and points
`api.js` at it. Change any time via **Profile → App server address**
(`NBGBridge.changeServer()`).

JS detects the wrapper via `window.NBGBridge` and adapts:
- Web Push toggle hidden (background push will come from FCM — §8);
- service worker not registered;
- GDPR export writes to `Downloads/NearBuyGoods/` natively instead of a blob link;
- `/pay/sim` and other API-host pages (docs, test checkout) stay **in-app** so
  payment flows return to the shell; anything else opens externally.

## 2. Install & test on your phone (≈5 minutes)

1. Get `android/NearBuyGoods-v1.1.0-debug.apk` onto the phone — USB copy,
   Google Drive, or WhatsApp-it-to-yourself. Tap it; allow "install unknown
   apps" when prompted.
2. On your computer run the API: `node server.js` (port 3000).
3. Find your LAN IP: Windows `ipconfig` · macOS/Linux `ifconfig | grep inet`
   (e.g. `192.168.1.20`). Phone must be on the **same Wi‑Fi**.
4. First app run → dialog → enter `http://192.168.1.20:3000` → **Connect**.
   (Plain HTTP is allowed for dev by `res/xml/network_security_config.xml`.)
5. Exercise the loop: search, **Find** tab → photo/scan (camera permission
   prompt), GPS pin, reserve an item, `#/premium` Paystack *test* checkout,
   Profile → My data (export lands in `Downloads/NearBuyGoods/`).
6. Against a deployed server instead: enter its `https://` URL (Hostgator
   Route A/B from `docs/DEPLOY.md`, Render, VPS — anything speaking `/api/v1`).

Log in with the usual demo accounts (`shopper@nearbuygoods.app` / `demo1234`).

## 3. Build the APK yourself

### A. Android Studio (recommended for anything you'll ship)
Open the `android/` folder as a project; Gradle syncs AGP 8.5 (Studio supplies
JDK 17). Before building, refresh the bundled web assets:

```bash
cd android && rm -rf app/src/main/assets/www && mkdir -p app/src/main/assets/www
(cd ../public && tar cf - --exclude=.htaccess .) | (cd app/src/main/assets/www && tar xf -)
```

…then Run ▶ on a device/emulator. (Or run `./build-apk.sh` once — it syncs.)

### B. CLI — no Gradle, no Studio (produced this APK)
One-time toolchain (~380 MB) into `~/.cache/nbg-android` with exactly these
directory names (`jdk-17*`, `android-14`, `android-34`):

```bash
mkdir -p ~/.cache/nbg-android && cd ~/.cache/nbg-android
curl -LO "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse" \
  && tar xzf eclipse && rm eclipse            # → jdk-17.0.x+y/
curl -LO https://dl.google.com/android/repository/build-tools_r34-linux.zip \
  && unzip -q build-tools_r34-linux.zip        # → android-14/
curl -LO https://dl.google.com/android/repository/platform-34-ext7_r03.zip \
  && unzip -q platform-34-ext7_r03.zip         # → android-34/android.jar
```

Then `cd android && ./build-apk.sh` → signed APK + `aapt2 badging` summary.
Override the toolchain location with `NBG_ANDROID_TOOLS=/path`.

Version bumps: edit `VERSION_CODE/VERSION_NAME` in `build-apk.sh` **and**
`versionCode/versionName` in `app/build.gradle` (keep both in step).

## 4. Release signing & Play Store checklist

The shipped APK is **debug-signed** (`android/keys/nbg-debug.keystore`, kept in
the repo so rebuilds upgrade-install over each other during development).
Never publish a debug build. For release:

```bash
keytool -genkeypair -v -keystore android/keys/nbg-release.keystore -alias nbg \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -dname "CN=NearBuyGoods, O=NearBuyGoods, L=Lagos, C=NG"
# BACK THIS FILE + PASSWORDS UP OFF-MACHINE. Lost keystore = lost app identity:
# Play can never update the app again.
```

Then Android Studio → **Build → Generate Signed App Bundle / APK** → choose the
release keystore → AAB. Checklist before submitting:

- [ ] `targetSdk 34` ✓ already; `versionCode` incremented per upload
- [ ] Data-safety form: camera & location collected only when the user invokes
      those flows; no third-party SDKs (the app has none)
- [ ] Privacy-policy URL (template content in `docs/ARCHITECTURE.md`)
- [ ] IARC content rating questionnaire (shopping → Everyone)
- [ ] Store listing art: icon = `public/assets/icon-512.png`; feature graphic
      1024×500 still to design
- [ ] Internal testing track first; debug-cert users will need one reinstall
      when you switch to the release cert

## 5. Production hardening (2 minutes, do before launch)

- `res/xml/network_security_config.xml`: `cleartextTrafficPermitted="false"`
- `MainActivity.configureWebView()`: change
  `MIXED_CONTENT_ALWAYS_ALLOW` → `MIXED_CONTENT_NEVER_ALLOW`
  (both exist only so you can test over plain-HTTP LAN; HTTPS in production)
- Server side unchanged: HTTPS + `NBG_SECRET` + Paystack live keys per `docs/DEPLOY.md`

## 6. Native bridge reference (`window.NBGBridge`)

| Method | Purpose |
|---|---|
| `isNative()` → `true` | wrapper detection (push off, SW off, footer text) |
| `getApiBase()` | current configured API origin |
| `changeServer()` | reopen the server-address dialog and reload |
| `saveText(name, text)` | write a file to `Downloads/NearBuyGoods/` (MediaStore ≥Q, legacy path + runtime perm below) |

JS-side behaviour keyed off the bridge lives in `public/js/{config,push,app}.js`
and `public/js/pages/profile.js`.

## 7. Roadmap (native v1.2+)

1. **FCM background push** — the wrapper's replacement for Web Push: add
   `firebase-messaging`, register the FCM token via an extended
   `POST /push/subscribe`, dispatch from the server over FCM HTTP v1, tap →
   deep-link `#/alerts`. (Web PWA keeps VAPID Web Push.)
2. **ML Kit barcode** fallback where `BarcodeDetector` is absent (already
   feature-detected in `js/recognize.js`).
3. **TWA upgrade** once the shop is on a verified HTTPS domain
   (`assetlinks.json`) — full Chrome rendering + shared cookies; keep this
   wrapper for offline-shell and configurable-server use cases.
4. **iOS**: same PWA through Capacitor (`docs/ARCHITECTURE.md` §3) or this
   shell ported to `WKWebView`.
5. Update channel: compare `versionCode` against a field on `/api/v1/meta`.

## 8. Verification done / on-device checklist

Verified in the build environment: `apksigner verify` OK; `aapt2 dump badging`
(package, minSdk 24, targetSdk 34, launchable activity); dex contains 17
classes / 219 methods; APK holds the full `assets/www` shell + icons; web
regression suite green (jsdom smoke: guest + authenticated shopper, zero
runtime errors). WebView itself cannot run headless here, so please tick these
on a real phone after installing:

- [ ] installs & launches (branded splash → onboarding or home)
- [ ] server dialog accepts LAN `http://…:3000` and a remote `https://…`
- [ ] search + product + store pages render; bottom nav + back button behave
- [ ] Find tab camera prompt → permission dialog → live preview
- [ ] GPS button asks location permission and drops a pin
- [ ] photo upload via file picker
- [ ] premium test checkout completes in-app and returns to the shell
- [ ] Profile → My data saves `Downloads/NearBuyGoods/nearbuygoods-my-data.json`
- [ ] Profile → App server address switches servers without reinstalling
- [ ] rotation keeps state; external links open the browser
