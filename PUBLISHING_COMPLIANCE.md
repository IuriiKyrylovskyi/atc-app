# ✈️ ATC-APP — App Store & Google Play Publishing Compliance

> Research-based compliance guide for submitting ATC-APP to Apple App Store and Google Play.
> Last updated: March 2026. Always cross-check against current store guidelines before submission.

---

## 📋 Table of Contents

- [Status Summary](#status-summary)
- [Required for Both Stores](#required-for-both-stores)
- [Apple App Store Requirements](#apple-app-store-requirements)
- [Google Play Requirements](#google-play-requirements)
- [ATC-APP-Specific Issues](#atc-app-specific-issues)
- [What Needs to Be Built](#what-needs-to-be-built)
- [Submission Checklist](#submission-checklist)

---

## 🚦 Status Summary

| Category                     | Apple                    | Google Play           | Notes                                  |
| ---------------------------- | ------------------------ | --------------------- | -------------------------------------- |
| Privacy Policy               | ❌ Missing               | ❌ Missing            | Required by both — must be built       |
| Age Rating                   | ⬜ TBD                   | ⬜ TBD                | Likely 4+ / Everyone                   |
| Data Safety Declaration      | ❌ Missing               | ❌ Missing            | Required by both                       |
| In-App Purchase setup        | ⏳ Waiting Apple account | ⏳ Waiting APK upload |                                        |
| App Icon (1024×1024)         | ⬜ TBD                   | ⬜ TBD                | Required                               |
| Screenshots                  | ⬜ TBD                   | ⬜ TBD                | Required — multiple sizes              |
| Privacy Policy URL in app    | ❌ Missing               | ❌ Missing            | Must be accessible inside app          |
| Account deletion             | ❌ Missing               | N/A                   | Apple requires in-app account deletion |
| Android target API level     | N/A                      | ❌ Must target API 35 | Required since Aug 31 2025             |
| Content rating questionnaire | ⬜ TBD                   | ⬜ TBD                | Fill in both consoles                  |

---

## 🔑 Required for Both Stores

### 1. Privacy Policy (BLOCKING — required before submission)

Both stores require a privacy policy. It must:

- Be publicly accessible via a URL (hosted on your website or GitHub Pages)
- Be linked in the App Store Connect / Play Console metadata
- Be accessible **inside the app** (Settings screen or About screen)
- Cover:
  - What data is collected (anonymous user ID, gameplay progress, purchase status)
  - How it's used (premium verification, level progress sync)
  - Third-party services: Supabase (database), RevenueCat (purchases), AdMob (ads)
  - Data retention and deletion policy
  - How users can request data deletion

**ATC-APP data collected:**

- Anonymous UUID (no name, no email, no personal info)
- `current_level` progress
- `is_premium` purchase status
- `platform` (ios/android/electron/web)
- `purchased_at` timestamp

**ATC-APP uses these third-party SDKs that must be disclosed:**

- Supabase — database storage
- RevenueCat — purchase validation
- Google AdMob — advertising (once implemented)
- Capacitor — native bridge (no data collection)

> ✅ **Action:** Create a privacy policy page. See "What Needs to Be Built" below.

### 2. App Icon

| Store           | Size Required                         |
| --------------- | ------------------------------------- |
| Apple App Store | 1024×1024 PNG (no alpha/transparency) |
| Google Play     | 512×512 PNG                           |

Both also need adaptive icons for various device sizes — Capacitor Assets Generator handles this automatically.

### 3. Screenshots

**Apple (required):**

- iPhone 6.9" (iPhone 16 Pro Max): at least 3 screenshots
- iPad 13" Pro: at least 3 screenshots (if supporting iPad)

**Google Play (required):**

- At least 2 phone screenshots (16:9 or 9:16)
- Feature graphic: 1024×500 PNG/JPG

### 4. App Description

- Must accurately describe what the app does
- Cannot include pricing in the description
- Cannot use competitor names or unrelated keywords
- Keep it under 4000 characters (Google), Apple is more flexible

### 5. Age Rating

ATC-APP is a flight/ATC game with:

- No violence
- No adult content
- No user-generated content
- No social features
- Mild cartoon-style gameplay

**Expected rating:** 4+ (Apple) / Everyone (Google Play)

You answer a questionnaire in both consoles — answer honestly. Apple now has 13+, 16+, and 18+ ratings in addition to 4+ and 9+.

---

## 🍎 Apple App Store Requirements

### Technical Requirements

- **Minimum iOS version:** iOS 16+ recommended (Capacitor 7 supports iOS 14+)
- **Architectures:** Must support arm64 (Apple Silicon + modern iPhones)
- **App size:** Under 4GB total, under 200MB for cellular download without warning
- **Launch time:** Must launch within 20 seconds on supported devices
- **No crashes:** Tested on real devices, not just simulators
- **Performance:** Must not crash on iPhone models 2–3 years old

### Privacy Requirements (Apple-specific)

**App Privacy Nutrition Label** (filled in App Store Connect):

ATC-APP collects:
| Data Type | Collected | Linked to User | Used for Tracking |
|-----------|-----------|---------------|-------------------|
| User ID (anonymous UUID) | Yes | Yes | No |
| Purchase history | Yes (via RevenueCat) | Yes | No |
| Gameplay data (level progress) | Yes | Yes | No |
| Diagnostics/crash data | Only if you add Crashlytics | — | No |

> ⚠️ Since ATC-APP uses **anonymous auth** (no email, no name), the privacy
> footprint is minimal. This is a significant advantage at review time.

**Permission strings** (in `Info.plist` — only add if actually used):

- No camera, microphone, contacts, location needed for ATC-APP
- If AdMob is added: must add `NSUserTrackingUsageDescription` for ATT prompt

**ATT (App Tracking Transparency) — required for AdMob:**

```xml
<key>NSUserTrackingUsageDescription</key>
<string>We use your advertising identifier to show you relevant ads and support the free version of ATC-APP.</string>
```

### In-App Purchase Requirements (Apple)

- Product ID must match exactly: `pro_access_unlock`
- Must be a **Non-Consumable** type (pay once, own forever)
- Must have a **"Restore Purchases"** button — Apple will reject without it
- Paywall must clearly describe what the user gets before purchase
- Cannot use misleading language like "Subscribe" for a one-time purchase
- Price must be displayed clearly before the purchase sheet appears

### Account Deletion Requirement (Apple — NEW, strictly enforced)

> ⚠️ Apple requires all apps that support account creation to offer in-app account deletion.
> Anonymous auth counts as account creation — this MUST be implemented.

The user must be able to:

1. Initiate account deletion from **within the app** (not just "email us")
2. Deletion must remove their Supabase profile row and auth entry
3. Add this to a Settings or Profile screen inside the app

**What to build:**

- Settings screen with a "Delete Account" button
- On tap: confirm dialog → call `supabase.auth.admin.deleteUser()` (via Edge Function) → sign out

### Restore Purchases Button

Must be reachable from the paywall or settings. Maps to:

```typescript
await RevenueCatService.restorePurchases();
```

---

## 🤖 Google Play Requirements

### Technical Requirements

- **Target API level:** Must target **Android 15 (API level 35)** for new submissions (required since Aug 31, 2025)
- **Min API level:** Android 7.0 (API 24) minimum recommended for Capacitor 7
- **App format:** Must use **AAB (Android App Bundle)** — APK alone is no longer accepted for new apps
- **64-bit support:** Required — no 32-bit only builds
- **Permissions:** Only declare permissions you actually use — reviewers check
- `android.permission.BILLING` — required for in-app purchases (already declared by Capacitor Purchases plugin)

### Data Safety Section (Google Play — required)

Fill in Play Console → Store Presence → Data Safety:

| Data Type                     | Collected            | Shared           | Required         |
| ----------------------------- | -------------------- | ---------------- | ---------------- |
| User IDs                      | Yes                  | No               | Yes              |
| App activity (level progress) | Yes                  | No               | Yes              |
| App purchases                 | Yes (via RevenueCat) | Yes (RevenueCat) | Yes              |
| Advertising ID                | Yes (AdMob)          | Yes (AdMob)      | Yes (when added) |

Must also declare:

- Data is encrypted in transit ✅ (Supabase uses HTTPS)
- Users can request data deletion ✅ (must be implemented — see Account Deletion above)

### Content Rating (IARC Questionnaire)

Fill in Play Console → Store Presence → Content Rating. For ATC-APP:

- Violence: None
- Sexual content: None
- Language: None
- Controlled substances: None
- Gambling: None (standard in-app purchase is NOT gambling)

Expected result: **Everyone (3+)**

### Android-Specific Store Listing

- Feature graphic: **1024×500 pixels** (required, not optional)
- At least **2 phone screenshots**
- Short description: under 80 characters
- Full description: under 4000 characters

---

## ✈️ ATC-APP-Specific Issues

### AdMob Ads (when implemented)

Adding AdMob creates additional requirements on both stores:

**Apple:**

- Must implement **ATT prompt** (`AppTrackingTransparency` framework)
- Privacy policy must mention Google AdMob
- App Privacy Label must declare Advertising Data

**Google Play:**

- Data Safety must declare Advertising ID collection
- Ad content must not be more mature than the game content
- Must comply with Google's Families Policy if targeting children (ATC-APP is not targeting children so this is less relevant)
- Ads cannot cover or obscure game UI elements

### Anonymous Auth — Key Advantage

Using anonymous auth (no email/password) means:

- No need to implement email verification flows
- No need to declare email collection in privacy labels
- Simpler privacy policy
- BUT: still requires account deletion (Apple) and data deletion mechanism (both)

### In-App Purchase — One-Time vs Subscription

ATC-APP uses a **one-time purchase** (`pro_access_unlock`). Both stores treat this differently from subscriptions:

- No auto-renewal disclosure required
- No cancellation flow required
- Must still have Restore Purchases button (Apple)
- Clearly label it as a one-time purchase, not "subscribe"

---

## 🏗️ What Needs to Be Built

These items don't exist yet and will block submission:

### 1. Privacy Policy Page (BLOCKING)

Host a simple HTML page at your domain or GitHub Pages. Must include:

- What data ATC-APP collects (anonymous UUID, level progress, purchase status)
- Third parties: Supabase, RevenueCat, AdMob
- Data deletion: how users can request account/data deletion
- Contact email for privacy requests

**Simplest option:** GitHub Pages with a markdown file.

### 2. In-App Privacy Policy Link

Add a "Privacy Policy" link somewhere accessible in the app UI:

- Settings screen (recommended)
- About screen
- Or even just in the paywall footer

### 3. Account Deletion (Apple — BLOCKING for App Store)

Add to a Settings/Profile screen:

```
[Delete Account]
```

On tap:

1. Confirmation dialog: "This will permanently delete your account and all progress."
2. Call Edge Function to delete the Supabase auth user
3. Clear local session
4. Return to home screen

### 4. Restore Purchases Button

Add to the paywall or settings screen:

```
[Restore Purchases]
```

Maps to `monetizationStore.restorePurchases()` — already implemented in the store.

### 5. App Icon (1024×1024)

Use `capacitor-assets` to generate all required sizes from one source image:

```bash
pnpm --filter @atc-app/mobile run assets:generate
```

Requires a `1024×1024` source icon at `assets/icon/icon.png`.

### 6. Screenshots

Take screenshots on:

- iPhone 16 Pro Max (6.9" — required)
- iPad Pro 13" (if supporting iPad)
- Android phone (any 16:9)

---

## ✅ Submission Checklist

### Both Stores

- [ ] Privacy policy URL hosted and publicly accessible
- [ ] Privacy policy linked inside the app
- [ ] Age rating questionnaire completed honestly
- [ ] App icon — 1024×1024 (Apple), 512×512 (Google)
- [ ] Screenshots — minimum sizes for each store
- [ ] App description written (no pricing, accurate)
- [ ] Account deletion implemented and working
- [ ] Restore Purchases button visible in paywall or settings
- [ ] All crashes fixed — tested on real devices

### Apple App Store Only

- [ ] App Privacy Nutrition Label filled in (App Store Connect)
- [ ] `NSUserTrackingUsageDescription` added if using AdMob
- [ ] ATT prompt implemented if using AdMob
- [ ] Non-consumable IAP created in App Store Connect (`pro_access_unlock`)
- [ ] Sandbox tester created for IAP testing
- [ ] Build uploaded via Xcode or Transporter
- [ ] TestFlight internal test passed before submission

### Google Play Only

- [ ] Data Safety section completed in Play Console
- [ ] IARC content rating questionnaire completed
- [ ] Feature graphic created (1024×500)
- [ ] AAB build uploaded (not APK)
- [ ] Target API level = 35 (Android 15)
- [ ] `android.permission.BILLING` declared in manifest
- [ ] Internal testing track published before production
- [ ] Merchant account set up (Google Payments)
- [ ] In-app product created (`pro_access_unlock`) after APK uploaded

### RevenueCat Integration

- [ ] iOS app added in RevenueCat with App Store credentials
- [ ] Android app added in RevenueCat with Play credentials
- [ ] `pro_access_unlock` product linked to `pro_access` entitlement
- [ ] Webhook connected and tested
- [ ] Sandbox purchase tested on real device

---

## 📚 Reference Links

| Resource                            | URL                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Apple App Review Guidelines         | https://developer.apple.com/app-store/review/guidelines/                  |
| Apple App Privacy Details           | https://developer.apple.com/app-store/app-privacy-details/                |
| Apple Account Deletion Requirement  | https://developer.apple.com/support/offering-account-deletion-in-your-app |
| Google Play Developer Policy        | https://play.google.com/about/developer-content-policy/                   |
| Google Play Data Safety             | https://support.google.com/googleplay/android-developer/answer/10787469   |
| Google Play Target API Requirements | https://developer.android.com/google/play/requirements/target-sdk         |
| RevenueCat iOS Setup                | https://www.revenuecat.com/docs/ios                                       |
| RevenueCat Android Setup            | https://www.revenuecat.com/docs/android                                   |
