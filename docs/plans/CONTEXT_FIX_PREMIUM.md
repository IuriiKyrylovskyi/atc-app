# CONTEXT_FIX_PREMIUM.md: start or continue any chat on the premium flow

Last updated: 2026-10-25. This file is a briefing, not a source of truth. The sources of truth are `FIX_PREMIUM.md` (tasks, decisions, Progress), `PURCHASE_FLOW_INSTRUCTIONS.md` (per-platform flow and tests) and `SYNC_VERS.md` (versions). If this file and those disagree, those win; then fix this file.

## 0. How to use

1. Paste section 11 as the first message of a new chat and attach the files listed there.
2. Say which task id (for example `1.11`, `2.5`, `5.6`) you are working on.
3. Before ending a chat, ask for the Progress lines to add to `FIX_PREMIUM.md`, and update this file's section 4 and 5 if status changed.

## 1. Project snapshot

- **ATC-APP**: air-traffic-control game. pnpm monorepo: `packages/app` (Vue 3 + Vite + Phaser + Pinia + Vuetify), `packages/mobile` (Capacitor 7.4.4: iOS and Android), `packages/electron`.
- **Backend:** Supabase project `boajtcfnyxaedanykfil`, labelled **PRODUCTION**, **Free plan (no automatic backups; deletes cannot be undone)**. Anonymous auth only.
- **Payments:** RevenueCat. iOS product `pro_access_unlock` (non-consumable, store status "Ready to Submit"), Android product `lifetime` (INAPP), web via Paddle products attached to the same entitlement. Offering `default_v2`, package `$rc_lifetime`. Code checks only the entitlement `pro_access`. The entitlement `pro` ("Full access") exists but nothing reads it (task 5.10).
- **Versions (exact pins):** `@revenuecat/purchases-capacitor` 11.3.2 (native Android SDK 9.18.0; 11.3.3 / 9.29.0 was tried on 2026-10-24, did not help, and was rolled back; branch `rc-upgrade`), Play Billing 8.0.0, `@supabase/supabase-js` ^2.98.0, Capacitor 7.4.4. See `SYNC_VERS.md`.
- Free players keep progress locally and have **no database rows by design** (target; the trigger still creates profiles until Phase 5).

## 2. Product and identity model

| Piece                  | Value                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Game account           | row in `accounts`: `alias` (public handle), `password` (private), `recovery_word` (optional), `is_premium`, `rc_customer_id`, play-session columns                                                                       |
| Alias / password       | user-chosen, 8-16 chars `[A-Z0-9]`; word 4-16 chars; alias, password and word must differ. Same password on two accounts is allowed (task 0.5 dropped the unique constraint)                                             |
| Device                 | anonymous Supabase user (`auth.users`) plus `profiles` row; `profiles.account_id` links a device to one account                                                                                                          |
| RevenueCat App User ID | the device's Supabase uid at purchase time; stored as `accounts.rc_customer_id`. Never the alias or password                                                                                                             |
| After restore          | premium comes from the Supabase flag (`profiles.is_premium` via `link_account`). RevenueCat stays on the device's own uid (D13); the never-working `logIn(rc_customer_id)` block in `loadAccount()` is removed (1.16)    |
| Subscriber attributes  | the app sets `skm_alias`, `skm_secret`, `user_id` before purchase; the webhook reads them                                                                                                                                |
| Play session           | one active device per account (3 min TTL, heartbeat); the buying device gets the first session                                                                                                                           |
| Relinking              | "Switch to another account" / "I lost my credentials: start fresh" call `unlink_device` (nothing deleted). "Clear local data" alone does not unlink. A premium linked device has no buy button. See `FIX_PREMIUM.md` 2.4 |

## 3. Server and client map

**Edge Functions** (`supabase/functions/*`):

| Function               | Role                                                                                                                                      | Notes                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `revenuecat-webhook`   | creates/updates `accounts` from RevenueCat events; links the buying device; grants first play session                                     | `verify_jwt = false` in `supabase/config.toml`; checks `Authorization: Bearer $REVENUECAT_WEBHOOK_SECRET`. Revoking events for an unknown customer return `no_account_to_revoke`. Input checks 0.14 (v45 deployed 2026-10-25) |
| `restore-key`          | alias + password + caller's uid → `link_account`                                                                                          | business outcomes are HTTP **200** `{success,error}`. Uid from the JWT since 0.13 (v14 deployed 2026-10-25; anon bearer now gets 401 `unauthorized`)                                                                          |
| `claim-purchase`       | proves entitlement through the RevenueCat REST API for the caller's uid, then creates/links the account                                   | JWT verification stays ON                                                                                                                                                                                                     |
| `recover-account`      | alias + recovery word → password                                                                                                          | no throttling yet (`FIX_PREMIUM.md` 2.3, 5.8). Deployed version answers business errors with 404; client reads the body via `asBusinessBody()`                                                                                |
| `restore-by-order`     | **planned (2.9):** Google order id to RevenueCat REST v2 "Restore by Order ID" for the caller's uid (from the JWT), then `claim-purchase` | not built; verify the endpoint with curl first                                                                                                                                                                                |
| `delete-account`       | deletes the account row and every linked device's auth user                                                                               | does **not** touch the store purchase or the RevenueCat customer. `verify_jwt = false` (checks the token itself with `auth.getUser`), recorded in `config.toml`                                                               |
| `validate-credentials` | not used by the client (task 4.10 retires it)                                                                                             |                                                                                                                                                                                                                               |

**SQL** (one folder per script, `supabase/functions/<script>/<script>.sql`; the CLI deploys only folders that contain `index.ts`, so these are never deployed as functions): `harden_supabase.sql` (applied 2026-10-25), `harden_supabase_2.sql` (applied 2026-10-25) and the read-only `verify_hardening.sql` in the same folder; `fix_rls_recursion/fix_rls_recursion.sql` (rewritten and applied 2026-10-25; `rollback_fix_rls_recursion.sql` beside it); `fix_advisor_warnings.sql` (applied, verified 2026-10-25); `diagnose_supabase.sql` (read-only), `reset_test_account.sql` (TEST DATA ONLY), `unlink_device.sql` (applied; the folder also holds the legacy `Fix_claim_account_SQL.md`). **Not in the repo:** `fix_credential_rpcs.sql` (applied 2026-10-15; the live function bodies are now the only copy, exported by `verify_hardening.sql` block 7). `SUPABASE_SCHEMA_ACCOUNTS.sql` is out of date versus the deployed functions (task 5.6).

**Client files:** `stores/monetization.ts` (init, restore, claim, unlink, recovery, tracing), `services/revenueCatService.ts` (native/web SDK wrapper, payment log), `components/monetization/Paywall.vue`, `App.vue` (restore modal), `ProfileScreen.vue` (Premium account screen: alias, password, recovery word), `AccountSettingsScreen.vue` (Danger Zone: delete account, plain `fetch` with `Authorization` + `Content-Type`), `lib/credentialRules.ts`.

## 4. Verified state (dates are test sessions)

- **Backend:** webhook test event 200 (2026-10-15); `restore-key` repo version deployed; `link_account` and friends use `[A-Z0-9]` and `use_column` (diagnose 2026-10-15).
- **Android (physical device, Play test track):** account creation through a `TRANSFER` event; restore by alias + password after `pm clear`; restore of an account created on another store. **Not working:** RevenueCat's own restore (see 5).
- **iOS (iPhone 17 + Mac, sandbox):** purchase creates account (as `TRANSFER`), restore on a second device, switch account on a linked device, recovery by alias + word (success path), restore of an Android-created account on iOS.
- **Android SDK upgrade (2026-10-24, rolled back 2026-10-25):** on 9.29.0 the manual Restore still ends in `getPurchaseHistory` `ERROR`; dashboard shows no transfer (`4908a9e4…` still holds the purchase, the new customer has none). Back on 11.3.2 / 9.18.0 (logcat verified).
- **Phase 0 re-audit (2026-10-25):** deployed functions equal the repo (byte-identical downloads); 0.2, 0.3, 0.4, 0.7 to 0.9 and 0.12 verified; `harden_supabase.sql` applied, anon checks pass (`accounts` 0 rows, `recover_by_word` / `restore_account` / `link_account` denied, `claim_account` gone). `verify_hardening.sql` run the same day: 0.1, 0.5, 0.6 verified; **`get_account_for_device` returns any device's password** (fix `harden_supabase_2.sql`); the score, progress and vote policies read `accounts` and fail for players, and score sync never stored a row (42P17; fix `fix_rls_recursion.sql`). New tasks 0.13, 0.14, 1.16. See Progress 2026-10-25.
- **Cleanup:** free devices deleted (preview 533 users, 10 kept; `profiles` about 11 afterwards). Confirm counts and tick 5.3b.

## 5. Open items and known limitations (details in `FIX_PREMIUM.md`)

1. **Android: owned purchase but no `accounts` row cannot be restored by the app (SDK upgrade did not fix it; task 2.6 closed).** On SDK 9.18.0 and 9.29.0 with Play Billing 8, `restorePurchases()` and `syncPurchases()` query purchase history through `getPurchaseHistory` (AIDL); Play answers `ERROR`, so no restore receipt is posted. The automatic launch sync posts the receipt (`POST /v1/receipts` 200) but RevenueCat does not transfer it to the new uid (confirmed in the dashboard); the buy sheet says `ITEM_ALREADY_OWNED`. RevenueCat documents it as a Billing 8 limitation; its remedies are the previous anonymous id via Auto Backup, or a transfer by Google order id (dashboard or REST v2 "Restore by Order ID"). Players whose row exists restore by alias + password and are unaffected. **Plan (decision D9, proposed):** support procedure and Support ID (2.8), server function `restore-by-order` (2.9), client UI (2.10), RevenueCat ticket and second-device test on hold (2.11), Auto Backup decision (2.12).
2. **First-purchase event unverified on both stores.** Only `TRANSFER` has been seen. Tasks 1.11 (iOS), 2.5 (Android).
3. **Account deletion:** server side verified 2026-10-20; the client crashed after success (`store.reset` undefined) and is fixed (2026-10-23; re-tested on the Mac: delete clean, local keys cleared). Decision: do not delete the RevenueCat customer (2.7). Wording in `AccountSettingsScreen.vue` no longer claims purchase history is deleted and explains per platform what happens to the store purchase (2026-10-23). On iOS a purchase after deletion produced a `TRANSFER` that re-linked an existing account of the same Apple ID and ignored the typed alias/password (1.14); the case "delete the account that holds the purchase, then buy again" is verified (2026-10-23: webhook `Created new account`, typed credentials used). On Android restore after deletion is not possible today (2.6).
4. **iOS tests pending:** 2 (alias taken: insert a decoy `accounts` row first), 5 (delete account), negative cases of 4 (wrong word, no word, unknown alias), 1.12 (press Refresh in the debug panel; the localStorage view can be a stale snapshot), 1.13 (pay after switching account).
5. **Security before release:** `recover-account` brute force (alias is public, word can be 4 characters, response contains the password); `harden_supabase.sql` applied 2026-10-25; apply `harden_supabase_2.sql` (password leak through `get_account_for_device`), then `fix_rls_recursion.sql` (score sync); `restore-key` (0.13) and `revenuecat-webhook` (0.14) deployed 2026-10-25, device tests pending; `stripe-webhook` deleted 2026-10-25 (5.7).
6. **Progress sync plan** for `profiles.platform` (always `web`), `last_passed_level`, `passed_levels`, `updated_at`; `current_level` is legacy.
7. **Web / Electron (Phase 3):** not started; see `FIX_PREMIUM.md` Phase 3. Does not depend on 2.6 or Android restore.
8. **Phase 4/5:** device-less accounts, random RevenueCat id per install, drop the profile trigger; see `FIX_PREMIUM.md`.
9. **Security hardening (tasks 5.11 to 5.14):** passwords stay plain text by owner decision (D11, no hashing), so the safeguards in 5.11 are release blockers: apply `supabase/functions/harden_supabase/harden_supabase.sql` and prove `accounts` is unreadable with the anon key, no password in logs, debug overlay off and masked in release, credentials out of backups and exports. Also `skm_secret` visible in RevenueCat attributes (5.12), rate limits on `restore-key`, `recover-account` and `restore-by-order` (5.13), review of `active_device_id` on restore and delete (5.14).
10. **Web/Electron restore identity (1.15, fix proposed):** `Paywall.vue` web branch logs RevenueCat in with the password; `monetization.ts` `loadAccount()` does not bind web to `rc_customer_id` (D13), so after deleting the password block web restore is alias + password only. Delete the password block, restore by alias + password, check the RevenueCat dashboard for password-shaped customer ids.
11. **Small items:** check `revenueCatService.ts:350` for the typo `(Purchases asany)`; `profiles.platform` is `web` on an Android device (is it ever set on native?); check that nothing relies on RevenueCat CustomerInfo for premium after `restore-key` (premium then comes from the Supabase flag); `PURCHASE_FLOW.md` is an old brainstorm (banner added); `SUPABASE_SCHEMA_ACCOUNTS.sql` is out of date (5.6).

## 6. Lessons learned (check these first when something looks wrong)

- **Supabase gateway:** with JWT verification on, a webhook with a shared-secret header is rejected before the function runs, so the function log stays empty. Deploy it with `--no-verify-jwt` (and `config.toml`).
- **`supabase-js` hides non-2xx bodies** behind a generic error, so a 404 from a function looks like "network error". Return business outcomes as 200, or read `error.context` (`asBusinessBody()`).
- **Function Logs tab has no HTTP status.** Use Edge Functions → Invocations, or log in the client.
- **Android Auto Backup** restores app data (stored alias/password, SDK cache) after reinstall; `android:allowBackup="false"` is set. Use `adb shell pm clear com.atcapp.app` for a clean state.
- **Play Billing prefers the installing Google account.** Test with one Google account on the phone and install from it.
- **RevenueCat transfer only happens on a restore.** The automatic post of an owned receipt does not transfer it. A dashboard Transfer or an iOS receipt restore does. On Android with Billing 8 the SDK's restore never posts (`getPurchaseHistory` `ERROR`), so the order id path is the supported one.
- **Do not chase the Android restore with SDK upgrades.** 9.29.0 behaves like 9.18.0. Plugin 12.x and 13.x need Capacitor 8 and nothing says they differ.
- **`verify_jwt = true` does not mean "a signed-in user".** The gateway accepts the public anon key as a JWT. An Edge Function that acts for a device must take the uid from `auth.getUser(token)`, never from the body (`claim-purchase` does; `restore-key` did not until 0.13).
- **A policy that reads `accounts` stops working for players once `accounts` is service-role only.** RLS applies inside policy subqueries; use a `security definer` helper instead (check after `harden_supabase.sql`).
- **Never restore a Google order id to a customer id chosen by the client.** RevenueCat staff: an order id is not proof of purchase by itself; use the server-known id (`auth.uid()` from the JWT), no unauthenticated endpoint, rate limit it.
- **Android Auto Backup cuts both ways.** It restores stored credentials and the SDK cache after reinstall (confusing for tests, but RevenueCat's own mitigation). Proposed in 2.12: keep it off until credentials move to their own store (4.1); it does not help after account deletion.
- **Sandbox/test purchases:** Apple sandbox needs "Clear Purchase History" for a true first purchase; otherwise RevenueCat sends `TRANSFER`. Google test purchases need a refund of the old order, or another license tester.
- **Postgres:** OUT columns named like table columns cause "column reference is ambiguous" (use `#variable_conflict use_column` or qualify). A policy that queries its own table gives `42P17 infinite recursion` when the policies reached through that subquery have subqueries of their own (`account_scores`); a plain `auth.uid() = id` policy does not (`profiles`). `delete from auth.users` cascades to `profiles`.
- **Backfills:** one repair script once inserted a profile for every `auth.users` row (about 500). Never re-add it.
- **Never paste secrets** (webhook secret, API keys, tokens, real passwords) into chats or screenshots. The webhook secret appeared in a screenshot on 2026-10-15; `FIX_PREMIUM.md` 0.2 records a rotation, so confirm.

## 7. Commands

```bash
# Android: clean state, logs
adb shell pm clear com.atcapp.app
adb logcat -c && adb logcat | grep -i -E "purchases|billing"
adb shell dumpsys package com.atcapp.app | grep -i ALLOW_BACKUP   # no output = backup disabled

# Deploy
supabase functions deploy revenuecat-webhook --no-verify-jwt
supabase functions deploy restore-key

# Builds (never run a bare app build for mobile; CAPACITOR_PLATFORM must be set)
pnpm run android:dev && pnpm --filter @atc-app/mobile exec cap open android   # then Run in Android Studio
pnpm run android:release     # or android:bundle
pnpm run build:mobile:ios && pnpm run cap:sync:ios && pnpm --filter @atc-app/mobile exec cap open ios   # then Run in Xcode
# Do NOT use dev:android / dev:ios: they run a bare app build (no CAPACITOR_PLATFORM), so the RevenueCat stubs are bundled
```

```sql
-- accounts and devices
select alias, is_premium, rc_customer_id, recovery_word is not null as has_word, updated_at
from public.accounts order by updated_at desc;
select id, account_id, is_premium from public.profiles order by updated_at desc limit 20;
-- sizes
select (select count(*) from auth.users) auth_users,
       (select count(*) from public.profiles) profiles,
       (select count(*) from public.accounts) accounts;
```

Debug overlay in the app: **Copy** copies state, logs and payment steps (payment steps are mirrored into it).

Device test guides (step by step, with pass criteria and troubleshooting): `docs/how_to/TEST_ANDROID.md` and `docs/how_to/TEST_IOS.md`.

## 8. Working agreement for the assistant

- Say what is verified and what is a guess. Never mark a task done without evidence from logs, screenshots or the database.
- Respect the "do not touch" list in `FIX_PREMIUM.md` rule 3 and `PURCHASE_FLOW_INSTRUCTIONS.md` section 10. Work in task order unless the user chooses otherwise; record deviations in Progress.
- Edit the user's **latest uploaded copy** of a file, say which file changed, and give ready-to-paste output. Keep `FIX_PREMIUM.md` and `PURCHASE_FLOW_INSTRUCTIONS.md` consistent.
- Commit messages: conventional commits (`fix(functions): …`), one task per commit; the changelog is generated from them.
- Ask for a file before relying on guesses about it.

## 9. Test identities (non-secret)

- Account `NEWTESTER` (`0cfc58e2…`), created through the Android purchase (deleted in the 2026-10-20 test; the Android purchase remains in Play and RevenueCat); `IPHONETESTER` (`fa726d41…`), created through the iPhone purchase. Passwords are in the developer's notes, not here.
- RevenueCat customers of interest (2026-10-24): `a38f5536…` (fresh uid after `pm clear`, no entitlement, USD 0), `4908a9e4…` (holds the live Play purchase of 2026-09-24 12:33 UTC, never transferred), `4e8aacae…` (TESTPLAYER, holds the purchase transferred from `5a914a6f…`). Earlier: `5b7afdfe…` (holds the Android purchase history), `4b665a80…` (iPhone). Play order `GPA.3305…` is the active Android test purchase; the 25 Sep order is refunded.

## 10. Pending decisions and next order

Decided: D11 passwords stay plain text (no hashing); D12 sandbox events keep granting premium (App Review buys in the sandbox); D13 a restored device keeps its own RevenueCat customer. To confirm (proposed in `FIX_PREMIUM.md`): D9 Android recovery via Google order id (2.8 before release; 2.9 and 2.10 may follow after launch), D10 no purchase tombstone table, 2.12 keep Auto Backup off until credentials have their own store (task 4.1).

Order of work: (1) 2.8 support procedure and Support ID; (2) 2.9 verify the REST v2 endpoint with curl, then build `restore-by-order`; (3) 2.10 client UI and wording; (4) 5.11 (plain-text safeguards, includes applying `harden_supabase.sql`) to 5.14 and the older leftovers (iOS tests 2/4 and 1.11 to 1.15, security SQL check, support contact in the delete wording); (5) 2.11 when the owner releases it. Phase 3 and 4 stay deferred.

## 11. Starter prompt (paste into a new chat)

> I am continuing the ATC-APP premium purchase/restore work. Read `CONTEXT_FIX_PREMIUM.md` first, then `FIX_PREMIUM.md` and `PURCHASE_FLOW_INSTRUCTIONS.md`. Today I want to work on task `<id>`: `<one-line goal>`. Do not assume anything not in those files; ask me for the files you need. When we finish, give me the Progress lines for `FIX_PREMIUM.md` and any changes to `CONTEXT_FIX_PREMIUM.md`.
>
> Attached: `CONTEXT_FIX_PREMIUM.md`, `FIX_PREMIUM.md`, `PURCHASE_FLOW_INSTRUCTIONS.md`, `LOGIN.md`, `SYNC_VERS.md`, plus `<files for this task>`.

Files usually needed per task: purchase/restore client: `monetization.ts`, `revenueCatService.ts`, `Paywall.vue`, `App.vue`. Premium and settings screens: `ProfileScreen.vue`, `AccountSettingsScreen.vue`. Server: the function's `index.ts`, the relevant `supabase/functions/<script>/*.sql`, `supabase/config.toml`. Versions and native: `package.json` (app and mobile), `SYNC_VERS.md`, `AndroidManifest.xml`.
