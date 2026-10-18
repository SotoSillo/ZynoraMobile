#!/bin/sh
set -e
cd "$(dirname "$0")"
npm install
npm install @jofr/capacitor-media-session || echo "Geen mediasessie-plugin, ga zonder verder"
node prep.js
npx cap add android
node patch-android.js
(npm install --no-save @capacitor/assets && npx capacitor-assets generate --android --iconBackgroundColor '#0a1018' --splashBackgroundColor '#0a1018') || echo "Standaard icoon gebruikt"
build() { npx cap sync android && cd android && chmod +x gradlew && ./gradlew assembleDebug; }
if ! (build); then
  echo "Opnieuw zonder mediasessie-plugin"
  npm uninstall @jofr/capacitor-media-session || true
  rm -rf android
  npx cap add android
  node patch-android.js
  (build)
fi
echo "Klaar: android/app/build/outputs/apk/debug/app-debug.apk"
