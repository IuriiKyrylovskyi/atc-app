# ATC-APP Project — Session Context

## Project Overview

- **Monorepo** managed with `pnpm` workspaces
- **Stack:** Vue 3 + Vite + Vuetify + Pinia + Supabase + Capacitor
- **Platforms:** iOS, Android, Electron (desktop), Web
- **Monetization:** RevenueCat (mobile IAP) + RevenueCat Web Billing with Paddle (web/desktop)
- **Package:** `com.atcapp.app`
- **Current version:** `0.0.76`

---

## Monorepo Structure

```
packages/
  app/          # Vue 3 web app (shared source for all platforms)
  mobile/       # Capacitor wrapper (iOS + Android)
  electron/     # Electron wrapper (desktop)
```

Key files:

- `packages/app/vite.config.ts` — Vite config with platform-aware stubs
- `packages/app/src/stubs/` — web/electron stubs for native-only packages
- `packages/app/src/services/revenueCatService.ts` — RC SDK wrapper
- `packages/app/src/services/adMobService.ts` — AdMob wrapper
- `packages/app/src/stores/monetization.ts` — Pinia store for IAP state
- `packages/app/src/components/monetization/Paywall.vue` — custom paywall UI

---

## Build & Release Commands (correct order)

```bash
# 1. Bump version across all packages + native files + git tag
pnpm run release          # patch (0.0.76 → 0.0.77)
pnpm run release:minor    # minor
pnpm run release:major    # major

# 2. Build Android AAB for Play Store
pnpm run android:bundle

# 3. Build iOS archive for App Store
pnpm run ios:release
# Then upload via Xcode Organizer → Distribute App → App Store Connect

# Or run all three in sequence (macOS only — requires Xcode):
pnpm run release:all        # patch bump + android AAB + ios archive
pnpm run release:all:minor  # minor bump + android AAB + ios archive
pnpm run release:all:major  # major bump + android AAB + ios archive
```

`pnpm run release` auto-runs `scripts/bump-native.js` which syncs the version into `build.gradle` and `project.pbxproj`. Mobile builds must always come AFTER the version bump.

---

## RevenueCat Setup

### RC Dashboard

- **Project:** ATC-APP
- **Offering:** `default_v2` (Display: "ATC-APP Premium_v2") — ✅ set as default (blue circle)
- **Package:** `$rc_lifetime` — "Lifetime unlock"
- **Entitlement ID:** `pro_access` (used in code as `RC_ENTITLEMENT_ID`)
- **Android Product ID:** `lifetime` (Play Console one-time product, purchase option ID: `lifetime`)
- **iOS Product ID:** `pro_access_unlock` (unchanged — Apple doesn't allow renaming)
- **Android:** `lifetime` product Published ✅, attached to `default_v2` package ✅
- **iOS:** `pro_access_unlock` attached to `default_v2` package ✅

### Why `pro_access_unlock` was replaced on Android

The old `pro_access_unlock` product used Play Billing Library 5 format which creates a separate purchase option ID (`pro-access-unlock` with hyphens). This caused RC SDK to return `{ "current": null }` because it could not resolve the product from Play Store. The product ID had to be registered in RC as `pro_access_unlock:pro-access-unlock` (colon format) but RC's form validation rejects colons. A new product `lifetime` with purchase option ID `lifetime` (no special characters) was created to avoid this issue.

The old `pro_access_unlock` Android product still exists in Play Console (cannot be deleted) and RC (kept for iOS) but is no longer attached to the Android slot in the `default_v2` package.

### Vite Stubs (web/electron — non-mobile builds)

Three packages must be aliased to stubs in `vite.config.ts`:

```ts
'@revenuecat/purchases-capacitor'    → src/stubs/revenuecat.stub.ts
'@revenuecat/purchases-capacitor-ui' → src/stubs/revenuecat-ui.stub.ts
'@capacitor-community/admob'         → src/stubs/admob.stub.ts
```

Stubs are applied when `isNative` is false:

```ts
const isNative =
  process.env.CAPACITOR_PLATFORM === 'android' || process.env.CAPACITOR_PLATFORM === 'ios';
```

⚠️ **Critical:** `CAPACITOR_PLATFORM` must be set explicitly in mobile build scripts.
Without it the stubs get bundled and RC silently no-ops on device.
The correct scripts are `build:mobile:android` and `build:mobile:ios` which use
`cross-env CAPACITOR_PLATFORM=android/ios`. Never use bare `pnpm --filter @atc-app/app build`
for mobile targets — it does NOT set `CAPACITOR_PLATFORM`.

---

## Platform Status

### ✅ Android — Working

- ✅ Purchase flow verified on real device (v0.0.76)
- ✅ Product `lifetime` — Active in Play Console, purchase option ID: `lifetime`
- ✅ Product `lifetime` — Created in RC, attached to `pro_access` entitlement
- ✅ `default_v2` offering — `lifetime` set as Android product in `$rc_lifetime` package
- ✅ `minSdkVersion = 24` in `variables.gradle` — matches RC v12 requirement, resolves 0-device Play Console warning
- ✅ RC Capacitor SDK bundled correctly (CAPACITOR_PLATFORM fix applied)
- ✅ `main.ts` double `Purchases.configure()` removed — RC owned by `monetizationStore.init()` only
- ⏳ AdMob under review (2–3 days from last submission)
- [ ] Test purchase flow with License Tester account (Play Console → Setup → License testing)

### ✅ iOS — Working

- ✅ Purchase flow verified on real device (v0.0.76)
- ✅ `pro_access_unlock` IAP attached to `default_v2` package in RC
- ✅ RC Capacitor SDK bundled correctly (CAPACITOR_PLATFORM fix applied)
- [ ] ATT prompt tested on real device via TestFlight
- [ ] Rebuild iOS IPA after ATT screen recording → resubmit to App Store

### Electron / Web — RevenueCat Web SDK + Paddle (pending setup)

- [x] Stripe plumbing removed from the repo (`stripe-webhook` source deleted, `VITE_STRIPE_CHECKOUT_URL` removed). The live `stripe-webhook` function was deleted on 2026-10-25 (task 5.7 in `docs/plans/FIX_PREMIUM.md`)
- [x] `@revenuecat/purchases-js` added; stubbed on native mobile builds via `vite.config.ts`
- [x] `RevenueCatService` web methods added (`initWeb`, `getOfferingsWeb`, `purchasePackageWeb`, `restorePurchasesWeb`, `setAttributes`, `logIn`)
- [x] `monetization.ts` web/electron path rewired to RC Web instead of Stripe redirect
- [x] `Paywall.vue` web/electron path rewired to inline RC Web purchase
- [x] Electron CSP allowlisted for Paddle/RC Web domains
- [ ] Paddle account activated (supports Ukraine without a local entity; Stripe does not)
- [ ] RC dashboard: connect Paddle under Web → Billing, create `lifetime` product + `pro_access` entitlement
- [ ] Paddle: create matching product/price, complete sandbox + domain approval
- [ ] `VITE_RC_WEB_BILLING_PUBLIC_KEY` set in `packages/app/.env.local`
- [x] `revenuecat-webhook` confirmed deployed (sole account-creation path for web purchases)
- [ ] End-to-end Paddle → RC → Supabase flow tested on web + one desktop target

---

## Critical Bugs Fixed (this session)

### 1. RC stubs bundled in mobile release builds

**Root cause:** `build:mobile` set `BUILD_TARGET=mobile`, not `CAPACITOR_PLATFORM`.
`vite.config.ts` only checked `CAPACITOR_PLATFORM` — so stubs were always bundled.
**Fix:** New scripts `build:mobile:android` and `build:mobile:ios` use `cross-env CAPACITOR_PLATFORM=android/ios`.
All mobile build scripts (`android:bundle`, `ios:release`, `android:release`, `dev:android`, `dev:ios`) updated to call these.

### 2. Double `Purchases.configure()` race condition

**Root cause:** `main.ts` called `Purchases.configure()` directly, then `monetizationStore.init()` called it again via `RevenueCatService.initialize()`.
**Fix:** Removed all RC code from `main.ts`. `RevenueCatService.initialize()` is the sole owner.

### 3. `onMounted(presentPaywall)` firing unconditionally

**Root cause:** `Paywall.vue` called `RevenueCatUI.presentPaywall()` on every mount, even when `visible=false` and before RC initialized. Silently returned `NOT_PRESENTED`.
**Fix:** Removed `onMounted` call. Offerings load only when `visible` watcher fires with `true`.

### 4. `handlePrimaryAction` used `presentRCPaywallIfNeeded` (wrong approach)

**Root cause:** `current_offering_id = "default_v2"` has `paywall_components: null` in the API response. `RevenueCatUI.presentPaywall()` returns `NOT_PRESENTED` for offerings without paywall components, then the fallback also failed.
**Fix:** `handlePrimaryAction` now calls `purchasePackage()` directly — standard store sheet, no RC UI dependency.

### 5. `minSdkVersion 23` → Play Console showed 0 supported devices

**Root cause:** RC v12 forces `minSdkVersion 24` at manifest merge. Previous release was lower, so Play Console calculated 0 devices for the new build.
**Fix:** `variables.gradle` `minSdkVersion = 24` — explicit, matches RC requirement.

### 6. `offerings.availablePackages` wrong path

**File:** `Paywall.vue`
**Fix:** `currentPackages` computed reads from `offerings.current.availablePackages` with fallback scanning `offerings.all`.

### 7. `handleStaticPurchase` was synchronous and swallowed result

**File:** `Paywall.vue`
**Fix:** Made `async`, awaits result, surfaces `result.error` into `errorMessage`.

### 8. `@revenuecat/purchases-capacitor-ui` not stubbed

**Fix:** Created `src/stubs/revenuecat-ui.stub.ts` and added alias to `vite.config.ts`.

---

## Pending / Next Steps

1. **Android:** Upload new AAB (v0.0.76) to Play Console → Internal Testing → promote to Closed Testing → Production
2. **Android:** Verify AdMob review completion → test ad display
3. **iOS:** Record ATT prompt screen on real iPhone → attach to App Store Connect submission notes → rebuild and resubmit
4. **Both:** Test full purchase + restore flow with sandbox/license-tester accounts
5. **Paywall debug panel:** Set `showDebugPanel` default to `false` before production release
6. **Electron/Web:** Activate Paddle account → connect Paddle under RC dashboard → Web → Billing → deploy `revenuecat-webhook` → test end-to-end
7. **Supabase:** Apply `user_scores` migration (Step 2b in `SUPABASE_SETUP.md`) to the
   production project so the new sync path has a table to write to
8. **Supabase:** Deploy `delete-account` Edge Function (referenced in `supabase/functions/`)
   and wire it to the account-deletion UI

---

## Environment Variables Required

```env
# packages/app/.env.local
VITE_RC_IOS_KEY=appl_ApnKort...         # RevenueCat iOS API key
VITE_RC_ANDROID_KEY=goog_yvzNoxZ...     # RevenueCat Android API key
VITE_RC_WEB_BILLING_PUBLIC_KEY=...      # RevenueCat Web Billing public key (Paddle)
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_ADMOB_INTERSTITIAL_ID_ANDROID=ca-app-pub-.../...
VITE_ADMOB_INTERSTITIAL_ID_IOS=ca-app-pub-.../...
ADMOB_APP_ID_ANDROID=ca-app-pub-...~...   # NO VITE_ prefix — read by capacitor.config.ts
ADMOB_APP_ID_IOS=ca-app-pub-...~...       # NO VITE_ prefix — read by capacitor.config.ts
```

Env file location: `packages/app/.env.local`

---

## Per-Level Max Planes Persistence (v0.0.86)

### Schema

`SUPABASE_SETUP.md` Step 2b — `public.user_scores` table:

| Column       | Type        | Notes                                           |
| ------------ | ----------- | ----------------------------------------------- |
| `id`         | uuid        | PK, FK → auth.users, also the RLS user id       |
| `level_id`   | text        | e.g. `KSDM:daylight-delivery`, `KSDM:endless`   |
| `max_planes` | int         | best plane count, non-decreasing (RLS enforces) |
| `opened`     | boolean     | true once the level has been played             |
| `available`  | boolean     | true once the tier-unlock chain reaches it      |
| `updated_at` | timestamptz | last sync time                                  |

Unique constraint `(id, level_id)`. Three RLS policies: select own, insert own,
update own with `max_planes >= server value` (defends against tampered clients
lowering their best to cheat).

### Store

`packages/app/src/stores/userScores.ts` — `useUserScoresStore`:

- `loadFromServer()` — fetch on first launch via `monetizationStore.init()`
- `recordResult(levelId, maxPlanes)` — merge into local state, `opened` sticky
- `markAvailable(levelId)` — tier-unlock chain reached this level
- `flush()` — upsert only rows whose local value exceeds the server snapshot
  (a lower local run is silently dropped, never sent)

### Wiring

- `monetization.ts:240` — `await useUserScoresStore().loadFromServer()` inside `init()`
- `game.ts:192` — `completeLevel()` calls `recordResult(level.id, this.planesLanded)`
- `game.ts:226` — `completeLevel()` fires `flush()` (fire-and-forget)
- `App.vue` — `onBeforeUnmount` + Capacitor `appStateChange` listener both call `flush()` so a completed run survives app backgrounding
- `useStrips.ts:95` — `syncAvailability()` populates `available` for every
  currently-reachable shift on the airport page (guarded per airport)

### Sync rules

- **Receive on first launch** — `loadFromServer()` runs in `monetizationStore.init()`
- **Send on shift complete** — `flush()` from `game.ts.completeLevel()`
- **Send on app close** — `flush()` from `App.vue` unmount + native background
- **Never downgrade** — local merge uses `Math.max`, server RLS update policy
  enforces non-decreasing `max_planes`, and `flush()` only sends rows whose
  local value exceeds the server snapshot

---

## Anonymous Premium Key + Cross-Device Restore (v0.0.86)

### Problem

Supabase anonymous `user.id` is device-local, so a purchase confirmed on
device A is invisible to device B's anonymous id. The user must be able to
carry their paid status + progress across devices **without sharing any email
or personal data**.

### Design

A stable 8-char uppercase alphanumeric `alias` (public handle, shown on the
leaderboard) plus a private 12-char `password` (shown once, never exposed
publicly) are generated server-side in the `handle_new_user` trigger
(`generate_alias()` / `generate_password()`) and stored in `profiles`.
After purchase both are shown to the user (copyable) and the alias is displayed
in the top-right of the main page as proof the paid account is "accepted" on
that device.

### Restore flow

1. New Edge Function `supabase/functions/restore-key/index.ts` (service role —
   bypasses RLS). Input `{alias, password, currentUserId}`. It calls the
   server-side `restore_account(alias, password, current_user_id)` RPC, which
   verifies BOTH alias and password match a premium row, then upserts
   `profiles[currentUserId]` with `is_premium=true, alias=alias` and copies every
   `user_scores` row from the alias-user onto `currentUserId` (merging on
   conflict with `greatest()`).
2. `monetizationStore.restoreAccount(alias, password)` — client wrapper.
3. `App.vue` shows the restore modal **once on first launch** when an alias +
   password were saved locally but this device's anonymous id is not premium
   yet. "Not now" / "Continue free play" is allowed; the modal never blocks free
   users.
4. `Paywall.vue` — after purchase, a "YOUR ACCOUNT ALIAS" + "YOUR RECOVERY
   PASSWORD" block (both copyable) with the "no email" privacy note. Below the
   "Restore previous purchase" button a divider + alias input (live availability
   probe from the 3rd char) + password input lets a user paste both from
   another device at any time.
5. `MainScreen.vue` — top-right `💎 PAID <ALIAS>` badge while premium.

### Silent cross-device restore via RevenueCat

The alias is also used as a stable RevenueCat `appUserID`, so the purchase
itself survives across devices without any manual paste:

- After purchase, `RevenueCatService.logIn(password)` re-binds RC to the stable
  identity (instead of the device-local anonymous id).
- On first launch, `init()` reads the locally-stored alias+password and passes
  the **password** to `initRevenueCat(uid, password)` before any other sync — RC
  restores the purchase silently.
- Only if RC restore + server sync still leaves the device non-premium does
  the manual restore modal appear (the purchase is on a different RC customer
  id).
- `restorePurchases()` and `restoreAccount()` also call `logIn(password)` on
  success.
- `syncFromServer()` binds `logIn(password)` again as soon as the server returns
  the password (it is generated server-side and only arrives via the webhook).

**⚠️ The RC `appUserID` must be the PRIVATE password, never the public alias.**
The alias appears on the leaderboard, so anyone who guesses it could otherwise
restore the purchase. The password is never exposed publicly, so it is safe to
use as the RC customer id. This is the single security-critical detail of the
whole flow — binding RC to the alias would let anyone read the leaderboard and
steal premium access.

This makes new-device setup frictionless while keeping the no-email guarantee:
RC owns the purchase identity, and the alias+password pair is the fallback.

### Why alias + password (not alias alone)

The alias is a **public handle** — it appears on the leaderboard, so anyone can
see it. Pastes of an alias alone therefore grant nothing; only the password
proves ownership. This is what stops user B from impersonating by guessing an
alias. The `restore_account` RPC requires both.

### Leaderboard

`get_leaderboard(limit)` RPC (security definer) — public read, returns
`alias, is_premium, max_score`. The `password` column is deliberately excluded.
`packages/app/src/views/LeaderboardScreen.vue` renders it; route `/leaderboard`
is reachable from the main menu. Anyone (free or paid) can view it without
authenticating.

### Incorrect alias / local logout

If the server responds `not_found` (alias/password pair does not belong to any
paid account) the client calls `monetizationStore.logoutLocally()` — it clears
`isPremium`, the alias, the password, and all `user_scores` local state, but
**sends nothing to the server** (no downgrade, no data leak). The input shows a
red border and the "No user found, check your spelling" message until the user
re-enters.

### Live alias availability probe

`check_alias_availability(candidate)` RPC (security definer, reads other users'
aliases). Exact-match only — `111` and `1111` are distinct aliases and never
conflict. Starts from the 3rd character; the first two keep a default border.

### Choosing your own alias

`set_alias(current_user_id, candidate)` RPC (security definer, enforces
uniqueness across other users' rows). Exact-match only — `111` and `1111` are
distinct aliases and never conflict. The alias alone never grants access (only
the password does), so name squatting is harmless. Changing the alias does not
invalidate the password, so restore still works via the new alias.
`monetizationStore.setAlias(candidate)` is the client wrapper; the paywall
exposes a "choose your own alias" input below the purchase block, available to
free and premium users alike.

### Free users

No alias or password is ever shown (no purchase), the restore modal never
appears, and `loadFromServer()`/`flush()` are gated on `isPremium` so free users
never read from or write to the server. Their scores stay local-only.

### Costs

No additional Supabase cost: one nullable `alias` + one nullable `password`
column on `profiles`, two RPCs + one Edge Function (free tier covers 5M
invocations), no new RevenueCat work.

---

## Close / EXIT flow

The single owner of "close the app" is
`packages/app/src/composables/useAppClose.ts`. Both exit affordances route
through it:

- the red **EXIT strip** → `StripPage.vue` → `exitPlay` → `requestClose()`
- the splash-screen **✕** → `IntroScreen.vue` → `quitApp` → `requestClose()`

### Per-platform behaviour

| Runtime  | What happens                                                          | Why                                                                                                      |
| -------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Android  | `App.exitApp()` → `activity.finish()` → the app quits                 | `AppPlugin.java:72-76`                                                                                   |
| Electron | `window.electronAPI.closeApp()` → `mainWindow.close()` + `app.quit()` | `packages/electron/src/main.ts`                                                                          |
| iOS      | goodbye overlay, the user swipes the app away                         | `AppPlugin.swift:78` is `call.unimplemented()`; Apple forbids programmatic termination (Guideline 2.2.5) |
| Web      | **no EXIT affordance at all**                                         | a browser tab cannot be closed by script unless the script opened it                                     |

Runtime detection lives in `packages/app/src/utils/platform.ts`
(`detectRuntime()` / `isPlainWeb()`). The **Electron check runs first**:
`Capacitor.getPlatform()` also reports `'web'` inside Electron, and Electron is
the one `'web'` runtime that can genuinely terminate.

### State machine

`idle → confirm → closing → closed | error`, with the state held in
**module-level refs** inside `useAppClose.ts` (not inside the composable
instance) because the overlay is rendered once, globally, by `App.vue` while
the EXIT strip and the ✕ live in different components.

- `confirm` — a styled in-app modal (replaced the native `window.confirm`,
  which froze the Electron renderer and could not be styled). Shown only when a
  level is live.
- `closing` — the blocking overlay. The score flush can take up to **15 s**, so
  every user action is blocked meanwhile: the overlay is a fixed, full-viewport
  layer at `z-index: 100000` with `touch-action: none`, the Phaser scene is
  paused, `game.input.enabled = false`, keydown/keyup are swallowed at the
  capture phase, and the Android hardware back button is ignored.
- `closed` — the iOS goodbye overlay.
- `error` — the close did not work. A 2.5 s watchdog turns a silently-failed
  close into a visible error with "Try again" / "Cancel". Cancel restores the
  player to a **paused** level with the normal PauseModal.

### The `beforeunload` guard must be cleared before terminating

`useUnloadGuard.ts` owns the "leave site?" warning that protects a running
level. Electron's `mainWindow.close()` runs the renderer's `beforeunload`, and a
handler that calls `preventDefault()` **cancels the close** and pops a native
dialog instead of quitting. `startClose()` therefore calls `clearUnloadGuard()`
before terminating.

### Other invariants

- The **play session is released** before terminating. `activity.finish()` never
  fires `appStateChange`, so without this the user's other device stays locked
  out for the full session TTL.
- The 15 s flush cap is deliberate: the `userScores` store is **memory-only**
  (no localStorage persistence), so a flush that never completes loses the run's
  best plane count for good.
- The `@capacitor/app` stub for web/Electron **rejects** on `exitApp()`. A
  silently-resolving stub left the user stuck on the "Closing ATC-APP…"
  overlay forever — which is exactly what happened before, whenever the stub
  was accidentally bundled into a mobile build (`CAPACITOR_PLATFORM` unset).

### Hiding EXIT on web without breaking the layout

The right columns are position-sensitive and full (9 desktop / 14 portrait /
9 landscape). The EXIT strip therefore stays in the array and is hidden with
`isVisible: false` — `.strip` is only `visibility: hidden`, so it keeps its
flex box, and a hidden strip never "settles", which auto-disables its click
handler (every handler is gated on `isSettled(i)`).

`mainPage.ts` hands EXIT's slot to HOME when EXIT is hidden, so the column
does not open a visible gap at the top. The column **length never changes** —
`stripWidth(i)` derives the taper from `column.length`.
