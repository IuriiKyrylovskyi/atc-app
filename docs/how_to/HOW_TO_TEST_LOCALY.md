# How to test ATC-APP locally (iOS & Android)

Run all commands from the **repo root** unless stated otherwise.

---

## 1. One-time setup

1. **Workspace file.** pnpm ignores the `"workspaces"` field in `package.json`. The repo root must contain `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - 'packages/*'
   ```
2. **Install dependencies**
   ```bash
   pnpm install
   ```
3. **Environment file** `packages/app/.env.local` (never commit it):
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   VITE_RC_IOS_KEY=appl_...
   VITE_RC_ANDROID_KEY=goog_...
   VITE_ADMOB_INTERSTITIAL_ID_IOS=...
   VITE_ADMOB_INTERSTITIAL_ID_ANDROID=...
   ADMOB_APP_ID_IOS=...
   ADMOB_APP_ID_ANDROID=...
   ```
   `VITE_*` values are read by Vite (the web build). `ADMOB_APP_ID_*` are read by `capacitor.config.ts` (Node), so they must not have the `VITE_` prefix.
4. **Check that every native plugin is registered.** Each Capacitor plugin the app imports must be listed in `packages/mobile/package.json`, not only in `packages/app`. `cap sync` only registers plugins from the mobile package. Currently required:
   `admob`, `app`, `filesystem`, `haptics`, `network`, `screen-orientation`, `status-bar` and RevenueCat `purchases-capacitor`.
5. **Tools:** Xcode (iOS), Android Studio + an emulator or a USB device (Android), CocoaPods (`pod --version`).

---

## 2. iOS (simulator)

```bash
pnpm run build:mobile:ios      # vite build with CAPACITOR_PLATFORM=ios
pnpm run cap:sync:ios          # copies dist + registers plugins
pnpm --filter @atc-app/mobile open:ios
```

In Xcode:

1. Select the **App** scheme and an iPhone simulator.
2. First time only: **Product → Clean Build Folder** (⇧⌘K).
3. Press **Run** (⌘R).

**Read the `cap sync` output.** Under "Found N Capacitor plugins for ios" you must see all plugins from step 1.4. If one is missing, the native side isn't installed and its calls will fail with `{"code":"UNIMPLEMENTED"}`.

Every JS change needs a rebuild: repeat `build:mobile:ios` → `cap:sync:ios` → Run.

### Testing purchases on the simulator

- The simulator has no App Store account. The log line `ASDErrorDomain Code=509 "No active account"` is expected.
- Create a **StoreKit Configuration file** (Xcode → File → New → StoreKit Configuration File) containing the product `pro_access_unlock` (non-consumable).
- Xcode → **Product → Scheme → Edit Scheme → Run → Options → StoreKit Configuration** → select that file.
- For real sandbox purchases, use a physical device with a sandbox Apple ID instead.

### Physical iPhone

Select your device in Xcode, set your Team under **Signing & Capabilities**, and Run. For ads, use the Google test IDs, which the app uses automatically in debug builds (`import.meta.env.DEV`). Note that `vite build` produces a production bundle, so check that `getAdUnitId()` really returns the test IDs. If it doesn't, **do not tap real ads on your own device.**

---

## 3. Android

```bash
pnpm run build:mobile:android
pnpm run cap:sync:android
pnpm --filter @atc-app/mobile open:android
```

In Android Studio, pick an emulator or device and press **Run**.

Command-line alternative (Windows script `dev:android` in root `package.json` uses `gradlew.bat`; on macOS/Linux use):

```bash
cd packages/mobile/android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.atcapp.app/com.atcapp.app.MainActivity
```

### Android logs

JS `console.*` output appears under the `Capacitor/Console` and `chromium` tags, not `AndroidRuntime`. `AndroidRuntime` only shows native crashes.

```bash
adb logcat | grep -E "Capacitor|chromium|AndroidRuntime|RevenueCat"
```

You can also open `chrome://inspect` in desktop Chrome and inspect the WebView for the full DevTools console and network tab.

---

## 4. What a healthy log looks like

Look for these lines on iOS:

```
⚡️  [log] - ✅ Settings loaded
⚡️  To Native ->  StatusBar hide
⚡️  [log] - ✅ RevenueCat initialized successfully
⚡️  [log] - ✅ AdMob initialized (ATT deferred)
⚡️  [log] - ✅ Monetization ready | platform: ios | premium: false ...
```

**Red flags (must not appear):**
| Log line | Meaning |
|---|---|
| `{"code":"UNIMPLEMENTED"}` | A plugin is called but not registered natively. Add it to `packages/mobile/package.json`, then run `pnpm install` and `cap:sync`. |
| `AuthRetryableFetchError`, `status: 0` | Supabase request never reached the server. Check `.env.local`, the Supabase URL, and that `supabase.ts` does not pass a custom `fetch`. |
| `Lock "lock:sb-…-auth-token" was not released` | A side effect of the auth failure above. |
| `Monetization init error` | `ensureAuth()` or another init step threw. Expand the error object when logging it. |
| `Missing VITE_RC_IOS_KEY` | `.env.local` not read at build time. Rebuild. |

---

## 5. Safe to ignore (simulator / system noise)

- `UIScene lifecycle will soon be required` — a warning for now; plan the SceneDelegate migration separately.
- `AddInstanceForFactory`, `Failed to resolve host network app id`, `coretelephony.xpc`
- `RTIInputSystemClient`, the keyboard `NSLayoutConstraint` dump
- `nw_socket_set_connection_idle`, `nw_connection_copy_connected_local_endpoint`
- `Error acquiring assertion` / `RBS assertion 'WebKit Media Playback'`
- `makeImagePlus … 'WEBP' … err=-50` — the simulator's WebP decoder complaining; verify on a real device before treating as a bug
- `Failed to change to usage state`, `Result accumulator timeout`, `Unable to hide query parameters`
- RevenueCat `ASDErrorDomain Code=509 "No active account"` on the simulator

---

## 6. Known item to verify

- `<Google:HTML> 50 required SKAdNetwork identifier(s) missing from Info.plist` means the app was built with the **old** `Info.plist`. Copy the updated `Info.plist` (with the 50 `SKAdNetworkItems`) to `packages/mobile/ios/App/App/Info.plist`, then clean build and run. The message should disappear.
- RevenueCat warning `No packages could be found for offering with identifier web_offering`: this refers to the web offering. Confirm the paywall requests the **default** offering on native, and that it contains a package with `pro_access_unlock`.

---

## 7. Release builds (not for day-to-day testing)

```bash
pnpm ios:release        # needs a Mac, signing set up, App.xcworkspace; produces an archive
pnpm android:bundle     # needs packages/mobile/android/keystore.properties; produces an .aab
```

Release builds use real ad unit IDs and cannot be run directly on a device. Upload the archive or AAB through App Store Connect / Play Console and test it from TestFlight / internal testing. Use the debug flow above for iteration.

---

## 8. Quick troubleshooting

1. Behavior didn't change after a code edit → you skipped `build:mobile:*` or `cap:sync:*`.
2. Plugin error after adding a dependency → `pnpm install`, `cap:sync`, then a clean Xcode build.
3. Blank white screen → open Safari → Develop → _Simulator_ → the app, and read the JS console (iOS), or `chrome://inspect` (Android).
4. Stale native state on the simulator → delete the app from the simulator, or **Device → Erase All Content and Settings**.
5. Still stuck → copy the first `[error]` line in the log, not the whole log.
