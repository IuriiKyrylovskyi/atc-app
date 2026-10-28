# SYNC_VERS.md: versions that must stay in sync

Last verified: 2026-10-07. Update this file in the same commit as any change to a version below.

**Golden rule:** change one dependency family at a time, run the checks at the bottom, and commit before touching the next. Do not mix a RevenueCat, Capacitor and Xcode change in one build.

---

## 1. Version table

### Capacitor family (all must be the same major, ideally the same minor)

| Package                         | Version | Where        |
| ------------------------------- | ------- | ------------ |
| `@capacitor/core`               | 7.4.4   | app, mobile  |
| `@capacitor/ios`                | 7.4.4   | mobile       |
| `@capacitor/android`            | 7.4.4   | mobile       |
| `@capacitor/cli`                | 7.4.4   | mobile (dev) |
| `@capacitor/app`                | 7.1.0   | app, mobile  |
| `@capacitor/screen-orientation` | 7.0.4   | app, mobile  |
| `@capacitor-community/admob`    | 7.2.0   | app, mobile  |
| `@capacitor/network`            | 7.4.4   | app, mobile  |
| `@capacitor/haptics`            | 7.0.5   | app          |
| `@capacitor/filesystem`         | 7.1.8   | app          |
| `@capacitor/status-bar`         | 7.0.6   | app          |

**Resolved 2026-10-07:** `pnpm -r why @capacitor/core` shows a single copy, 7.4.4, in `app` and `mobile`. core, ios, android and cli are all 7.4.4, and `Podfile.lock` links `Capacitor (7.4.4)` / `CapacitorCordova (7.4.4)`. The last commit already had core/ios/android at 7.4.4; the only change made on 2026-10-07 was aligning the CLI from 7.6.9 to 7.4.4 and replacing `^` ranges with exact pins. Some earlier outputs showed 7.6.9 (cause not determined); the simulator run and the pods use 7.4.4.

**Rule: all `@capacitor/*`, `@capacitor-community/*` and `@revenuecat/purchases-capacitor` dependencies are exact pins (no `^`, no `~`) in both `package.json` files.** The versions in the table are the pins. To move to 7.6.9 or any other version, change it in one commit, run `cap sync` and `pod install`, and re-test the purchase on TestFlight.

**Do not upgrade to Capacitor 8 casually.** It changes the Android status bar and edge-to-edge behaviour, adopts the UIScene lifecycle, and needs its own branch and full test pass. Plugins at 8.x need Capacitor 8.

### RevenueCat / purchases

| Package / SDK                        | Version               | Rule                                                    |
| ------------------------------------ | --------------------- | ------------------------------------------------------- |
| `@revenuecat/purchases-capacitor`    | **11.3.2, exact pin** | the same version in `app` and `mobile`, one copy only   |
| `@revenuecat/purchases-capacitor-ui` | **removed**           | its 11.x depends on the 10.x base plugin; do not re-add |
| `@revenuecat/purchases-js`           | 1.66.0                | web/desktop only, stubbed on mobile                     |
| RevenueCat iOS SDK                   | 5.51.1                | comes with the plugin (seen in console)                 |
| Google Play Billing                  | 8.0.0                 | must stay at 8.x or higher (Play Console rejects 7.x)   |

- 11.x accepts Capacitor `>=7`. **13.x requires Capacitor `>=8`**, so stay on 11.x until the Capacitor 8 migration.
- Billing 8 cannot restore consumed one-time products. `pro_access_unlock` / the Play `lifetime` product must be **non-consumable**.

### Other runtime and tooling

| Tool                    | Version    | Note                                                                                    |
| ----------------------- | ---------- | --------------------------------------------------------------------------------------- |
| Node                    | 22.21.0    |                                                                                         |
| TypeScript              | 5.9.3      |                                                                                         |
| Vite                    | 5.4.20     |                                                                                         |
| Vue                     | 3.5.22     |                                                                                         |
| `vue-tsc`               | 1.8.27     | **broken with TS 5.9** ("Search string not found"); needs 3.x, fix in a separate branch |
| `@supabase/supabase-js` | 2.98.0     |                                                                                         |
| iOS deployment target   | 16.6       |                                                                                         |
| Xcode / iOS SDK         | iOS 26 SDK | simulator 26.0.1                                                                        |

---

## 2. App version and build numbers

One source of truth: the root `package.json` `version` (currently 0.0.116).

| Platform | Field                           | Rule                                                                             |
| -------- | ------------------------------- | -------------------------------------------------------------------------------- |
| iOS      | Version (MARKETING_VERSION)     | equals root version                                                              |
| iOS      | Build (CURRENT_PROJECT_VERSION) | integer, higher than every build in App Store Connect (TestFlight), never reused |
| Android  | `versionName`                   | equals root version                                                              |
| Android  | `versionCode`                   | integer, higher than the last Play upload (last seen: 111)                       |

Next iOS build: **116**. Build 105 was archived on 2026-10-05 with the broken `Info.plist` (no `UIMainStoryboardFile`); do not use it.

---

## 3. "If you change X, also change Y"

| Change                                   | Also do                                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Any web/Vue code                         | `pnpm run build:mobile:ios` then `cap sync` before every archive (`ios:release` does both)                                               |
| Any Capacitor plugin                     | `cap sync`, `pod install`, run on the simulator, re-test the purchase on TestFlight                                                      |
| `@capacitor/network` plugin     | `cap sync`, `pod install`, run on the simulator, re-test the purchase on TestFlight |
| RevenueCat plugin version                | the same exact version in `app` and `mobile`, `pnpm -r why @revenuecat/purchases-capacitor` shows one copy, check `billing:8.x` and pods |
| App version                              | root `package.json`, Xcode Version/Build, Android versionName/versionCode                                                                |
| `capacitor.config.ts`                    | `cap sync` (it regenerates `ios/App/App/capacitor.config.json` and the Android copy, never edit those)                                   |
| Product or offering in RevenueCat        | App Store Connect IAP, Play product, `RC_ENTITLEMENT_ID` (`pro_access`), product id `pro_access_unlock`                                  |
| Supabase `accounts` / `profiles` columns | the `revenuecat-webhook` function and the `claim_account` / `syncFromServer` code                                                        |

---

## 4. Files that must keep specific content

- `packages/mobile/ios/App/App/Info.plist` must contain `UIMainStoryboardFile` = `Main` and `UIMainStoryboardFile~ipad` = `Main` (without them: black screen, no WebView). Also keep `UILaunchStoryboardName`, `GADApplicationIdentifier`, `NSUserTrackingUsageDescription`.
- `Assets.xcassets/Splash.imageset` must have images assigned to its slots (the launch screen uses `Splash`).
- `Paywall.vue`: the debug badge and panel are behind `DEBUG_ENABLED` (`VITE_SHOW_DEBUG === 'true'`). **Never set `VITE_SHOW_DEBUG` in any `.env` file or build script that ships.**
- Do **not** click Xcode's "Update to recommended settings". It rewrites signing and architecture settings on every pod. Do it only on its own branch, with its own test pass.

---

## 5. Pre-release checklist

```
# 1. versions
pnpm -r ls @capacitor/core @capacitor/ios @capacitor/android @capacitor/cli --depth 0
pnpm -r why @revenuecat/purchases-capacitor        # one copy, 11.3.2
grep -rn "VITE_SHOW_DEBUG" packages --include='.env*' --exclude-dir=node_modules   # no output

# 2. build
pnpm run build:mobile:ios
grep -rl "Paywall Debug" packages/app/dist          # no output
plutil -lint packages/mobile/ios/App/App/Info.plist
/usr/libexec/PlistBuddy -c "Print :UIMainStoryboardFile" packages/mobile/ios/App/App/Info.plist   # Main

# 3. native
pnpm --filter @atc-app/mobile exec cap sync
(cd packages/mobile/android && ./gradlew :app:dependencies | grep -i billing)   # billing:8.x
```

Then: set Version/Build, run `pnpm run ios:release`, upload, install from TestFlight, and test on a fresh install with a new sandbox account:

1. Paywall loads, with no DEBUG badge.
2. Purchase completes, premium persists after relaunch, `levels_full.json` downloads.
3. Restore Purchases works.
4. Webhook event in RevenueCat shows an action other than `no_match`.

---

## 6. Known open issues (2026-10-07)

- **Webhook `no_match`:** `revenuecat-webhook` returns `{"success":true,"action":"no_match"}` for the iPhone sandbox purchase (RC App User ID `PHONE23456789`). It looks up `accounts` by `rc_customer_id` / `password`, finds nothing, and exits quietly. Premium is read from Supabase `is_premium`, so such a purchase does not unlock. Not fixed yet.
- RevenueCat App User ID format differs between flows (UUID in the simulator, `PHONE...` on the iPhone). Decide one format and normalise it in one place.
- Offering `web_offering` has no packages on iOS (RevenueCat warning). Clean it up in the dashboard.
- AdMob: `Info.plist` has no `SKAdNetworkItems` (Google logs "50 required SKAdNetwork identifier(s) missing").
- `vue-tsc` 1.8.27 crashes with TypeScript 5.9.3.
- 176 changes were uncommitted before the 2026-10-07 refactor; the work lives on branch `wip-refactor`.
- Apple: Guideline 5.6 suspension for com.atcapp.app, appeal not yet sent. Name the real iOS build in the appeal (the 2 Oct message cited 0.0.104, which was never uploaded).
