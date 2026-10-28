# HOW TO: Test premium on an iPhone

Step by step test of the premium flow on a physical iPhone: restore by alias + password, relaunch, and score/progress sync. It mirrors `TEST_ANDROID.md` (first run there on 2026-10-25); run it after any change to the Edge Functions, the security SQL or `monetization.ts`. Record results in `docs/plans/FIX_PREMIUM.md`, Progress.

All commands run from the monorepo root (`/Users/ky/Projects/sky_mess/game`) unless noted.

---

## 0. Before you start

You need:

- A Mac with Xcode and CocoaPods (`pod --version` works).
- A physical iPhone with **Developer Mode** on (Settings → Privacy & Security → Developer Mode; the phone restarts). Without a phone, an iOS Simulator covers restore, relaunch and score sync (not purchases). An Apple-silicon Mac runs the app as "My Mac (Designed for iPad)", which is also how it ships in the Mac App Store (D14).
- Your Apple developer team selected in Xcode (target **App** → Signing & Capabilities → Team).
- For purchase tests only: a **sandbox tester** Apple ID (App Store Connect → Users and Access → Sandbox), signed in on the iPhone under Settings → Developer → Sandbox Apple Account (iOS 18; older iOS: Settings → App Store → Sandbox Account). Restore by alias + password does not need it.
- A premium test account: alias + password from the developer notes. **Never** put the password in a document, chat, screenshot or commit.
- Access to the Supabase SQL editor (project `boajtcfnyxaedanykfil`).
- `VITE_SHOW_DEBUG=true` in `packages/app/.env.local` for the test build. It must be `false` for any release build.

Do **not** use `pnpm run dev:ios`. It runs a bare app build without `CAPACITOR_PLATFORM` (the RevenueCat and AdMob stubs get bundled, purchases silently do nothing), and it only targets the simulator.

---

## 1. Pods (after any plugin version change)

```bash
cd packages/mobile/ios/App && pod install --repo-update && cd -
git status
```

Pass: `pod install` finishes, and `git status` shows **no** change to `Podfile.lock` unless you changed a plugin version on purpose (the pinned `@revenuecat/purchases-capacitor` is 11.3.2, see `SYNC_VERS.md`).

## 2. Build and run

1. Build the web app for iOS, sync it, open Xcode:
   ```bash
   pnpm run build:mobile:ios && pnpm run cap:sync:ios
   pnpm --filter @atc-app/mobile exec cap open ios
   ```
2. Xcode: wait until "Indexing | Processing files" finishes, click the run destination in the toolbar (it shows "Any iOS Device (arm64)" by default) and choose the iPhone, **My Mac (Designed for iPad)** or an **iOS Simulator** → **Run ▶** (⌘R). Never "Mac Catalyst": the AdMob, UMP and Filesystem SDKs have no Catalyst build.
   - No cable: pick an **iOS Simulator** (for example iPhone 16). It covers restore, relaunch and score sync; a sandbox purchase needs the real iPhone. If the device still holds an earlier test account: Premium account screen → **Switch to another account** gives a clean, unlinked state without deleting anything on the server.
   - iPhone over Wi-Fi: pair it once with the cable, then Window → Devices and Simulators → the iPhone → **Connect via network**; afterwards it appears in the destination menu when both are on the same network.
   - Signing error: target **App** → Signing & Capabilities → **Team**, with "Automatically manage signing" on.
3. First install on a phone: if iOS says "Untrusted Developer", open Settings → General → VPN & Device Management → your developer profile → **Trust**, then run again.
4. For a clean state, delete the app from the phone first (long press → Remove App → Delete App). This removes only local data; the account and the purchase are on the server and the Apple ID.

## 3. Check the build (optional, 10 seconds)

```bash
grep -lF 'Not available on web' packages/mobile/ios/App/App/public/assets/*.js | wc -l
```

Pass: `0`. Anything else means the stubs were bundled; rebuild with step 2.

## 4. Watch the log

The app's console appears in Xcode's debug console as `⚡️  [log] - …`, `⚡️  [warn] - …` and `⚡️  [error] - …` lines. Keep it open for the whole test, or use Safari's Web Inspector for the WebView (iPhone: Settings → Apps → Safari → Advanced → Web Inspector on, on older iOS Settings → Safari → Advanced; Mac Safari: Develop → your iPhone → `localhost`).

## 5. Restore by alias + password

1. Open the app → open the Paywall → **Already purchased? Restore your account**.
2. Enter the test alias + password → Restore.
3. Pass:
   - the app shows premium (Profile: "★ Premium Unlocked");
   - debug overlay → **Copy** contains `restoreAccount:restore-key {"ok":true,"success":true,"error":null}`;
   - no RevenueCat `logIn` after the restore (decision D13).
4. **Do not paste the whole Copy output anywhere.** It contains the password in clear (`userPassword`) and the live Supabase session (`sb-…-auth-token`, access **and refresh** token); anyone with the refresh token can act as this device. Share only the LOGS section.
5. **Wrong pair.** Also on an iPhone whose Apple ID owns the product: Premium account → **Switch to another account**, then a made-up alias + any password → Restore. Pass: "No user found, check your spelling", the device stays free, and the log has `restoreAccount:restore-key {"ok":true,"success":false,"error":"not_found"}` with **no** `claimPurchase:start` after it.
6. **Automatic restore of the purchase's account.** Same unlinked iPhone → Paywall → **Try to restore your data automatically**. Pass: the app is premium on the account that bought on this Apple ID, and the log has `claimPurchase:response {"transportError":null,"success":true,"error":null}`.
7. **Busy paywall.** Press Restore Account (or Try to restore automatically) and, while it runs, tap outside the panel and tap other buttons. Pass: the pressed button shows a spinner, every other control is dimmed and does nothing, the paywall does not close, and the panel still scrolls. The log shows `backdrop click ignored (request in progress)` for the outside taps.

## 6. Relaunch

1. Swipe ATC-APP away in the app switcher, open it again. (EXIT on iOS shows a goodbye overlay; Apple does not allow an app to quit itself.)
2. Pass: still premium without typing anything; the console shows `Monetization ready | platform: ios | premium: true`.

## 7. Score and progress sync

1. Play **one shift to the end** (completion screen), then go back to the main menu.
2. Supabase SQL editor:
   ```sql
   select level_id, max_planes, updated_at from public.account_scores order by updated_at desc limit 5;
   select left(id::text, 8) as device, last_passed_level, updated_at from public.profiles order by updated_at desc limit 3;
   ```
3. Pass: a new `account_scores` row for the shift just played, and the device's `last_passed_level` filled in.
4. Note: `max_planes` counts **landed** planes only; a shift completed through waypoint passes scores 0 (correct while landing traffic is not implemented yet).

## 8. Check the log

Search the Xcode console (filter field) for `warn`, `error`, `denied`, `42501`, `42P17`, `account_scores`, `unauthorized`.

Pass: no `permission denied`, `42501`, `42P17`, `Could not load account_scores` or `scores.flush` lines.

## 9. Server-side policy tests (optional)

Same two rolled-back SQL tests as `TEST_ANDROID.md` step 9, with this device's uid (the Profile screen shows its first 8 characters). They only need to be run once per database change, not per platform.

## 10. iOS-only checks (when the task asks for them)

- **First purchase event (task 1.11):** App Store Connect → Users and Access → Sandbox → the tester → **Clear Purchase History**, delete the app, reinstall, enter a new alias + password, buy. Pass: the `revenuecat-webhook` log shows `NON_RENEWING_PURCHASE` (not `TRANSFER`) and `Created new account …`. Without clearing, the sandbox Apple ID already owns the product and RevenueCat sends `TRANSFER`.
- **Restore after delete:** iOS restores the store purchase through the receipt; the webhook re-creates or re-links the account from the `TRANSFER` (verified 2026-10-20 and 2026-10-23).

## 11. After the test

1. Set `VITE_SHOW_DEBUG=false` before any release build (`pnpm run ios:release`, then Xcode Organizer → Distribute App).
2. Add a Progress line to `docs/plans/FIX_PREMIUM.md`: date, device, iOS version, build, uid prefix, and pass/fail for steps 5 to 9.

---

## Troubleshooting

| Symptom                                                    | Likely cause                                                                                                  | What to do                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| "Signing for App requires a development team"              | No team selected                                                                                              | Target App → Signing & Capabilities → Team                                                                                     |
| "Untrusted Developer" on launch                            | Developer profile not trusted                                                                                 | Settings → General → VPN & Device Management → Trust                                                                           |
| `pod install` fails on a missing spec                      | Local CocoaPods spec repo out of date                                                                         | `pod install --repo-update` (step 1)                                                                                           |
| Purchases or restore silently do nothing                   | Stubs bundled (built with `dev:ios` or a bare app build)                                                      | Step 3, then rebuild with step 2                                                                                               |
| Restore says "Network error"                               | A non-2xx from the Edge Function                                                                              | Overlay Copy shows `restoreAccount:restore-key:http-error` with status and body; check Supabase → Edge Functions → Invocations |
| Restore answers `unauthorized`                             | The app has no valid session (for example its auth user was deleted)                                          | Close and reopen the app, then restore again                                                                                   |
| Restore answers `not_found`                                | Wrong alias/password, or the account was deleted                                                              | Check the credentials; after a delete, buy again with the same Apple ID (the receipt restores the purchase)                    |
| Restore answers `already_linked`                           | This device is linked to another account                                                                      | Paywall → "Switch to another account", then restore                                                                            |
| Restore says "Too many attempts" (`rate_limited`)          | 5 wrong passwords or recovery words for this alias in an hour, or 15 from this network, or 5 from this device | Wait the time shown, or for a test account clear it: `delete from public.credential_attempts where alias = '<ALIAS>';`         |
| Purchase lands on an existing account, typed alias ignored | The sandbox Apple ID already owns the product (`TRANSFER`, task 1.14)                                         | Expected; clear the sandbox purchase history for a true first purchase (step 10)                                               |
| No `account_scores` row after a finished shift             | Policy or grant problem                                                                                       | Step 8; `supabase/functions/harden_supabase/verify_hardening.sql` block 2                                                      |
