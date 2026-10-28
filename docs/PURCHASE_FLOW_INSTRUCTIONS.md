# ATC-APP — Purchase Flow: Per-Platform Instructions

Status document for the premium purchase / restore flow. Use this as the source of truth for testing each platform. **Code is left untouched for platforms confirmed working (Android native, iOS native).** Only documentation and test steps are added here.

---

## 1. Identity model (all platforms)

| Piece                  | Value                              | Notes                                                                 |
| ---------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| RevenueCat `appUserID` | Device Supabase anonymous `uid`    | Until Phase 4. Set once in `RevenueCatService.initialize(uid)`.       |
| RC entitlement         | `pro_access`                       | Checked as `customerInfo.entitlements.active.pro_access`.             |
| Alias                  | User-chosen, 8–16 chars `[A-Z0-9]` | Public leaderboard handle. Unique in `accounts.alias`.                |
| Password               | User-chosen, 8–16 chars `[A-Z0-9]` | Private recovery credential. Never the RC appUserID.                  |
| Recovery word          | Optional, 4–16 chars `[A-Z0-9]`    | Set on Premium screen; alias + word → password via `recover-account`. |
| `rc_customer_id`       | Same as device Supabase `uid`      | Stored on `accounts.rc_customer_id` at first purchase.                |

**Relinking a device:** a device is linked to one account. Use "Switch to another account" (or "I lost my credentials — start fresh"): it calls `unlink_device`, wipes local premium state and re-binds RevenueCat to the device's own uid. Nothing is deleted. A linked premium device has no buy button, and a store account can buy the lifetime product only once, so a second purchase from the same Apple ID or Google account is a test-only case (clear the sandbox purchase history). "Clear local data" alone does not unlink. See `FIX_PREMIUM.md` section 2.4.

**Security-critical rule (never change):** RC `appUserID` must stay the device Supabase uid / rc_customer_id, never the public alias. The alias is visible on the leaderboard; binding RC to it would let anyone restore premium.

---

## 2. Platform wiring (how the right SDK is loaded)

`packages/app/vite.config.ts` aliases based on `CAPACITOR_PLATFORM`:

- **Native mobile (`CAPACITOR_PLATFORM=android|ios`):** real `@revenuecat/purchases-capacitor` + `@revenuecat/purchases-capacitor-ui`; `@revenuecat/purchases-js` → stub (`revenuecat-web.stub.ts`). Web SDK never ships to device.
- **Web / Electron:** all three native packages → stubs (`revenuecat.stub.ts`, `revenuecat-ui.stub.ts`, `admob.stub.ts`); real `@revenuecat/purchases-js` used for Paddle Billing.

**Build scripts that set `CAPACITOR_PLATFORM` explicitly:** `build:mobile:android`, `build:mobile:ios`, `dev:android`, `dev:ios`, `android:release`, `android:bundle`, `ios:release`. Never run bare `pnpm --filter @atc-app/app build` for mobile — without `CAPACITOR_PLATFORM` the stubs are bundled and RC silently no-ops on device.

**Keys:** `.env.local` holds `VITE_RC_IOS_KEY` and `VITE_RC_ANDROID_KEY`. Both confirmed present (Oct 2026). `VITE_RC_PADDLE_SERVER_SANDBOX_API_KEY` / `VITE_RC_PADDLE_SERVER_API_KEY` are required for web/Electron but are **not yet configured** (Phase 3 pending).

---

## 3. Android — purchase flow (RESTORE CONFIRMED, FIRST-PURCHASE EVENT PENDING — DO NOT TOUCH CODE)

Verified on a physical Android 13 device via Play test track, 2026-10-15 to 2026-10-17. Code path:

1. `Paywall.vue` → `handlePurchase(pkg)`:
   - Sets RC subscriber attributes `skm_alias`, `skm_secret`, `user_id` (device Supabase uid) via `RevenueCatService.setAttributes()` — **attributes dict passed directly**, no `{ attributes }` wrapper (v12 SDK fix).
   - Calls `purchasePackage(pkg)` → `Purchases.purchasePackage({ aPackage: toRaw(rawPackage) })`.
   - On success: `isSyncingAccount = true`, polls `waitForPremiumAccount()` for up to ~30s, shows neutral pending message ("Purchase confirmed with the store. Finishing setup…") + "Check again" button.
   - Alias race: if `monetization.userAlias` ≠ typed alias, shows "Your alias was already taken, so yours is X. You can change it in settings." for 3s.
2. `monetization.ts` → `purchase()` (native branch): sets `isPremium = true` immediately from returned `customerInfo`, then 1.5s later `syncFromServer(true)` + `hydratePaidContent()` + free→paid progress migration.
3. Webhook `revenuecat-webhook` (Supabase Edge Function): reads `INITIAL_PURCHASE`/`NON_RENEWING_PURCHASE`/etc., looks up `accounts` by `rc_customer_id`, creates row with alias/password/device link via `generate_alias()` race fallback, grants first play session, returns HTTP 200 `{success:true}`.
4. Restore: `restoreAccount(alias, password)` → `restore-key` Edge Function (HTTP 200 business outcomes) → `loadAccount()`; the device keeps its own RevenueCat customer (D13). A wrong pair answers `not_found` and never falls back to `claimPurchase` (removed 2026-10-28: it linked the store purchase's account and ignored the typed pair). The store-receipt path is the paywall's automatic restore ("Try to restore your data automatically"), which calls `claimPurchase` with no credentials when the store shows `pro_access` but the device has no account, and the "already active" path of Unlock.

**Known Android limitation (documented, not a code bug):** `restorePurchases()`/`syncPurchases()` on RC SDK 9.18.0 and 9.29.0 + Play Billing 8 query purchase history via AIDL; Play answers `ERROR` ("No purchases found to restore"), so no restore receipt is posted, and the automatic launch post (200) is not transferred. A player who owns the purchase but has no `accounts` row cannot self-restore; today that needs a dashboard `TRANSFER` (support procedure, `FIX_PREMIUM.md` 2.8). The SDK upgrade was tried and rolled back (2.6 closed, 2026-10-25). Planned: restore by Google order id through a server function (2.9, 2.10). Players whose row exists restore fine via alias + password.

**Android test steps (physical device, Play test track):**

1. Install debug/release APK from Play (one Google account — the installer).
2. Clear app data (`adb shell pm clear com.atcapp.app`) to simulate fresh device.
3. Open app → paywall → enter new alias + password (8–16 chars, A-Z0-9).
4. Tap "Unlock Full Access" → Play buy sheet → complete purchase (license tester / sandbox).
5. Expect: webhook log shows `Webhook: NON_RENEWING_PURCHASE … password=present` then `Created new account …`; `accounts` row appears; paywall shows alias + password copy block.
6. Close app, clear data again, reopen → paywall → "Restore previous purchase" → enter alias + password → premium restored (`restore-key`, then `loadAccount`; RevenueCat stays on this device's uid, D13).
7. Restore on second device with same alias + password → premium transfers (device link moves).
8. "I lost my password" → alias + recovery word → password recovered → restore.

**Build/test commands:**

```bash
# Debug APK to emulator/device
pnpm run dev:android

# Release APK
pnpm run android:release

# Release AAB (Play Store upload)
pnpm run android:bundle
```

**Do not modify:** `AndroidManifest.xml`, native RC init, `purchase()`, `restorePurchases()` in `monetization.ts`, `revenueCatService.ts` native methods, webhook `rc_customer_id` handling. All confirmed working.

---

## 4. iOS — purchase flow (CODE DONE, DEVICE TESTS 1, 3 AND 4 VERIFIED 2026-10-17/18)

Code side complete per `FIX_PREMIUM.md` Phase 1 (tasks 1.1–1.10 all `[x]`). Device tests on an iPhone 17 (sandbox Apple ID) and a Mac, 2026-10-17: tests 1, 3 and 4 (success path) verified, tests 2 and 5 pending (see `FIX_PREMIUM.md` Progress, tasks 1.11 to 1.13):

1. Buy as new user → account appears, premium screen, `accounts` row. ✅ (arrived as a `TRANSFER`; the first-purchase event needs a cleared sandbox purchase history)
2. Buy with taken alias → generated alias + message.
3. Restore on second simulator with alias + password. ✅ (Mac, new uid)
4. Lost password with alias + recovery word. ✅ success path (iPhone, new uid); wrong word / no word / unknown alias pending
5. Delete account still works.
6. Switch account on a linked device ("Switch to another account"). ✅ (Mac)

**iOS code path:** same as Android native but uses `VITE_RC_IOS_KEY` (`appl_…`) and iOS product `pro_access_unlock` (Apple does not allow renaming). `$rc_lifetime` package maps iOS → `pro_access_unlock`, entitlement `pro_access`. StoreKit sandbox purchase on simulator/device with sandbox Apple ID.

**iOS build/test commands (Mac only, Xcode + CocoaPods installed on this machine):**

```bash
# Build web, cap sync ios, xcodebuild for iPhone 15 simulator, install + launch
pnpm run dev:ios

# Release archive for App Store
pnpm run ios:release
```

**Prerequisites before testing:**

- A booted iOS simulator (inventory not confirmed here — `xcrun simctl list devices` blocked in this environment) or a physical iPhone via USB + Apple Developer provisioning.
- Sandbox Apple ID for StoreKit testing.
- `VITE_RC_IOS_KEY` present in `.env.local` (confirmed present).
- `CAPACITOR_PLATFORM=ios` must be set (it is, via `build:mobile:ios`/`dev:ios`).

**Do not modify:** iOS native RC init, `initialize()`, `purchasePackage()`, `restorePurchases()`, webhook iOS path. Verified on device for tests 1, 3 and 4 (success path); finish tests 2 and 5 and the negative cases of 4 before Phase 4.

**iOS test steps (sandbox Apple ID):**

1. Build via `pnpm run dev:ios` (simulator) or archive to device.
2. Fresh install → paywall → alias + password → buy (StoreKit sandbox).
3. Expect: webhook creates account, `accounts` row, premium copy block shown.
4. Clear data / second device → restore alias + password → premium.
5. "I lost my password" → alias + recovery word → restore.
6. Delete account → confirm row removed, device returns to free.

---

## 5. Web / Electron — purchase flow (UNTESTED END-TO-END — PHASE 3)

Code path exists but **never tested end-to-end** per `FIX_PREMIUM.md` Phase 3 (all tasks `[ ]`). Paddle account activation and RC web billing connection are pending.

**Web/Electron code path:**

1. `Paywall.vue` → `handleCtaClick()` → `monetization.purchase()` (web branch).
2. `monetization.ts` `purchase()`:
   - `RevenueCatService.isWebConfigured()` → requires `VITE_RC_PADDLE_SERVER_SANDBOX_API_KEY` (dev) or `VITE_RC_PADDLE_SERVER_API_KEY` (prod).
   - `RevenueCatService.initWeb(userId)` → `Purchases.configure(apiKey, appUserID)` from `@revenuecat/purchases-js`.
   - `setAttributes({ skm_alias, skm_secret, user_id })`.
   - `purchasePackageWeb(pkg, htmlTarget)` → `purchases.purchase({ rcPackage: pkg, htmlTarget })` → Paddle inline checkout.
3. Webhook `revenuecat-webhook` creates `accounts` row from `skm_alias`/`skm_secret` subscriber attributes (same as native).
4. Restore: same `restoreAccount`/`restore-key`/`claimPurchase` path as native.

**Missing before web/Electron can be tested:**

- [ ] Paddle account activated (supports Ukraine without a local entity).
- [ ] RC dashboard: connect Paddle under Web → Billing, create `lifetime` product + `pro_access` entitlement.
- [ ] Paddle: matching product/price, sandbox + domain approval.
- [ ] `VITE_RC_PADDLE_SERVER_SANDBOX_API_KEY` set in `packages/app/.env.local`.
- [ ] `revenuecat-webhook` Edge Function deployed (confirmed deployed per CONTEXT.md).
- [ ] End-to-end Paddle → RC webhook → Supabase flow tested on web + one desktop target.

**Web/Electron build/test commands:**

```bash
# Web dev server
pnpm --filter @atc-app/app dev

# Electron dev
pnpm --filter @atc-app/electron dev

# Electron production package (macOS .app/.dmg on this Mac)
pnpm run dist:electron
```

**Do not modify:** web purchase path until Phase 3 prerequisites are met; then only align attribute names/identity with native (task 3.3).

---

## 6. Server / webhook (shared, all platforms)

**`supabase/functions/revenuecat-webhook/index.ts`:**

- Auth: `Authorization: Bearer $REVENUECAT_WEBHOOK_SECRET` (401 otherwise).
- Grant events: `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE`, `NON_RENEWING_PURCHASE`, `REFUND_REVERSED`, `TRANSFER` → `is_premium=true`.
- Revoke events: `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`, `REFUND` → `is_premium=false`; revoke with no account returns `no_account_to_revoke` (no row created).
- Reads `skm_alias`/`skm_secret` first, falls back to `alias`/`password`; `user_id` = device Supabase uid for profile link.
- Looks up account by `rc_customer_id` first; TRANSFER looks up via `transferred_from`.
- Alias race: if alias taken by another `rc_customer_id`, `generate_alias()` fallback; retry once on Postgres `23505` unique violation.
- Upserts `profiles` (`{id, account_id, is_premium, updated_at}` on conflict `id`) and hands first play session to the buying device (90s TTL) if session is free.
- Deployed with `verify_jwt = false` (RevenueCat sends shared secret, not JWT).

**`supabase/functions/restore-key/index.ts`:**

- Service role (bypasses RLS). Calls `link_account(alias, password, currentUserId)`.
- Returns HTTP 200 with `{success, error}` for business outcomes (`not_found`, `not_paid`, `invalid`, `already_linked`); non-2xx only for transport/DB faults.
- **Critical fix (commit `ee2d1ed`):** business outcomes return HTTP 200, not 404/403/409/400 — previously `supabase-js` reported every non-2xx as a generic error and the client never ran the `claim-purchase` fallback.

**`supabase/functions/claim-purchase`:** verifies store/RC entitlement for the device's appUserID, creates/links account from alias+password when no row exists.

**Security SQL (state in FIX_PREMIUM.md Progress 2026-10-25; all applied):**

- `supabase/functions/harden_supabase/harden_supabase.sql` — **applied 2026-10-25.** `accounts` policy limited to `service_role`; `recover_by_word`/`restore_account` service-role only; legacy `claim_account` dropped.
- `supabase/functions/fix_advisor_warnings/fix_advisor_warnings.sql` — **applied** (verified 2026-10-25). Pins `search_path` on public functions, drops legacy `user_scores` table.
- `supabase/functions/harden_supabase/harden_supabase_2.sql` — **applied 2026-10-25.** Caller guard on `get_account_for_device` (it returned any device's password), no `anon` EXECUTE on the guarded RPCs, `set_alias`/`set_password` service-role only, `generate_*` volatile.
- `supabase/functions/fix_rls_recursion/fix_rls_recursion.sql` — **applied 2026-10-25** (rewritten; rollback in the same folder). Score, progress and vote policies no longer read `accounts` (broken by the hardening) or themselves (42P17); `profiles` updates limited to the progress columns by column privileges (the old policy let a device change its own `account_id`).
- `supabase/functions/harden_supabase/verify_hardening.sql` — read-only checks for all of the above.

---

## 7. Credential rules (local, all platforms)

`packages/app/src/lib/credentialRules.ts` — no network calls:

- `ALIAS_RE = /^[A-Z0-9]{8,16}$/`, `PASSWORD_RE` same, `WORD_RE = /^[A-Z0-9]{4,16}$/`.
- `normalize(s) = s.trim().toUpperCase()`.
- Cross rules: alias ≠ password, word ≠ alias, word ≠ password.
- Character set `[A-Z0-9]` everywhere (client + server RPCs + SQL `generate_alphabet`).

---

## 8. Stubs (do not modify unless adding a new platform)

| Stub file                                                                                                                                      | Used when     | Purpose                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------ |
| `revenuecat.stub.ts`                                                                                                                           | Web/Electron  | `@revenuecat/purchases-capacitor` no-op                      |
| `revenuecat-ui.stub.ts`                                                                                                                        | Web/Electron  | `@revenuecat/purchases-capacitor-ui` no-op (`NOT_PRESENTED`) |
| `revenuecat-web.stub.ts`                                                                                                                       | Native mobile | `@revenuecat/purchases-js` throws "not available on native"  |
| `admob.stub.ts`, `haptics.stub.ts`, `network.stub.ts`, `app.stub.ts`, `filesystem.stub.ts`, `status-bar.stub.ts`, `screen-orientation.stub.ts` | Web/Electron  | Capacitor native plugins no-op                               |

**Critical:** `CAPACITOR_PLATFORM` must be set for mobile builds, otherwise stubs ship to device and RC silently no-ops. Confirmed fixed in build scripts (2026-10-17).

---

## 9. What to test per platform (checklist)

### Android (confirmed working — verify only, no code changes)

- [ ] Fresh purchase creates `accounts` row + webhook HTTP 200
- [ ] Alias race → generated alias + 3s message
- [ ] Restore alias+password on same device after clear data
- [ ] Restore alias+password on second device
- [ ] "I lost my password" → alias + recovery word → restore
- [ ] Delete account → free, row removed
- [ ] Restore after delete with a Google order id (after 2.9 and 2.10 ship): new alias + password + order id → premium, new account row
- [ ] Support procedure dry run (2.8): dashboard Transfer to the Support ID → `TRANSFER` → account row

### iOS (tests 1, 3 and 4 verified 2026-10-17/18 — run the rest)

- [x] Fresh purchase (sandbox Apple ID) → account + premium (via `TRANSFER`; first-purchase event pending)
- [ ] Alias race → generated alias + message
- [x] Restore on second simulator/device alias+password
- [x] Lost password → alias + recovery word (success path; wrong word / no word / unknown alias pending)
- [x] Switch account on a linked device
- [ ] Delete account → free

### Web / Electron (untested — Phase 3 prerequisites first)

- [ ] Activate Paddle + connect to RC dashboard Web Billing
- [ ] Set `VITE_RC_PADDLE_SERVER_SANDBOX_API_KEY` in `.env.local`
- [ ] Sandbox purchase end-to-end → webhook → `accounts` row
- [ ] Restore alias+password on second browser/desktop
- [ ] Delete account → free

---

## 10. Do-not-touch list (confirmed working)

- Android: `AndroidManifest.xml` (`minSdkVersion=24`, `allowBackup="false"`, `com.android.vending.BILLING`), native RC init/purchase/restore, `purchase()`/`restorePurchases()` in `monetization.ts`, webhook `rc_customer_id`/alias-race handling.
- iOS: `initialize()`, `purchasePackage()`, `restorePurchases()`, `hasActiveEntitlement()`, iOS webhook path.
- Shared: `revenueCatService.ts` native methods, `setAttributes()` dict-passing (v12 fix), `restore-key` HTTP-200 fix (commit `ee2d1ed`), `credentialRules.ts`.
- Stubs + `vite.config.ts` aliasing (CAPACITOR_PLATFORM gating).

Only touch Web/Electron purchase path (Phase 3) and the pending SQL policies after Phase 0–3 pass on all platforms (per FIX_PREMIUM.md rule #4).
