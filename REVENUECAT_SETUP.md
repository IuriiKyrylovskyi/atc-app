# 💳 ATC-APP — RevenueCat + App Store Setup Guide

> How to get real API keys and wire up native purchases for iOS and Android.
> Follow after `SUPABASE_SETUP.md` is complete.

---

## Current Status

| Step                                           | Status     | Notes                                                                 |
| ---------------------------------------------- | ---------- | --------------------------------------------------------------------- |
| Apple Developer account                        | ✅ Done    |                                                                       |
| Bundle ID registered                           | ✅ Done    |                                                                       |
| App created in App Store Connect               | ✅ Done    |                                                                       |
| In-App Purchase Key (.p8) generated            | ✅ Done    | Uploaded to RC                                                        |
| `pro_access_unlock` IAP created (Apple)        | ✅ Done    | "Developer Action Needed" — needs binary submission with IAP          |
| RC project created                             | ✅ Done    |                                                                       |
| `pro_access` entitlement created               | ✅ Done    |                                                                       |
| iOS App added to RC                            | ✅ Done    |                                                                       |
| `VITE_RC_IOS_KEY` set                          | ✅ Done    | `packages/app/.env.local`                                             |
| Webhook configured and verified                | ✅ Done    | Supabase logs confirm `200 OK`                                        |
| AAB built and signed                           | ✅ Done    | v0.0.62 via `pnpm android:bundle`                                     |
| Internal testing track released                | ✅ Done    | v0.0.60 released Apr 15                                               |
| Google Payments merchant account               | ✅ Done    | Payment method added                                                  |
| Store listing created                          | ✅ Done    |                                                                       |
| Testers added                                  | ✅ Done    |                                                                       |
| Google Cloud service account JSON              | ✅ Done    | Uploaded to RC                                                        |
| Android App added to RC                        | ✅ Done    | Google Cloud service account, Pub/Sub + APIs enabled                  |
| `VITE_RC_ANDROID_KEY` set                      | ✅ Done    | `packages/app/.env.local`                                             |
| `pro_access_unlock` IAP (Android)              | ✅ Done    | Active, 173 regions — kept for reference, replaced by `lifetime`      |
| `lifetime` IAP created (Android)               | ✅ Done    | Active, Play Console one-time product, purchase option ID: `lifetime` |
| `lifetime` linked to `pro_access` entitlement  | ✅ Done    | RC Product catalog → lifetime → attached to pro_access                |
| RC Offering `default_v2` set as default        | ✅ Done    | Blue circle in RC Offerings list                                      |
| `default_v2` package uses `lifetime` (Android) | ✅ Done    | iOS still uses `pro_access_unlock`                                    |
| Sandbox tester created (Apple)                 | ✅ Done    |                                                                       |
| IAP review screenshot (Apple)                  | ✅ Done    | Status: Ready to Submit                                               |
| App Privacy Nutrition Label                    | ✅ Done    | Published — User ID, Device ID, Purchases, Product Interaction        |
| Privacy policy URL                             | ✅ Done    | https://iuriikyrylovskyi.github.io/atc-app-privacy/                   |
| Rebuild with `lifetime` Android product        | ⏳ Next    | `pnpm run android:bundle` → upload to Play Console → test             |
| Test purchase flow (Android)                   | ⏳ Pending | After new AAB installed via Play Store internal testing               |
| iOS — upload binary + attach IAP to submission | ⏳ Pending | Required by Apple before IAP can be reviewed                          |
| Test purchase flow (iOS)                       | ⏳ Pending | After iOS binary submitted and sandbox approved                       |

---

## Overview

The purchase flow has four actors:

```
App Store / Google Play  →  RevenueCat  →  Supabase webhook  →  profiles.is_premium
     (processes payment)      (validates)      (updates DB)
```

RevenueCat is the orchestrator: it talks to both App Stores on your behalf and fires a webhook to your Supabase Edge Function when a purchase is confirmed. You never handle raw App Store receipts yourself.

---

## Part 1 — Apple App Store (iOS)

### 1a. Create the In-App Purchase product

1. Log in to [App Store Connect](https://appstoreconnect.apple.com)
2. Select your app → **Monetization → In-App Purchases**
3. Click **(+)** → select **Non-Consumable** (one-time purchase, owned forever)
4. Set:
   - **Reference Name:** `Full Game Unlock`
   - **Product ID:** `pro_access_unlock` — note this exactly, it must match RC
5. Fill in pricing, localised name/description, and screenshot
6. **Important:** Apple requires the IAP to be submitted together with the first app binary — you cannot submit the IAP alone

### 1b. Generate the In-App Purchase Key for RevenueCat

RevenueCat needs a `.p8` key to securely communicate with Apple.

1. App Store Connect → top nav → **Users and Access**
2. Click **Integrations** tab → **In-App Purchase** in the left sidebar
3. Click **(+)** → name it `RevenueCat Key`
4. **Download the `.p8` file immediately** — Apple only lets you download it once
5. Copy and save:
   - **Issuer ID** (shown at the top of the page)
   - **Key ID** (shown next to your new key)

---

## Part 2 — Google Play (Android)

### 2a. Create the In-App Product

> **Note:** The current active Android product is `lifetime` (not `pro_access_unlock`).
> `pro_access_unlock` exists but is kept inactive — do not delete it as Play Console doesn't allow deletion.

1. Log in to [Google Play Console](https://play.google.com/console)
2. Select your app → **Monetize → One-time products**
3. Click **Create one-time product**
4. Set:
   - **Product ID:** `lifetime` (simple, no underscores or hyphens)
   - **Name:** `ATC-APP Full Game`
   - **Description:** `Unlock all airports and levels`
   - **Age rating:** 13+
5. On step 2 (Availability and pricing):
   - **Purchase option ID:** `lifetime`
   - **Purchase type:** Buy
   - Click **Set prices** → set your price → Google fills all regions
6. Set status to **Active**

> ⚠️ **Play Billing Library 5 format:** Play Console now creates products with a purchase option ID separate from the product ID. The full identifier RC may need is `productId:purchaseOptionId` (e.g. `lifetime:lifetime`). If RC shows `current: null` after setup, check if the product needs to be entered as `lifetime:lifetime` in RC's product catalog.

### 2b. Generate the Google Cloud Service Account

Google requires a service account so RevenueCat can verify receipts.

1. Go to [Google Cloud Console](https://console.cloud.google.com) (same Google account as Play Console)
2. **IAM & Admin → Service Accounts → + Create Service Account**
3. Name it `revenuecat-server`, skip granting roles, click **Done**
4. Click your new service account → **Keys** tab → **Add Key → Create new key → JSON**
5. **Download the `.json` file** — keep it safe

### 2c. Link the Service Account to Play Console

1. Google Play Console → **Setup → API Access**
2. Find your new service account → click **Grant Access**
3. Under **Financial Data**, check:
   - ✅ View financial data
   - ✅ Manage orders and subscriptions
4. Click **Invite User** to save

---

## Part 3 — RevenueCat Dashboard

### 3a. Create a RevenueCat account

Sign up at [app.revenuecat.com](https://app.revenuecat.com). Free tier covers everything you need.

### 3b. Create a Project

**Projects → + New Project** → name it `ATC-APP`

### 3c. Add your iOS App

1. Project Settings → **Apps → + New App → App Store**
2. Enter your **Bundle ID** (`com.atcapp.app`)
3. Upload your `.p8` key, enter Key ID and Issuer ID
4. Copy the **iOS Public API Key** → paste into `VITE_RC_IOS_KEY`

### 3d. Add your Android App

1. Project Settings → **Apps → + New App → Play Store**
2. Enter package name: `com.atcapp.app`
3. Upload the Google Cloud service account `.json`
4. Copy the **Android Public API Key** → paste into `VITE_RC_ANDROID_KEY`

### 3e. Create Entitlement

1. Left sidebar → **Entitlements → + New**
2. **Identifier:** `pro_access` — this must match `RC_ENTITLEMENT_ID` in `revenueCatService.ts`
3. Save

### 3f. Create Products in RC

**Android:**

- Product catalog → Products → ATC-APP (Play Store) → + New
- **Google product identifier:** `lifetime`
- **Type:** Non-consumable
- Save → Attach to `pro_access` entitlement

**iOS:**

- Product catalog → Products → ATC-APP (App Store) → + New
- **Apple product identifier:** `pro_access_unlock`
- **Type:** Non-consumable
- Save → Attach to `pro_access` entitlement

### 3g. Create Offering and Package

1. Left sidebar → **Offerings → + New Offering**
2. **Identifier:** `default_v2`, **Display Name:** `ATC-APP Premium_v2`
3. Click **⋯ → Make Default** so it becomes `offerings.current` in the SDK
4. Click into `default_v2` → **+ New Package**
5. **Identifier:** `$rc_lifetime` (built-in lifetime identifier)
6. **Description:** `Lifetime unlock`
7. Attach products:
   - ATC-APP (Play Store): `lifetime`
   - ATC-APP (App Store): `pro_access_unlock`
8. Save

### 3h. Get your API Keys

1. Project Settings → **API Keys**
2. Copy:
   - **iOS:** `appl_xxxx...` → paste into `VITE_RC_IOS_KEY` in `packages/app/.env.local`
   - **Android:** `goog_xxxx...` → paste into `VITE_RC_ANDROID_KEY`

---

## Part 4 — Connect the Webhook (completes the loop)

> You should already have your Supabase webhook URL from `SUPABASE_SETUP.md` Step 4.

1. RevenueCat → **Project Settings → Integrations → Webhooks → + New Webhook**
2. Set:
   - **Endpoint URL:** `https://YOUR_PROJECT_REF.supabase.co/functions/v1/revenuecat-webhook`
   - **Authorization header value:** the `REVENUECAT_WEBHOOK_SECRET` you set in Supabase secrets
3. Enable at minimum these event types:
   - ✅ `INITIAL_PURCHASE`
   - ✅ `RENEWAL`
   - ✅ `CANCELLATION`
   - ✅ `EXPIRATION`
   - ✅ `UNCANCELLATION`
4. Save → click **Send Test** → confirm `200 OK`

---

## Part 5 — Test in Sandbox

### Android Test Purchases

1. Play Console → Internal Testing → **Testers tab → Copy opt-in link**
2. Open that link on the physical device → tap **"Become a tester"**
3. Install the app **from the Play Store** (NOT via adb or direct APK — Play Billing is disabled for sideloaded apps)
4. Open the app → tap **Purchase Full Game**
5. Verify `profiles.is_premium = true` in Supabase

### iOS Sandbox

1. App Store Connect → **Users and Access → Sandbox Testers → + New Tester**
2. On your test device: **Settings → App Store → Sandbox Account** → sign in
3. Run from Xcode on the device (NOT simulator — StoreKit doesn't work on simulator)
4. Complete the sandbox purchase (no real money charged)
5. Check Supabase `profiles` table — `is_premium` should update to `true`

---

## Part 6 — Update `.env.local` with Real Keys

```env
VITE_SUPABASE_URL=https://abcdefghij.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...

VITE_RC_IOS_KEY=appl_AbCdEfGhIjKlMnOpQrStUvWxYz
VITE_RC_ANDROID_KEY=goog_AbCdEfGhIjKlMnOpQrStUvWxYz
VITE_RC_WEB_BILLING_PUBLIC_KEY=YOUR_PADDLE_PUBLIC_API_KEY
```

---

## Apple Review — Rejection Notes (v1.0.0, March 2026)

Three issues rejected by Apple on iPad Air M3 / iPadOS 26.3.1:

**3.1.1 — "Licence codes" (external payment bypass)**

- Root cause: `detectPlatform()` used `window.Capacitor` which can be undefined during early boot → returned `'web'` on real device → Stripe branch ran → showed "Complete your purchase in the browser" → Apple flagged it
- Fix applied: `detectPlatform()` now uses `Capacitor.isNativePlatform()`. Added double safety guard in `purchase()` so Stripe path is impossible on any native platform

**2.1(b) — Sandbox purchase sheet didn't appear**

- Root cause: `RevenueCatService.purchasePackage()` was calling `Purchases.purchaseStoreProduct()` which bypasses RC's offering attribution and silently fails to open StoreKit sheet on iOS
- Fix applied: Changed to `Purchases.purchasePackage({ aPackage: pkg })` — the correct RC Capacitor SDK API

**2.1 — ATT prompt not appearing**

- Root cause: `requestTrackingTransparency()` called `AdMob.initialize({ requestTrackingAuthorization: true })` a second time — SDK ignores duplicate `initialize()` calls
- Fix applied: Now calls `AdMob.requestTrackingAuthorization()` directly
- Before resubmitting: record ATT screen on real iPhone and attach to App Review Information → Notes

---

## Troubleshooting

| Symptom                                                     | Cause                                                                        | Fix                                                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `offerings.current` is null, `{ "current": null }` returned | Android product ID mismatch — Play Billing can't resolve the product         | Use a simple product ID with no underscores/hyphens (e.g. `lifetime`). Rebuild and redeploy.               |
| `offerings.current` is null after product change            | Old build cached. RC fetches live but Play Store resolution requires rebuild | Run `pnpm run android:bundle`, upload new AAB, reinstall from Play Store                                   |
| App installed via adb — purchase never works                | Play Billing disabled for sideloaded apps                                    | Always install via Play Store internal testing opt-in link                                                 |
| RC `getOfferings()` returns null entirely                   | RC not initialized before call, or stub bundled instead of real SDK          | Ensure `BUILD_TARGET=mobile` or `CAPACITOR_PLATFORM` is set in build script so Vite doesn't alias to stubs |
| `PurchasesError: product not found`                         | Product ID mismatch or not yet Active in store                               | Confirm product ID matches RC and status is Active in Play Console                                         |
| StoreKit sheet never appears on iOS                         | `purchaseStoreProduct` bypasses RC offering attribution                      | Use `Purchases.purchasePackage({ aPackage: pkg })` — already fixed                                         |
| Sandbox purchase succeeds but webhook fires 401             | Authorization header mismatch                                                | Ensure RC webhook auth header exactly matches `REVENUECAT_WEBHOOK_SECRET`                                  |
| `is_premium` doesn't update after purchase                  | Webhook not configured                                                       | Check RC → Webhooks → Recent Deliveries for errors                                                         |
| ATT prompt not appearing on device                          | Double `initialize()` call                                                   | Use `AdMob.requestTrackingAuthorization()` directly — already fixed                                        |
| App rejected 3.1.1 "licence codes"                          | `detectPlatform()` returns `'web'` on native                                 | Use `Capacitor.isNativePlatform()` — already fixed                                                         |
| iOS IAP "Developer Action Needed"                           | Apple requires IAP submitted with first app binary                           | Upload iOS binary → add IAP to version → submit for review                                                 |

---

## Summary: What Goes Where

| Key                         | File                           | Notes                                           |
| --------------------------- | ------------------------------ | ----------------------------------------------- |
| `VITE_RC_IOS_KEY`           | `packages/app/.env.local`      | From RC dashboard → API Keys → iOS              |
| `VITE_RC_ANDROID_KEY`       | `packages/app/.env.local`      | From RC dashboard → API Keys → Android          |
| `REVENUECAT_WEBHOOK_SECRET` | Supabase Edge Function secrets | String you chose in `SUPABASE_SETUP.md` Step 4b |
| Apple `.p8` file            | RC dashboard only              | Never in your codebase                          |
| Google `.json` file         | RC dashboard only              | Never in your codebase                          |
| Android Product ID          | RC + Play Console              | `lifetime`                                      |
| iOS Product ID              | RC + App Store Connect         | `pro_access_unlock`                             |
| Entitlement ID              | RC + `revenueCatService.ts`    | `pro_access`                                    |
| RC Offering identifier      | RC dashboard                   | `default_v2` (set as default)                   |
| RC Package identifier       | RC dashboard                   | `$rc_lifetime`                                  |
