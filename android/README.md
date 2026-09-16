# NearBuyGoods — Android app

The native shell around the NearBuyGoods PWA: bundles `../public` into the APK,
serves it from a private secure origin, and adds native bridges (camera & GPS
permissions, file picker, server-address settings, Downloads export).
Zero external libraries — one Activity + your web code.

```
android/
├── app/src/main/
│   ├── AndroidManifest.xml           permissions, theme, launcher activity
│   ├── java/…/MainActivity.java      the entire native shell (~450 lines, no deps)
│   ├── assets/www/                   auto-synced copy of ../public (build-apk.sh)
│   └── res/                          icons (generated), splash, theme, network config
├── keys/nbg-debug.keystore           debug signing key (created on first build)
├── tools/make-icons.py               icons from public/assets (Pillow)
├── build-apk.sh                      CLI build — no Gradle/Android Studio needed
├── settings.gradle, build.gradle, app/build.gradle   Android Studio project (AGP 8.5)
└── NearBuyGoods-v*-debug.apk         ← the installable app (built by CI on merge to main)
```

## Quick start
1. Enable CI once (copy `../docs/ci/android-build-workflow.yml` to
   `.github/workflows/build-android.yml`) — then every push to `main` that
   changes `../public` rebuilds the APK and commits it here automatically.
2. Locally: `./build-apk.sh` (needs the small toolchain in `~/.cache/nbg-android` — see docs)
   **or** open this folder in Android Studio and hit Run.
3. No toolchain at all? `python3 ../tools/apk-patch.py` hot-swaps `../public`
   into an existing signed APK (pure Python, see docs §D).
2. Copy the APK to the phone → tap → allow "install unknown apps".
3. First run asks for your server address:
   - testing on Wi‑Fi: `http://<your-computer-ip>:3000` while `node server.js` runs
   - production: your deployed `https://` URL
   Change it any time in **Profile → App server address**.

Full guide (install, release signing, Play Store checklist, push roadmap):
[`../docs/ANDROID.md`](../docs/ANDROID.md)
