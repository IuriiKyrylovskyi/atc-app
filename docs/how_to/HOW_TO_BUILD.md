# 🏗️ HOW TO BUILD — ATC-APP

> Command reference for every build target. All commands run from the **monorepo root** unless noted.

---

## RELEASE ALL PLATFORMS

```bash
pnpm release:all
```

---

## Prerequisites

```bash
node --version   # must be ≥ 20
pnpm --version   # must be ≥ 9
```

Install once:

```bash
pnpm install
```

---

## 1. Development

### Web + Electron (parallel)

```bash
pnpm dev
```

Each gets its own Vite dev server: web on **:5273**, Electron on **:5274**, so
either can run alone and both can run at once.

### Web only (Vite dev server on :5273)

```bash
pnpm dev:app
```

### Electron only (Vite dev server on :5274)

```bash
pnpm dev:electron
```

Starts Vite on :5274 and opens Electron once it answers
(`scripts/wait-for-url.mjs`). Electron runs the built main process
(`packages/electron/dist/main.js`): after changing `packages/electron/src`, run
`pnpm build:electron` first.

### Mobile — auto-detects platform (macOS → iOS, Windows → Android)

```bash
pnpm dev:mobile
```

### Android — build → sync → install → launch on connected device

```bash
pnpm dev:android
```

Requires: ADB connected device, `ANDROID_HOME` set.

### iOS — build → sync → install → launch in Simulator

```bash
pnpm dev:ios
```

Requires: Xcode, macOS only.

---

## 2. Production Web + Electron

### Build both

```bash
pnpm build
```

### Build web app only

```bash
pnpm build:app
```

### Build Electron only

```bash
pnpm build:electron
```

### Web hosting headers for Kokoro pilot voices

With VOICE KOKORO the radar scope reloads itself as `index.html?coi=1` to run
Kokoro multi-threaded (about twice as fast). The host must then send, for that
document only:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

and `Cross-Origin-Embedder-Policy: credentialless` on the worker scripts
(`assets/*.worker-*.js`). Never send them for `index.html` without `?coi=1`:
the RevenueCat / Stripe checkout iframes do not opt in to COEP and would be
blocked. A host without these headers still works; Kokoro just runs
single-threaded. The Vite dev servers (5273 / 5274) already do this.

### Package Electron installer (dmg / exe / AppImage)

```bash
pnpm dist:electron
# or
pnpm dist
```

---

## 3. Mobile Builds

> ⚠️ Always use these scripts — they set `CAPACITOR_PLATFORM` correctly so the real RevenueCat SDK is bundled instead of the web stub.

### Clean previous build artifacts before a release

```bash
pnpm mobile:clean
```

Deletes: `packages/app/dist`, Android assets public, Android build dirs, iOS public.

### Build web assets for Android

```bash
pnpm build:mobile:android
# sets CAPACITOR_PLATFORM=android → real RC SDK, no stubs
```

### Build web assets for iOS

```bash
pnpm build:mobile:ios
# sets CAPACITOR_PLATFORM=ios → real RC SDK, no stubs
```

### Sync Capacitor to Android

```bash
pnpm cap:sync:android
```

### Sync Capacitor to iOS

```bash
pnpm cap:sync:ios
```

---

## 4. Android Release

### Full Android release APK (sign + build)

```bash
pnpm android:release
# clean → build:mobile:android → cap:sync:android → gradlew assembleRelease
```

### Full Android release AAB (for Google Play upload)

```bash
pnpm android:bundle
# clean → build:mobile:android → cap:sync:android → gradlew bundleRelease
```

Output: `packages/mobile/android/app/build/outputs/bundle/release/app-release.aab`

### Android dev sync (build + sync, no APK)

```bash
pnpm android:dev
```

---

## 5. iOS Release

### Build iOS archive (Xcode required, macOS only)

```bash
pnpm ios:release
# build:mobile:ios → cap:sync:ios → xcodebuild archive
```

Output: `~/Library/Developer/Xcode/Archives/ATC-APP/App.xcarchive`

After archive completes, open Xcode → Organizer → Distribute App → App Store Connect.

---

## 6. Auto-detect Platform Release

Runs `ios:release` on macOS, `android:release` on Windows:

```bash
pnpm mobile:build:release
```

---

## 7. Versioning & Release

### Sync version from package.json → Android build.gradle + iOS project.pbxproj

```bash
pnpm version:sync
```

### Patch release (0.0.X bump → commit → tag → push)

```bash
pnpm release
# verify:env → build web+electron → dist:electron → standard-version patch
```

### Minor release (0.X.0)

```bash
pnpm release:minor
```

### Major release (X.0.0)

```bash
pnpm release:major
```

> After `pnpm release`, rebuild the store binaries with the new version:
>
> ```bash
> pnpm android:bundle   # upload new AAB to Google Play
> pnpm ios:release      # archive in Xcode → distribute to App Store
> ```

---

## 8. App Icons & Splash

Generate all icon sizes from a single 1024×1024 source:

```bash
# Build web first (required — generates www/manifest.json)
pnpm build:app && pnpm cap:sync:android

# Generate icons
pnpm --filter @atc-app/mobile run assets:generate
```

Output: 135 Android files + 11 iOS files + 14 PWA files.

---

## 9. Code Quality

### Lint all packages

```bash
pnpm lint
```

### Format all files

```bash
pnpm format
```

### Check formatting without writing

```bash
pnpm format:check
```

### Verify dev environment (Node, PNPM, JDK, Xcode tools)

```bash
pnpm verify:env
```

---

## 10. First-Time Setup (clean machine)

```bash
# Installs deps + builds web + syncs Capacitor to both platforms
pnpm setup:dev
```

---

## Common Build Sequences

### "I want to test on a real Android device right now"

```bash
pnpm mobile:clean
pnpm android:dev          # builds + syncs
# then open Android Studio → run on device
# OR build APK:
pnpm android:release
adb install -r packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

### "I'm ready to upload to Google Play"

```bash
pnpm release              # bumps version
pnpm android:bundle       # clean build → signed AAB
# Upload packages/mobile/android/app/build/outputs/bundle/release/app-release.aab
```

### "I'm ready to upload to App Store"

```bash
pnpm release              # bumps version
pnpm ios:release          # archive
# In Xcode Organizer → Distribute → App Store Connect
```

### "Nothing works, start fresh"

```bash
pnpm mobile:clean
pnpm install
pnpm build:mobile:android   # or :ios
pnpm cap:sync:android       # or :ios
```

---

## Environment Variables Required

Create `packages/app/.env.local` before any build:

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_RC_IOS_KEY=appl_...
VITE_RC_ANDROID_KEY=goog_...
VITE_RC_WEB_BILLING_PUBLIC_KEY=...   # RevenueCat Web Billing (Paddle) — public key only
VITE_ADMOB_INTERSTITIAL_ID_ANDROID=ca-app-pub-.../...
VITE_ADMOB_INTERSTITIAL_ID_IOS=ca-app-pub-.../...
ADMOB_APP_ID_ANDROID=ca-app-pub-...~...
ADMOB_APP_ID_IOS=ca-app-pub-...~...
```

> Mobile builds that omit `VITE_RC_*` keys will bundle the real RC SDK but silently fail to configure it — purchases will not work.
