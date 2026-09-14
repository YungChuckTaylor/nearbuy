#!/usr/bin/env bash
# Build NearBuyGoods-debug.apk WITHOUT Gradle or Android Studio.
# Uses a minimal toolchain (JDK 17 + Android build-tools 34 + platform 34),
# expected under $NBG_ANDROID_TOOLS (default ~/.cache/nbg-android):
#   jdk-17*/          (e.g. Temurin)         https://adoptium.net
#   android-14/       build-tools r34        https://dl.google.com/android/repository/build-tools_r34-linux.zip
#   android-34/       platform (android.jar) https://dl.google.com/android/repository/platform-34-ext7_r03.zip
# Docs: ../docs/ANDROID.md
set -euo pipefail
cd "$(dirname "$0")"

TOOLS="${NBG_ANDROID_TOOLS:-$HOME/.cache/nbg-android}"
JAVA_HOME="$(ls -d "$TOOLS"/jdk-17* 2>/dev/null | head -1)"
BT="$TOOLS/android-14"
PLATFORM="$TOOLS/android-34/android.jar"
for p in "$JAVA_HOME/bin/javac" "$BT/aapt2" "$BT/d8" "$BT/apksigner" "$BT/zipalign" "$PLATFORM"; do
  [ -e "$p" ] || { echo "Missing toolchain piece: $p — see docs/ANDROID.md §'CLI build'"; exit 1; }
done
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"

PKG=app.nearbuygoods.android
VERSION_CODE=2
VERSION_NAME=1.1.0
OUT="NearBuyGoods-v${VERSION_NAME}-debug.apk"
APP=app/src/main
WORK="${TMPDIR:-/tmp}/nbg-apk-build"
rm -rf "$WORK"; mkdir -p "$WORK/gen" "$WORK/classes" "$WORK/dex"

echo "→ Syncing PWA (../public) into assets/www"
rm -rf "$APP/assets/www"; mkdir -p "$APP/assets/www"
(cd ../public && tar cf - --exclude=.htaccess .) | (cd "$APP/assets/www" && tar xf -)

echo "→ Icons (regenerate from web assets)"
python3 tools/make-icons.py

echo "→ Compile + link resources (aapt2)"
# The repo manifest omits the package attribute (AGP 8 requires that; namespace
# lives in app/build.gradle). Standalone aapt2 still needs it → inject into a temp copy.
sed 's|<manifest xmlns:android="http://schemas.android.com/apk/res/android">|<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="'"$PKG"'">|' \
  "$APP/AndroidManifest.xml" > "$WORK/AndroidManifest.xml"
grep -q "package=\"$PKG\"" "$WORK/AndroidManifest.xml" || { echo "manifest package injection failed"; exit 1; }
"$BT/aapt2" compile --dir "$APP/res" -o "$WORK/res.zip"
"$BT/aapt2" link -o "$WORK/base.apk" -I "$PLATFORM" \
  --manifest "$WORK/AndroidManifest.xml" \
  -A "$APP/assets" --java "$WORK/gen" \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --auto-add-overlay -R "$WORK/res.zip"

echo "→ Compile Java (javac 17)"
find "$WORK/gen" "$APP/java" -name '*.java' > "$WORK/sources.txt"
javac -source 17 -target 17 -encoding UTF-8 -classpath "$PLATFORM" -d "$WORK/classes" @"$WORK/sources.txt"

echo "→ Dex (d8)"
"$BT/d8" --release --lib "$PLATFORM" --min-api 24 --output "$WORK/dex" $(find "$WORK/classes" -name '*.class')

echo "→ Package, align, sign"
cp "$WORK/base.apk" "$WORK/unsigned.apk"
(cd "$WORK/dex" && zip -q "$WORK/unsigned.apk" classes.dex)
"$BT/zipalign" -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
KEYSTORE="keys/nbg-debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p keys
  keytool -genkeypair -v -keystore "$KEYSTORE" -alias nbg -keyalg RSA -keysize 2048 \
    -validity 10950 -storepass nearbuygoods -keypass nearbuygoods \
    -dname "CN=NearBuyGoods Debug, OU=Mobile, O=NearBuyGoods, L=Lagos, C=NG"
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias nbg \
  --ks-pass pass:nearbuygoods --key-pass pass:nearbuygoods \
  --out "$OUT" "$WORK/aligned.apk"
"$BT/apksigner" verify --print-certs "$OUT" >/dev/null && echo "→ Signature: OK"

echo "→ APK summary"
"$BT/aapt2" dump badging "$OUT" | grep -E "^package|^application-label|^sdkVersion|^targetSdkVersion|launchable-activity" || true
ls -lh "$OUT"
echo ""
echo "DONE: android/$OUT"
echo "Copy it to your phone (USB/Drive/WhatsApp-to-self) and install — allow 'unknown sources' if asked."
