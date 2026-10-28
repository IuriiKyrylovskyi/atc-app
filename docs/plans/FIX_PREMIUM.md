# FIX_PREMIUM: payments, premium accounts and single-session play

Audience: a junior developer who completes every task in order.
Platforms: iOS first, then Android, then Web (Electron uses the web build).
Status: Phases 0 and 1 complete in code. The Phase 1 iOS device test is half done: tests 1, 3 and 4 (success path) verified on 2026-10-17 and 2026-10-18 (iPhone purchase, Mac restore and account switch, iPhone recovery by word), tests 2 and 5 and the negative cases of 4 pending. Phase 2 (Android) tested on a physical device (2026-10-15 to 2026-10-17): account creation and restore by alias + password work once RevenueCat holds the purchase, but RevenueCat's own Android restore does not (see Progress). Phase 3 (Web) is untested end-to-end. Phase 4 (single-session) is partially implemented in code but not exercised. Re-checked 2026-10-23 against the delete-account and restore-after-delete tests (see the Progress entries, and tasks 1.14, 1.15, 2.7, 4.11). Updated 2026-10-25: the Android SDK upgrade path was tested and closed (2.6, rolled back to 11.3.2), and an Android recovery plan that does not depend on the native restore was added (decisions D9 to D11 where D11 is decided: plain-text passwords stay, tasks 2.8 to 2.12 and 5.11 to 5.14). Verify each task with its "Done when" line.

---

## How to run this plan without overloading context

This plan is ~50 tasks across 6 phases. Executing it in a single session is not
realistic — context fills up, earlier reasoning is lost, and later tasks inherit
stale assumptions. Use these rules so the **plan file is the memory**, not the
session context.

### 1. Progress log lives in this file

Add a `## Progress` section (below). One line per completed task:

```
- [x] 0.2 Rotate webhook secret — done, new secret deployed, old `atc-app_webhook_secret_iurii712` retired
- [x] 1.4 Remove password as RC ID — done, `revenueCatService.ts` + comments updated
```

Unstarted tasks stay `[ ]`. Do not use a separate tracker — the file is the
single source of truth.

### 2. One task (or one small phase) per session

Do not batch. Each session ends with a short handoff so the next session can
re-ground in seconds.

### 3. Keep the handoff under 10 lines

It is a pointer, not a summary. Example:

```
HANDOFF: Phase 0 complete (0.1–0.11 all green, curl verified). Next: Phase 1 iOS.
Blocker: none. See docs/plans/FIX_PREMIUM.md Progress section.
```

### 4. Commit per task

Rule 1 of the plan already requires this. A clean git history is a second,
independent record of what happened, which survives context loss.

### 5. Do not use the board for this

This is solo work — the board has no other participants. Cross-agent updates
belong on the board; a plan-execution log belongs in the file.

### 6. Re-ground at session start with two reads

1. This file — the `## Progress` section plus the next unstarted task.
2. The file(s) the last task touched.

Skip re-reading the whole plan. If a task's "Done when" is ambiguous, read the
relevant source file rather than the entire phase.

### 7. Session-start checklist

1. Read only the `## Progress` section and the next unstarted `[ ]` task.
2. Read the file(s) that task touches — skip everything else.
3. If a prior task is marked `[~]` (partial), finish it before advancing.
4. Never re-read a completed phase to "catch up" — trust the Progress log.

### 8. Handoff format

End every session with a handoff under 10 lines. It is a pointer, not a
summary:

```
HANDOFF: <what is done> | Next: <next task> | Blocker: <none or describe>
```

The handoff becomes the first thing the next session reads. Everything else is
in the file.

### 9. Read the purchase-flow instructions first

Before touching any purchase/paywall/monetization code, read `docs/PURCHASE_FLOW_INSTRUCTIONS.md`. It documents the per-platform purchase flow (Android, iOS, Web/Electron), the identity model, the platform wiring (`CAPACITOR_PLATFORM` gating), what is confirmed working (do-not-touch list), and the per-platform test checklists. Code is left untouched for platforms confirmed working (Android native, iOS native).

---

## Progress

- [x] Doc sync: `SUPABASE_SETUP.md` aligned to live schema. Live DB verified: 13 accounts (all premium, 0 free), 451 profiles, 0 orphans.
- [x] 0.1 Inspect the live database — **run for real via the SQL editor, not inferred from docs.** Results:
  - `accounts` constraints: `accounts_alias_key` = `UNIQUE (alias)`; `accounts_pkey` = `PRIMARY KEY (id)`. **No unique constraint on `password`** (0.5 was already satisfied — nothing to drop).
  - `auth.users` trigger: `on_auth_user_created` → `AFTER INSERT ... EXECUTE FUNCTION handle_new_user()`. **The trigger IS running** — it is the only thing that writes `profiles`, and `profiles` has 451 rows.
  - Accounts: 13 premium, 0 free.
  - Functions present: `check_alias_availability` ✅, `generate_alias` ✅. `start_session` and `heartbeat` are NOT in this list — the Phase 4 session code exists in `SUPABASE_SCHEMA_ACCOUNTS.sql` (`heartbeat_play_session`, line 764) and `playSession.ts`, so it is implemented but under a different name than the plan assumed.
  - `check_alias_availability` grants: `PUBLIC`, `postgres`, `anon`, `authenticated`, `service_role` — **`anon` can execute it**, no grant change needed.
- [x] 0.2 Rotate webhook secret — done, new secret deployed to Supabase, old `atc-app_webhook_secret_iurii712` retired
- [x] 0.3 Remove secret from client — done, `VALIDATE_SECRET` and fallback removed from `Paywall.vue`, `validateWithServer` now no-op
- [x] 0.4 Deploy webhook without gateway JWT check — done, `config.toml` created with `verify_jwt = false`, function deployed
- [x] 0.5 Drop password unique constraint — already gone
- [x] 0.6 Ensure `generate_alias()` exists — done, verified via REST
- [x] 0.7 Webhook: read renamed attributes — done, reads `skm_alias`/`skm_secret` first, falls back to `alias`/`password`
- [x] 0.8 Webhook: link buying device with upsert — done, uses `upsert` with `onConflict: 'id'`
- [x] 0.9 Webhook: alias race fallback — done, generates unique alias when taken by different user, allows same user re-purchase, retry on 23505
- [x] 0.10 Verify with curl — done, alias race fallback works (TESTALIAS1 taken → ZGNJBFUY generated; same rc_customer_id keeps alias)
- [x] 0.11 Resend TRANSFER event — new test webhook confirmed HTTP 200
- [x] Webhook bugfixes (post-0.11): UNCANCELLATION fix, 90s session expiry, alias race same-user check, rc_customer_id immutable (except TRANSFER), TRANSFER lookup by transferred_from
- [x] 1.1 Local format rules — created `packages/app/src/lib/credentialRules.ts` with:
  - `ALIAS_RE = /^[A-Z0-9]{8,16}$/` and `PASSWORD_RE` with the same pattern (uppercase A–Z and digits 0–9)
  - `WORD_RE = /^[A-Z0-9]{4,16}$/`
  - `normalize(s) = s.trim().toUpperCase()`
  - Cross rules: alias ≠ password, word ≠ alias, word ≠ password
  - Updated `Paywall.vue` watchers and handlers to use local validation + debounced (400ms) RPC `check_alias_availability`
  - **Character set is `[A-Z0-9]` everywhere** (client `credentialRules.ts`, `monetization.ts`, `Paywall.vue`; server `validate-credentials`, `restore-key`, `recover-account`; SQL `SUPABASE_SCHEMA_ACCOUNTS.sql`, `SUPABASE_SETUP.md`, `Fix_claim_account_SQL.md`; and the `generate_alias()` / `generate_password()` alphabets). The narrower `[A-HJ-NP-Z2-9]` that `validate-credentials` shipped with was a leftover — it rejected 0/I/O that the client accepted, and was the last inconsistency removed.
- [x] 1.2 Alias availability by RPC — already implemented in `Paywall.vue` `onBuyAliasInput()` with 400ms debounce
- [x] 1.3 Confirm password locally — `passwordMatch` computed + `validateConfirm` in watchers, `VALIDATE_ENDPOINT` removed
- [x] 1.4 Remove the password as RevenueCat ID — removed `RevenueCatService.logIn(password)` from `handlePurchase` (Paywall.vue) and `handleWebPurchase` (Paywall.vue); updated `restoreAccount`, `initRevenueCat`, `loadAccount`, `restorePurchases` (monetization.ts) to use device Supabase uid / rc_customer_id; updated comments in monetization.ts, revenuecat-webhook, revenueCatService.ts to "RevenueCat user ID = device Supabase uid until Phase 4"
- [x] 1.5 Rename attributes — `skm_alias`, `skm_secret`, `user_id` used in all `setAttributes` calls (Paywall.vue, monetization.ts); webhook already reads them (Phase 0)
- [x] 1.6 Best Value block is static — LIFETIME package card changed to non-clickable `<div class="package-card featured package-card--static">` with CSS `.package-card--static { pointer-events: none; cursor: default; }`; web fallback block also static; auto-selected in `loadOfferings()`, CTA uses `selectedPackage.value`
- [x] 1.7 Fix the restore template — password row and character badges wrapped in `<template v-if="!restoreLostPassword">`, recovery-word row and badges in `<template v-else>`; no extra DOM divs; normally only alias and password visible, "I lost my password" shows alias and word
- [x] 1.8 Neutral pending state — after 30s timeout, shows "Purchase confirmed with the store. Finishing setup…" with green (success) styling and a "Check again" button calling `waitForPremiumAccount(15000)`; inputs not cleared
- [x] 1.9 Alias race message — after account appears, if server-assigned alias differs from typed alias, shows "Your alias was already taken, so yours is X. You can change it in settings." for 3s before closing; implemented in both native (`handlePurchase`) and web (`handleWebPurchase`) paths
- [x] 1.10 Debug badge for premium — DEBUG badge already shown at top of paywall panel (line 6) for both premium and non-premium branches when `VITE_SHOW_DEBUG=true` at build time
- [x] 1.11 Unlink device flow — `supabase/functions/unlink_device/unlink_device.sql` created and deployed. `unlinkDevice()` added to `monetization.ts` (calls `unlink_device` RPC, clears local state on success). "Switch to another account" and "Start fresh (free play)" buttons added to `Paywall.vue` for premium users. "Switch account" button added to `App.vue` restore modal. Deployed via Supabase dashboard SQL editor.
- [x] 2026-10-15 to 2026-10-17 Android physical-device session (Android 13, Play test track). Results:
  - **Webhook reachable.** RevenueCat "Send test event" returns 200 (`{"success":true,"action":"ignored"}`). The earlier failures were the Supabase gateway JWT check (see 0.4), which left the function's logs empty.
  - **Deployed `restore-key` differed from the repo.** It answered business outcomes with HTTP 404/403/409/400. `supabase-js` reports every non-2xx as a generic error, so the client showed "Network error" and never ran the `claim-purchase` fallback. The repo version (HTTP 200 for business outcomes) is redeployed, and the client now also reads 4xx bodies (`asBusinessBody()` in `monetization.ts`, used for `restore-key`, `recover-account` and the boot-time credential check).
  - **Account creation verified.** A dashboard Transfer of the purchase sent a `TRANSFER` webhook event. The webhook created account `0cfc58e2…` from `skm_alias` / `skm_secret`, linked the device and granted the first play session. After `adb shell pm clear com.atcapp.app`, Restore Account with alias + password restored premium (`loadAccount` then `logIn(rc_customer_id)`).
  - **RevenueCat's Android restore does not work on this stack.** With RC SDK 9.18.0 and Billing 8.0.0, `restorePurchases()` and `syncPurchases()` query purchase history through `getPurchaseHistory` (AIDL), which Play answers with `ERROR` ("No purchases found to restore"). The automatic sync at launch posts the receipt (`POST /v1/receipts` 200) but does not transfer it to the new App User ID, and the Play buy sheet returns `ITEM_ALREADY_OWNED`. Impact: a player who owns the purchase but has no `accounts` row (account deleted, or database lost) cannot get premium back without a dashboard Transfer. Players whose row exists restore by alias + password and are not affected.
  - **Play Billing prefers the installing account** (`Billing preferred account via installer` in logcat). Test with one Google account on the phone and install from that account.
  - **`android:allowBackup="false"`** is set. Reinstalls were restoring the stored alias and password through Auto Backup. Verified with `adb shell dumpsys package com.atcapp.app | grep -i ALLOW_BACKUP` (no flag present).
  - **Debug tooling.** Payment steps are mirrored into the global debug log (the overlay's Copy includes them), and the HTTP status and body of failed Edge Function calls are logged.
- [x] Webhook: revoking events (`REFUND`, `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`) no longer create an account when the customer has none (`action: "no_account_to_revoke"`).
- [x] `fix_credential_rpcs.sql` applied (the file is no longer in the repo; the live function bodies are the only copy, see 5.6). Diagnose query on 2026-10-15 showed `link_account`, `set_alias`, `set_password` and `restore_account` using `[A-Z0-9]` and `#variable_conflict use_column`. The one-off profiles backfill that this file used to contain was removed (see the cleanup item below).
- [ ] Apply and confirm, then tick (state not verified when this file was updated):
  - [~] `supabase/functions/harden_supabase/harden_supabase.sql` — `accounts` policy limited to `service_role`, `recover_by_word` and `restore_account` service-role only, legacy `claim_account` dropped. Applied 2026-10-25; the anon checks pass (Progress 2026-10-25); verified as role `authenticated` 2026-10-25 (`accounts` 0 rows), but it exposed two follow-ups: `get_account_for_device` leaks other accounts (fix: `harden_supabase_2.sql`) and the policies that read `accounts` now fail (fix: `fix_rls_recursion.sql`).
  - [x] `supabase/functions/harden_supabase/harden_supabase_2.sql` (written and applied 2026-10-25; evidence in Progress "production rollout") — caller guard on `get_account_for_device`, no `anon` EXECUTE on the guarded RPCs, `set_alias` / `set_password` service-role only (removes the `taken` password oracle), `generate_*` volatile and service-role only. Done when: its check query matches the expectation in the file, and `verify_hardening.sql` block 5 shows `other_account_rows` 0 and `own_account_rows` 1.
  - [x] `supabase/functions/fix_rls_recursion/fix_rls_recursion.sql` (rewritten 2026-10-25 from the live policies; applied 2026-10-25 after `harden_supabase_2.sql`; device check passed, step 6; rollback: `rollback_fix_rls_recursion.sql`) — SECURITY DEFINER helper `is_my_premium_account` for the `account_scores`, `account_progress` and `game_votes` policies, a `BEFORE UPDATE` trigger instead of the self-referencing non-decreasing check, and column privileges instead of the `profiles` subquery (which guarded `is_premium` but not `account_id`). Done when an `account_scores` upsert returns no 500. The Postgres log showed `42P17 infinite recursion detected in policy for relation "account_scores"`; the `profiles` update policy has the same self-reference.
  - [x] `supabase/functions/fix_advisor_warnings/fix_advisor_warnings.sql` — pins `search_path` on public functions and drops the legacy `user_scores` table. Verified applied 2026-10-25: every public function has `search_path=public` (block 3) and `user_scores` is gone (block 1).
- [~] **Free-device cleanup (database holds premium accounts only).** `profiles` grew from 3 test devices to 533 rows because a one-off repair script inserted a profile for every row in `auth.users`. Preview on 2026-10-17: 533 users, 10 kept (linked to account `0cfc58e2…`, premium, or created less than a day ago), 523 to delete. Run the delete in 5.3b, then tick. The trigger and the anonymous sign-in at boot still create rows until 4.6 and 5.2, so repeat the cleanup before Phase 5.
- [x] 2026-10-17 iOS device session (iPhone 17 sandbox purchase, Mac restore). Results:
  - **Test 1 verified.** Fresh install, alias + password typed, purchase at 20:17:23. Entitlements returned: `pro` and `pro_access`. Webhook log: `TRANSFER` (from `MAC23456789`, an older sandbox purchase of the same Apple ID), `Created new account fa726d41…`, `Set is_premium=true`, `Granted first play session to device 4b665a80…`. `accounts` has `IPHONETESTER` with `rc_customer_id` = the iPhone uid, and that profile is premium. About 2 s from purchase to account.
  - **First-purchase event still unverified on iOS.** The sandbox Apple ID already owned the product, so RevenueCat sent a `TRANSFER`, not `NON_RENEWING_PURCHASE`. See 1.11.
  - **Test 3 verified.** The Mac got a new uid (`5ab978b5…`), `restore-key` returned `success: true`, and the debug panel then showed premium with `accountId fa726d41…` and the alias.
  - **iOS recovers the "owned, no row" case by itself.** Apple's receipt lets RevenueCat transfer the purchase to the new uid, and the webhook rebuilds the account from the `TRANSFER` attributes (`password=present`). Android cannot do this (see the Android Progress entry).
  - **Stale session handled.** The Mac's stored auth token belonged to a user removed by the free-device cleanup; the app simply created a new anonymous user. The cleanup is safe for devices.
  - **`pro` entitlement is not used by the code** (see 5.10).
  - **Open:** after a successful restore the Mac debug panel showed `atc-app_user_alias_v1` and `atc-app_user_password_v1` empty while the in-memory state had the alias (see 1.12).
- [x] 2026-10-18 iOS follow-up (Mac, iPhone). Results:
  - **Switch account verified (Mac).** Restoring a different account on a linked device returns `already_linked` (correct). "Switch to another account" runs `unlinkDevice()`: the `unlink_device` RPC, a full local wipe, and RevenueCat re-bound to the device's own uid (`logIn` result `hasEntitlement: false`). A second restore, of `NEWTESTER`, then succeeded.
  - **Cross-store restore verified.** `NEWTESTER` was created by the Android purchase; the Mac (iOS) restored it and shows premium.
  - **Recovery by word verified, success path (iPhone).** Fresh install with a new uid, alias + recovery word, `restore-key` success, paywall closed, premium. This also shows that setting the word works. A reset is not separately evidenced.
  - **Stored credentials.** After the switch the Mac debug panel's localStorage section still showed the previous alias. The code stores credentials in `loadAccount()` and `restoreAccount()`, so this is probably a stale snapshot (see 1.12).
  - **Relinking is supported** (see 2.4). A linked device has no buy button, by design.
- [~] 2026-10-20 to 2026-10-23 delete-account and restore-after-delete tests (Mac iOS build, Android device). Results:
  - **Server deletion works.** `delete-account` log: `Deleting account…` then `Account deleted…`; the `accounts` row (NEWTESTER) is gone. The deployed function equals the repo (compared 2026-10-23; only line wrapping differs).
  - **Client bug found and fixed.** The Danger Zone showed "An error occurred" after a successful delete: `AccountSettingsScreen.vue` called `store.reset()` but only `monetization` existed, so a `ReferenceError` was caught by the generic `catch`. Now: local sign-out, `monetization.reset()`, `userScores.reset()`, `shiftProgress.reset()`, `gameStore.reset()`, `clearAppLocalData()` (new `lib/clearLocalData.ts`), then Intro. Also added `lib/safeStorage.ts` (never-throwing localStorage with an in-memory fallback) and fixed `userScores.reset()` leaving a stale `serverSnapshot`. Not yet re-tested on device.
  - **Restore-after-delete on iOS (Mac).** After the delete, a purchase by the new uid `1a2a701b…` produced `TRANSFER` (same sandbox Apple ID already owned the product). Webhook: `found account fa726d41… via old rc_customer_id 4b665a80…`, relinked it (`rc_customer_id` is now `1a2a701b…`), `is_premium=true`. The player ended on **IPHONETESTER with that account's own password; the alias and password just typed (`MACT…`) were ignored**, and the old alias-race message would have said "alias already taken". Expected per 2.4, but silent. See 1.14. NEWTESTER (created by the Android purchase) was the account deleted, so no duplicate accounts per Apple ID are involved.
- [~] 2026-10-23 device tests (iPhone 17, Android, Mac), webhook + delete-account redeployed:
  - **1.14 notice test (iPhone 17, same Apple ID, typed IPHONE17TESTER / 1234567890):** webhook `TRANSFER: found account fa726d41… among 1 old rc_customer_id(s) [1a2a701b]`; premium on, signed in as IPHONETESTER. Patched webhook confirmed live (all-ids lookup log line). **Hole found:** typed password equalled the old account's password by coincidence, so the "password differs" branch did not fire and the player would have seen "alias already taken". Fixed in the repo copy: the alias-differs message is now true in both cases. Needs rebuild + re-test (use a different typed password).
  - **Android restore-key with alias + password on a device whose own account was deleted:** `restoreAccount:restore-key ok`, premium restored cross-store. Works.
  - **Delete the account that holds the purchase, then buy again (Mac):** `delete-account` ok (deleted via device 1a2a701b, so the account shared with iPhone 17 is gone too, by design: every linked device is signed out). After restart: no stored creds (clearAppLocalData worked), new uid 589c5d16, buy with NEWMACTESTER / QWERTY1234 gave `TRANSFER: no account among 1 old rc_customer_id(s) [cd15bca8]` then `Created new account f01ea47c…`; `accounts` table has only that row with the typed credentials. **Verified (2.7 case 3).**
  - **To verify:** the debug panel's LOCALSTORAGE block still showed alias IPHONETESTER and an auth token for 1a2a701b after the purchase; probably a stale snapshot (press Refresh). Confirm `atc-app_user_alias_v1` = NEWMACTESTER and the password = QWERTY1234 after a purchase. Also untested: what the iPhone 17 does on its next launch now that its account and auth user were deleted from another device.
- [~] 2026-10-23 Android re-test on a new uid (`4e8aacae…`, Supabase tables wiped manually): Play answers "This item is already yours" (so the Google account owns it), the app runs `syncPurchases` + `restorePurchases`, RevenueCat returns `purchasedProducts: []` for the new uid, `claim-purchase` returns `not_entitled`, and restore-key returns `not_found` (account rows were wiped). Same result as the 2026-10-20 deletion test, so it is **not** an artifact of the manual DB wipe: Supabase is not involved in the failing step (RevenueCat never attaches the purchase to the new uid). Hypotheses, not yet checked: (a) Play Billing on the device returns no purchases to the SDK, (b) the SDK posts the token but RevenueCat does not transfer it because the post is not a restore. See 2.6 step 0.
  - **Restore-after-delete on Android: not possible by design today.** After deleting NEWTESTER the device got a new uid; Play answered `already active`, `restorePurchases` returned no purchases for the new uid, and `claim-purchase` returned `not_entitled` (`has no active pro_access`). This is the known "owned, no row" Android limitation (see the 2026-10-15 to 2026-10-17 entry). It is not a regression. Decision in 2.7.
- [~] 2026-10-23 Android 2.6 step 0 (diagnose), logcat from the failing device (uid `4e8aacae…`):
  - **Play does know the purchase.** `Querying purchases` finds one INAPP token (`OWYn…`); `lifetime` resolves as `inapp`, 264,99 UAH. The first lookup as `subs` returning `PRODUCT_NOT_FOUND` is the SDK trying both types and is not an error.
  - **The automatic sync does not post it.** The SDK logs `Tokens already posted` and `No pending purchases to sync` for this token. No `POST /v1/receipts` in this session. Likely the SDK remembers the token as sent under an earlier app user id (inferred from the log, not confirmed in SDK source).
  - **Manual Sync and Restore fail in `getPurchaseHistory`.** AIDL API v7, type=inapp returns a non-OK `ERROR`, then `No purchases found to restore`. Same as the 2026-10-15 to 17 finding. No receipt is posted, so RevenueCat's transfer logic is never reached.
  - **Dashboard.** `4e8aacae…` (ANDR3TESTER) and `c3ca2098…` (QWERTYUIOP): no entitlements, USD 0, Transfer Behavior = "Transfer to new App User ID". So Restore behavior is not what blocks the transfer. Neither customer holds the purchase.
  - **Holder found (dashboard + `all_customers.csv`).** The active purchase was on `5a914a6f-89c4-43de-8e64-67f35c9fce67` (alias NEWTESTER / secret 1234567890, the account deleted in the 2026-10-20 test). CSV row: `has_made_sandbox_purchase = t`, ownership PURCHASED, last seen 2026-10-16. A manual RevenueCat Transfer moved it to `4e8aacae…`, which now shows alias TESTPLAYER. `5a914a6f…` and `5b7afdfe…` (TESTPLAYER) have an identical `first_seen_at` (2026-09-24 22:21), so they are probably aliases of one RevenueCat customer, which would explain the TESTPLAYER attributes appearing after the transfer (inferred, not confirmed). Another Android customer, `4908a9e4…`, also has a sandbox purchase flag (not investigated). The CSV is a snapshot with no store, product or entitlement columns filled, so it cannot say whether the purchase on `5a914a6f…` is a Google or an Apple transaction. Net: RevenueCat held a purchase on a customer other than `4e8aacae…` and the Android SDK never moved it. The 2026-10-20 delete test fits this exactly (NEWTESTER deleted, purchase stayed on `5a914a6f…`, new uid got nothing).
  - **Verdict:** step 0 done. Chain: Play's `getPurchaseHistory` errors, so Restore never posts a restore receipt; the automatic launch sync posts with 200 but RevenueCat does not transfer a non-restore post; so after a delete the new customer never gets the purchase. Not a RevenueCat setting (Transfer behavior is "Transfer to new App User ID" everywhere). Dashboard Transfer and the Supabase restore-key (alias + password) both work as workarounds (2.7 step 4).
  - **Store check.** Both `4e8aacae…` (transferred from `5a914a6f…` at 2026-10-23 16:27 UTC) and `4908a9e4…` show `pro_access` from the Play Store `lifetime` product (UAH 264.99, USD 5.9 spent). Not Apple. `4908a9e4…` was bought 2026-09-24 12:33 UTC and was not transferred. The live Play token on the test phone has purchaseTime 2026-09-24 12:33:19 UTC (logcat, 2026-10-24), which matches the `4908a9e4…` purchase, so the token on the phone belongs to `4908a9e4…`; the purchase transferred to `4e8aacae…` (from `5a914a6f…`) is a different purchase. The earlier delete test (NEWTESTER) and this restore test therefore concern different purchases.
  - **`pm clear` re-test (22:39 local), new uid `fabb82f0…`.** Token cache empty (`Tokens already posted: []`). Play still reports the INAPP token. The SDK did `POST /v1/receipts` and got 200, but `fabb82f0…` in RevenueCat has no entitlement, USD 0 and no purchase in its history. So the automatic post succeeds and RevenueCat does NOT transfer the purchase to the new user (confirms hypothesis (b), consistent with 2026-10-15 to 17). The debug string for that post shows the third field `false` after the app user id; this is probably `isRestore = false` (inferred from the SDK log format, not confirmed). RevenueCat's Transfer behavior is documented as applying on restore, so a non-restore post would not move the purchase, and the manual Restore, which would post as a restore, never posts because `getPurchaseHistory` errors.
  - **Restore by credentials works.** App log: `restoreAccount:restore-key ok:true`. Supabase `accounts`: TESTPLAYER / TEST234567, `is_premium` TRUE, `rc_customer_id` = `4e8aacae…`. `profiles`: `fabb82f0…` is_premium TRUE, linked to the TESTPLAYER account. So premium on this device comes from the Supabase flag, while the device's RevenueCat customer (`fabb82f0…`) holds no entitlement. Check that nothing in the app relies on RevenueCat CustomerInfo for premium after restore-key.
  - **Side note:** `profiles.platform` is `web` for the Android device (`fabb82f0…`). Check whether it is a default value that is never set on native.
  - **Next:** 2.6 step 1 research. An SDK upgrade can fix this only if the restore path stops using `getPurchaseHistory` (Billing 8 removed the history API) so Restore posts with `isRestore = true`; confirm in the release notes before upgrading. Fallback if not: a native step reads the Play token (`queryPurchasesAsync`) and the server posts it to RevenueCat as a restore (custom code).
- [x] 2026-10-24 Android plugin trial `@revenuecat/purchases-capacitor` 11.3.2 -> 11.3.3 (peer `@capacitor/core >=7`). **Result: no fix, rolled back to 11.3.2 on 2026-10-25 (see the next entry).** Every 12.x and 13.x release needs `>=8` (checked with `npm view ... peerDependencies`), so 11.3.3 is the only plugin upgrade that keeps Capacitor 7. Release notes: iOS bugfix plus purchases-hybrid-common 17.55.2; nothing about restore.
  - `cap sync`: Android OK, now bundles purchases-android **9.29.0** (was 9.18.0). iOS `pod install` failed (local spec repo lacks PurchasesHybridCommon 17.55.2): moot after the rollback. After the rollback run `pod install --repo-update` once so the Pods match 11.3.2 again, and confirm `Podfile.lock` shows no diff in git.
  - `pm clear` launch on 9.29.0: Play token found; automatic `POST /v1/receipts` returns 200 for the new anonymous customer; no sign of a transfer (dashboard check of the new customer and of `4908a9e4…` still pending). Post line still shows `false, true` after the user id (probably isRestore=false, inferred).
  - **Manual Restore on 9.29.0 tested 2026-10-24 (result in the next entry).**
  - Check `revenueCatService.ts:350` for a typo `(Purchases asany)`.
  - Config checked: `variables.gradle` already minSdk 24 / compile+target 36; `proguard-rules.pro` keeps RevenueCat and billingclient classes, so R8 is an unlikely cause.
  - Policy note for delete-account design: Google Play says freezing or deactivating an account is not deletion; retention for fraud prevention or legal reasons must be disclosed. See the design options in the handoff of 2026-10-24.
- [x] 2026-10-24 to 2026-10-25 Android 9.29.0 manual Restore test, dashboard check, rollback, research:
  - **Log (9.29.0, `pm clear`, new uid `a38f5536…`).** At launch the SDK finds the Play token (hash `OWYn…`, purchaseTime `1790253199580` = 2026-09-24 12:33:19 UTC, the `4908a9e4…` purchase) and does `POST /v1/receipts` = 200. Manual Sync (04:34:32) and Restore (04:34:32 and 04:35:34): `Querying purchase history for type inapp`, then `getPurchaseHistory via AIDL (API v7)` returns a non-OK `ERROR`, then `No purchases found to restore`. No restore POST follows. `GET /v1/subscribers/...` returns 200, then 304: nothing changed. Same failure as on 9.18.0, so the SDK bump does not help.
  - **Dashboard check (screenshots 2026-10-24/25).** `a38f5536…`: no entitlements, USD 0, history only "First seen" and "Last opened" (2026-10-24 01:34 UTC), Transfer Behavior "Transfer to new App User ID". `4908a9e4…`: still holds `pro_access` from the Play `lifetime` product (UAH 264.99, USD 5.9), history shows only the 2026-09-24 12:33 purchase, **no TRANSFER event**, same Transfer Behavior. Confirmed: the automatic receipt post (200) does not transfer the purchase to the new customer, and it is not a dashboard setting.
  - **Rollback done.** `@revenuecat/purchases-capacitor` back to 11.3.2; logcat shows `SDK Version - 9.18.0` (verified by the owner). Branch `rc-upgrade` kept in case RevenueCat support asks for a retest.
  - **Research (RevenueCat docs and community, read 2026-10-25; not tested by us).**
    - RevenueCat documents this as a Play Billing 8 limitation (known-store-issues, "Restoring consumable purchases won't work in Billing Client 8"). Its remedies: recover the previous RevenueCat anonymous user id (Android Auto Backup), or transfer the purchase by the Google order id (`GPA…`, from the purchase email), either in the dashboard or with the REST API v2 "Restore by Order ID" endpoint (secret v2 key with read and write on Purchases Configuration). See 2.9 and 2.12.
    - A community thread from September 2026 describes our exact symptom (`ITEM_ALREADY_OWNED`, `restorePurchases()` empty, non-consumable) and gets the same answer: order id transfer.
    - RevenueCat staff guidance on that endpoint (community thread): a `GPA` order id is not proof of purchase by itself; restore only to a logged-in app user id chosen by the server, never one sent by the client; no unauthenticated endpoint that accepts an arbitrary order id; once an order is associated with a user, another customer gets a 422.
    - REST API v1 `POST /receipts` has an `is_restore` flag (marked deprecated): "triggers your configured restore behavior for any other users sharing the same fetch token". For Google it needs `product_id` and the `X-Platform` header, and the purchase token itself, which the SDK does not expose to JavaScript (would need a small native plugin). Kept as option C in 2.9, not planned.
  - **Conclusions.** (1) Do not upgrade the plugin or Capacitor to chase this: 11.3.3 changed nothing, 12.x/13.x need Capacitor 8 and nothing says they differ. (2) 2.6 is closed. (3) Android recovery for "owned, no account" moves to tasks 2.8 to 2.12. (4) RevenueCat support ticket and second-device test are postponed by the owner (2.11).
  - **Policy note (unchanged).** Google Play says freezing or deactivating an account is not deletion; any retention (for example RevenueCat keeping the customer, 2.7) must be disclosed in the privacy policy. Not legal advice; have the wording reviewed.
- [~] 2026-10-25 Phase 0 re-audit (owner asked to re-check every task from Phase 0 on). Evidence: code, the live project (anon-key probes that print only status codes and row counts; `supabase functions list` and `download`; `supabase secrets list`, names only) and the build artifacts.
  - **Deployed functions equal the repo.** `revenuecat-webhook` v44, `delete-account` v13, `restore-key` v13, `recover-account` v11, `claim-purchase` v11 and `validate-credentials` v7: the downloaded sources are byte-identical to the repo (before today's `restore-key` fix). `stripe-webhook` v11 is still deployed although the repo deleted it (see 5.7).
  - **0.2 verified.** The retired secret, a wrong secret and a missing header all get the function's own `401 Unauthorized`.
  - **0.3 verified.** No `VALIDATE_SECRET`, `VALIDATE_ENDPOINT` or `VITE_RC_WEBHOOK_SECRET` in the code or the local env files. No service-role key, webhook secret or `sk_` key in the web, Electron, Android or iOS bundles (matched by key tails, counts only). Netlify variables not checked (owner).
  - **0.4 verified.** The live webhook has `verify_jwt=false`; the 401 is the function's plain-text body, not the gateway's.
  - **0.7, 0.8, 0.9 and 0.12 verified in code** (live = repo). The 0.12 all-ids log line was already seen live on 2026-10-23, so 0.12 is ticked.
  - **0.1, 0.5, 0.6:** verified by blocks 6 and 7 of `verify_hardening.sql` (next entry).
  - **`harden_supabase.sql` applied by the owner** ("Success. No rows returned"). Anon probe: `accounts` 200 with 0 rows; `recover_by_word`, `restore_account` and `link_account` 42501; `claim_account` 404 (gone); `set_alias` and `set_password` answer `unauthorized` (the live bodies have a caller guard, the repo schema does not). `get_account_for_device` is executable by anon; whether it checks the caller is unknown. Pending: blocks 1 to 5 of `verify_hardening.sql` (the view of role `authenticated`, and the `account_scores`, `account_progress` and `game_votes` policies, which in the repo schema read `accounts` and would now fail for players).
  - **Found: `restore-key` took the uid from the request body** (0.13, fixed in the repo, deploy pending).
  - **Found in the webhook** (0.14, not changed): no server-side format check of `skm_alias` and `skm_secret` (`claim-purchase` has one); the `user_id` attribute is trusted without matching `app_user_id`; `purchased_at` is overwritten by every grant event, `TRANSFER` included; sandbox events grant premium in the production database.
  - **Found: `delete-account` is live with `verify_jwt=false`.** It checks the token itself (`auth.getUser`), so this is safe; now recorded in `config.toml`.
  - **Found: `stripe-webhook` is still live and public, and `STRIPE_WEBHOOK_SECRET` is not set.** A signature forged with an empty key and a garbage signature both answer 500 (Deno rejects a zero-length HMAC key), so it cannot be abused today, but only by accident. Delete it (5.7).
  - **Other.** `recover-account` comments still say the password is the RevenueCat ID and that `accounts` is readable with the anon key (both false now); with `accounts` locked, its missing rate limit is the main brute-force path (5.8, 5.13). A `claim-purchase` comment says `accounts.password` is unique (false since 0.5). Supabase secrets hold `RC_SECRET_API_KEY` and `DB_SERVICE_ROLE_KEY`, which no function reads (`claim-purchase` reads `REVENUECAT_SECRET_API_KEY`). The Electron `premium:check` IPC handler (service-role key from the main-process env) has no caller in the app.
- [~] 2026-10-25 `verify_hardening.sql` results (owner ran blocks 1 to 7):
  - **Block 1.** RLS on for `accounts`, `profiles`, `account_scores`, `account_progress`, `game_votes`; `user_scores` gone; `claim_account` gone.
  - **Block 2: policies broken for players.** Every `account_scores` and `account_progress` policy and the `game_votes` insert/update policies read `accounts`, which is service-role only since `harden_supabase.sql`, so they can never pass. The `account_scores` update policy also reads itself (42P17), and its non-decreasing check compares `account_scores_1` with itself. The `profiles` update policy also reads itself, but that does not raise 42P17 (the `profiles` select policy it reaches has no subquery), so profile updates work; the real gap is that it guards only `is_premium`, so a device can set its own `account_id` to any account id it knows and then read that account's password through `get_account_for_device`. Fix for all of these: `fix_rls_recursion.sql`.
  - **Block 3.** All functions are SECURITY DEFINER with `search_path=public` (except `generate_*`, invoker). `link_account`, `recover_by_word`, `restore_account` are service-role only. `get_account_for_device` has no caller check and anon can run it. `generate_alias` / `generate_password` are declared IMMUTABLE although they call `random()`.
  - **Block 4.** The premium devices with the most data are 5 devices of TESTPLAYER with 0 scores, 0 progress, 0 votes: no premium-linked account has any score row, which fits the 42P17 (score sync has never stored anything; the leaderboard shows 0 for everyone).
  - **Block 5: password leak confirmed.** As role `authenticated` (device `a38f5536…`): `accounts_visible` 0, `profiles_visible` 1, `own_account_rows` 1, **`other_account_rows` 1**: any signed-in device, and anon, gets the alias, password and recovery word of any device uid it names. Fix: `harden_supabase_2.sql`.
  - **Block 6 (0.1, 0.5).** `accounts`: primary key and `UNIQUE (alias)`; no unique constraint or index on `password`. `profiles`: `account_id` FK `ON DELETE SET NULL`, `id` FK to `auth.users` `ON DELETE CASCADE`. Trigger `on_auth_user_created` exists. 0.1 and 0.5 verified.
  - **Block 7 (0.6).** `generate_alias()` exists: 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0, 1, I, O; a subset of `[A-Z0-9]`, so valid), no uniqueness loop (the webhook retries once on 23505). `generate_password()` 12 characters, same alphabet. 0.6 verified. `set_password` still answers `taken` when another account has the candidate (a password oracle, contradicting 0.5). `recover_by_word` still says the password is the RevenueCat appUserID. `link_account` and `restore_account` printed a broken regex, but the export dropped every `$…$` span (`AS function` instead of `AS $function$`), so it is an export artifact, not the live code (restore works on devices). For the 5.6 snapshot, download the CSV file instead of copying from the grid.
  - **Found in the build scripts:** `dev:android` and `dev:ios` run `pnpm --filter @atc-app/app build` without `CAPACITOR_PLATFORM`, so they bundle the RevenueCat and AdMob stubs (the exact bug CONTEXT.md fixed for the other scripts); `dev:android` is also Windows-only (`gradlew.bat`, backslash paths) and `dev:ios` targets the simulator. Use `android:dev` / `build:mobile:ios` plus `cap sync` and run from Android Studio or Xcode until the scripts are fixed.
  - **Found in the client:** `loadAccount()` reads `row.rc_customer_id`, but `get_account_for_device` does not return that column, so the RevenueCat re-bind after a restore (`logIn(rc_customer_id)` native, `initWeb(rc_customer_id)` web) has never run. Premium after a restore comes from the Supabase flag only, which matches the 2026-10-24 observation that the restored device's RevenueCat customer holds no entitlement. See 1.16.
- [~] 2026-10-25 production rollout (owner runs each step, guide in the chat of 2026-10-25):
  - **Step 1, `harden_supabase_2.sql` applied.** Check grid as expected: `get_account_for_device`, `cast_vote`, the three play-session functions and `set_recovery_word` executable by `authenticated` only; `set_alias`, `set_password`, `generate_alias`, `generate_password` by neither `anon` nor `authenticated`; `generate_*` now volatile. `verify_hardening.sql` block 5: `own_account_rows` 1, **`other_account_rows` 0** (was 1), so the leak is closed. Block 3 shows the `auth.uid()` guard in `get_account_for_device`. Anon probe: `get_account_for_device`, `set_alias`, `set_password`, `generate_alias`, `cast_vote` answer 401 `42501`; `get_leaderboard` and `check_alias_availability` still 200.
  - **Step 2, `fix_rls_recursion.sql` applied.** Check grid: no policy reads `accounts` or itself; the score, progress, vote insert/update and profile update policies are for `{authenticated}`; the `game_votes` and `profiles` select policies are unchanged (`{public}`). `profiles` with a `last_passed_level`: 0 of 303. Not conclusive: the client writes it only while premium (`markLevelPassed`, `flushProgressToServer`), and few premium devices exist. The device test (step 6) decides.
  - **Step 3, `restore-key` v14 deployed** (16:19 UTC, `verify_jwt=true`, downloaded source byte-identical to the repo). The anon key as bearer now gets `{"success":false,"error":"unauthorized"}` 401 (was: link any uid); no bearer gets the gateway 401. Device restore pending (step 6).
  - **Step 4, `revenuecat-webhook` v45 deployed** (16:24 UTC, `verify_jwt=false`, downloaded source byte-identical to the repo). RevenueCat "Send test event" (type `TEST`, `SANDBOX`): 200 `{"success":true,"action":"ignored"}`, so the constant-time check accepts RevenueCat's header. The retired secret, a wrong secret and no header: 401. A real purchase with the new input checks is still to be seen (2.5, 1.11).
  - **Step 5, `stripe-webhook` deleted.** `functions list`: `revenuecat-webhook` v45, `delete-account` v13, `restore-key` v14, `recover-account` v11, `claim-purchase` v11, `validate-credentials` v7. Its URL answers 404 `NOT_FOUND`. 5.7 ticked.
  - **Step 6, Android device test** (Xiaomi 2201116SG, Android 13 / MIUI 14, debug build 0.0.154 from `android:dev`; the Play-installed release was uninstalled first because of the signature mismatch). Bundle check: real native RevenueCat plugin present, stub absent. New uid `dba3859b…`.
    - **Restore:** `restoreAccount:restore-key {"ok":true,"success":true}`; premium; no RevenueCat `logIn` after it (1.16). Logcat (about 95k lines) has no permission-denied, `42P17` or score warning.
    - **Relaunch:** `Monetization ready, premium: true` without typing anything (startup credential check through the new `restore-key`).
    - **Score sync works for the first time:** `account_scores` got `yssy:red-eye` and `cyyz:red-eye` (the first rows ever), and `profiles.last_passed_level` = `yssy:1` for the device, so the column grant allows the client's progress update. `max_planes` is 0 on both rows, which is correct under the current rule: the log says `Level 16 complete — 0 landed, 20 waypoint passes`, and `max_planes` counts landings only (see the finding below). SQL tests as the device's role `authenticated`, rolled back by design: upsert to 5 then update to 1 leaves `max_planes = 5` (the update branch of the upsert and the keep-best trigger work); `update profiles set account_id = null` answers `permission denied for table profiles` (a device can no longer re-point itself). Both tests are in `docs/how_to/TEST_ANDROID.md`.
    - **Finding (game design, owner):** a shift completes on handled planes (landed + waypoint passes), but `account_scores.max_planes` and the leaderboard count only landed planes, so a red-eye shift flown entirely through waypoints scores 0. Owner 2026-10-25: the rule is correct; landing traffic is not implemented yet (work in progress) and the per-shift settings will be adjusted.
    - **Finding (UI):** the Profile screen's Statistics (Games Played, High Score, Planes Landed, Perfect Runs) are hard-coded `0` in `ProfileScreen.vue` (lines 66 to 81); not a data problem. The leaderboard screen is not built yet. Owner 2026-10-25: both will be implemented soon.
    - **Noise:** `Paywall.vue: closing - resetting input state` repeats every few seconds while the paywall is hidden; `requestFullscreen` fails without a user gesture; `monetization: init complete` is logged twice. `profiles.platform` is `web` on this Android device again (known item).
  - **Step 7, iOS build on the Mac ("My Mac (Designed for iPad)", RevenueCat iOS SDK 5.51.1): passed.** Pods: `pod install --repo-update` clean, `Podfile.lock` unchanged. The Mac (uid `589c5d16…`) was premium on NEWMACTESTER; "Switch to another account" unlinked it (`Local logout (device unlinked)`, `logIn` to its own uid; RevenueCat says "same as the one already cached", as expected), then restore by alias + password: `restoreAccount:restore-key {"ok":true,"success":true}`, account `343592e2…` (TESTPLAYER). The debug panel's LOCALSTORAGE block still showed NEWMACTESTER right after (1.12; press Refresh). Xcode log: no Supabase or sync error; `No packages … web_offering` (the Paddle offering has no iOS product, expected) and `Failed to save codable to cache` (RevenueCat cannot write its cache folder in the iPad-on-Mac sandbox) are benign.
    - **Found, UX (owner):** "Switch to another account" on the Premium account screen (`AccountSettingsScreen.vue`) unlinked the device and stayed on the page with no feedback, so it was pressed four times; a failure was never shown either (`switchError` was not rendered). Fixed in the repo: on success it replaces the screen with Home and opens the paywall scrolled to the restore form (`?paywall=restore`, handled by `StripPage.vue`, new `focus` prop on `Paywall.vue` that never falls back to an automatic store restore); a failure shows under the button. Both switch buttons (Premium screen and paywall) are disabled and read "Switching..." while it runs. Verified on the Mac: `Paywall.vue: scrolled to the restore form {"attempt":0}`, then restore of TESTPLAYER `ok:true`.
    - **Found and fixed in the repo (D14: the iOS app ships on Macs), layout:** the gray band at the bottom of the Mac window is the **native scroll bar** of the WebView's outer scroll view (Xcode View Debugger: `WKWebView` → `WKScrollView` → `_UIScrollerImpContainerView`). macOS draws it as a track while the window is active ("Show scroll bars: Always" or a mouse), for free and premium alike; the Safari inspector could not see it because it is not page content. The page never scrolls (fixed body and #app), so `ViewController.swift` now hides both scroll indicators in `capacitorDidLoad()`; scrolling itself stays on, because iOS uses it to lift a focused input above the keyboard. Verified 2026-10-28 by the owner: no gray band on the Mac, and on iPhone / Simulator the Paywall password field still moves above the keyboard. The first guess (`100vh` shorter than the window) was wrong, and that change was not committed.
    - **Found, security (5.11 item 3):** the overlay's Copy output contains `userPassword` in clear and the whole `sb-…-auth-token` (access and refresh token). One copy was pasted into a chat on 2026-10-26; revoke that session (`auth.sessions` row of the Mac device) after the test. Mask both in the overlay and keep it out of release builds. The full output, with new tokens of the same session, was pasted again on 2026-10-26; the single `delete from auth.sessions where id = '233d8c08…'` revokes all of them.
    - **Results:** LOCALSTORAGE Refresh after the restore shows `atc-app_user_alias_v1` = TESTPLAYER (so the earlier NEWMACTESTER was a stale snapshot); relaunch: `hasStoredAlias: true, hasStoredPassword: true`, premium TESTPLAYER without typing (1.12 done). One shift: `account_scores` row `kjfk:red-eye` and `profiles.last_passed_level` = `kjfk:1` for the Mac device `589c5d16…`. First full run of `docs/how_to/TEST_IOS.md`.
- [~] 2026-10-26 5.11 items 2 and 3 (logs and debug views):
  - **Item 2, no password in any log: verified in code.** Client: `setAttributes` logs attribute keys only, RevenueCat ids are masked (`maskId`), credential errors log codes only; request bodies carry the password but are not logged. Edge Functions: the webhook logs `password=present` and the public alias, `restore-key` and `recover-account` log outcome codes, `claim-purchase` masks ids. The session's leak was in what the debug views **display**, not in logs.
  - **Item 3, debug views: fixed in the repo.** The global debug panel was rendered in every build (`isVisible = ref(true)`, unconditional in `App.vue`) and showed `userPassword`, `recoveryWord` and the whole `sb-…-auth-token` (access and refresh token); the paywall's own DEBUG block showed the password, the recovery word and the typed password, confirm and restore inputs. Now: `App.vue` loads the panel only when `VITE_SHOW_DEBUG=true` (lazy chunk; a build with the flag off contains no panel code, verified by grepping the bundle), and both views show every secret as `set (N chars)` and the session as `session for <uid prefix>, expires … (tokens hidden)` (`lib/redact.ts`, checked against fake values). Still needed for item 3: build releases with `VITE_SHOW_DEBUG=false`; a release-script guard was offered and declined by the owner (2026-10-26), so this stays a manual release step.
  - **Leaked session revoked:** `delete from auth.sessions where id = '233d8c08…'`; `select count(*)` on that id now returns 0 (owner, 2026-10-26).
- [~] 2026-10-28 5.13 device test (owner, two iPhones, build with the new messages):
  - **iPhone not linked, made-up alias `RLTESTIPHONE15`: passed.** Five wrong passwords answer `restore-key` `not_found`, the sixth `rate_limited`, and the paywall shows "Too many attempts. Try again in 60 minutes."; no logout. 5.13 ticked.
  - **Found, restore UX (owner):** on the iPhone whose Apple ID bought NEWMASTER, "Switch to another account" and then a made-up pair restored the device **to NEWMASTER**. Cause: `restoreAccount()` fell back to `claimPurchase()` on `not_found`; with D13 the device keeps its RevenueCat customer, which still holds `pro_access`, so `claim-purchase` found NEWMASTER by `rc_customer_id` and linked it, ignoring the typed pair. Not a security hole (the store purchase proves ownership), but a wrong pair must answer "No user found", and the fallback also ran a store restore on every wrong guess (an Apple ID prompt on iOS when signed out) and, after a reinstall, could create a second account from a typo before the `TRANSFER` webhook arrived.
  - **Fixed, passed on device (owner, same iPhone after "Switch to another account"):** a wrong pair answers "No user found" and the device stays free; "Try to restore your data automatically" brings the purchase's premium account back. The fallback is removed from `restoreAccount()`. The receipt path moved to where the player asks for it: the native "Try to restore your data automatically" calls `claimPurchase('', '')` when the store shows `pro_access` but the device has no account; with no pair, `claim-purchase` only links an account the purchase already has (`invalid_credentials`, nothing written, otherwise), and the existing 30 s wait for a `TRANSFER` webhook still follows. Test: `TEST_IOS.md` / `TEST_ANDROID.md` step 5, items 5 and 6.
  - **Found, paywall UX (owner):** while a request ran, a tap outside the panel closed the paywall and the other buttons still worked. **Fixed in the repo (not yet on device):** `Paywall.vue` runs every request button through `runAction()` (one at a time, keyboard hidden, spinner on the pressed button); while `isBusy`, a capture-phase guard on the panel drops clicks and typing, the close button, the backdrop and Android Back (`lib/paywallBusy.ts`, checked in `App.vue`) do nothing, and every control is dimmed. The panel still scrolls; the web checkout container stays usable (Paddle has its own cancel). The restore and recovery success paths now await their 700 ms before closing, so nothing can be tapped in between. Test: step 5, item 7.

---

---

## 0. Rules for the whole job

1. One task = one commit. After each task run `pnpm lint` and `pnpm --filter @atc-app/app exec vue-tsc --noEmit`, then run the test for that task.
2. Never put a secret in a `VITE_*` variable. Vite copies every `VITE_*` value into the client bundle, so anyone can read it.
3. Do not touch (these already work): native RevenueCat initialization, `packages/app/src/lib/supabase.ts` (plain fetch fix), `capacitor.config.ts`, `Info.plist` (SKAdNetwork), the plugin dependencies already in `packages/mobile/package.json`.
4. Do phases in order. Phases 0 to 3 fix payments on the **current** database design. Phase 4 changes the design, and Phase 5 deletes data. Do not start Phase 4 before Phases 0 to 3 pass on all three platforms.
5. If a task says "verify" and the result differs from what is written here, stop and report the result. Do not improvise.

---

## 1. Product rules (agreed)

- Premium unlocks 17+ extra airports, stores progress and results, lets the player continue on any device, and allows voting for new planes and airports.
- There is no email or login. Identity is:
  - **alias**: unique across the database, public on leaderboards, 8 to 16 characters.
  - **password**: not unique, 8 to 16 characters, chosen by the player.
  - **recovery word** (optional): 4 to 16 characters, letters A-Z and digits 0-9, no spaces. Alias plus recovery word restores a forgotten password.
- The database stores premium accounts only. Free players have no database rows and keep progress in local storage.
- An account is created only by the RevenueCat webhook after a successful payment.
- A device keeps alias and password in local storage. Clearing storage signs the device out. It never deletes the account, and the device can then sign in to any other premium account.
- Only one active game session per account. A second device sees a waiting page.

---

## 2. Decisions

| #   | Topic                                                       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `handle_new_user` trigger                                   | **Running.** Verified in 0.1: the trigger exists on `auth.users` and `profiles` has 451 rows, which it is the only writer of. It creates an empty `profiles` row per anonymous signup — that is the transitional device link the webhook upserts into (0.8). Phase 4 replaces the profile link with a session claim; Phase 5 removes the trigger.                                                                                                                                                                                                                                                                                                                                                                      |
| D2  | Unique password                                             | `SUPABASE_SETUP.md` shows `password text unique`. Alias is the only unique field. Task 0.1 checks the live constraints. If a unique constraint on `password` exists, task 0.5 drops it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D3  | RevenueCat user ID                                          | Not the password. Not alias + password (see below). Phases 1 to 3: keep the current device Supabase uid. Phase 4: a random UUID generated once per install.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D4  | Device link in the database                                 | Removed in Phase 4. Local storage plus a single session record replaces it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D5  | Validation calls                                            | Format checks run only in the client. Only alias availability needs the server. Task 1.1 and 1.2 do this. The `validate-credentials` edge function is retired in Phase 4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D6  | Single session                                              | Phase 4. Heartbeat every 30 s, session lifetime 90 s. The database stores one `active_device_id`, not a device list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D7  | Recovery word                                               | 4 to 16 characters, A-Z and 0-9, no spaces. No hashing (D11). Revised 2026-10-28: guesses are rate limited (5.13); the minimum stays 4 (owner).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D8  | Alias race                                                  | See section 2.2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D9  | Android recovery (proposed 2026-10-25)                      | Alias + password is the primary restore on every platform. Native store restore is best-effort on Android (Billing 8 limitation, see Progress 2026-10-24/25). When the player owns the purchase but has no account: Google order id through a server function (2.9, 2.10); support Transfer as fallback (2.8). Staging (proposed): 2.8 must ship before release; 2.9 and 2.10 can ship after launch if support volume is low, once the 2.9 curl check shows the endpoint works.                                                                                                                                                                                                                                        |
| D10 | Purchase tombstone (proposed 2026-10-25)                    | Not building one. RevenueCat and the store already keep the purchase record (2.7 keeps the RevenueCat customer), and order-id recovery does not need our own record. A hashed-order-id table would only add data to disclose. Revisit only if abuse appears.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D11 | Password storage (decided 2026-10-25)                       | **Passwords stay plain text. Owner decision, obligatory:** the product shows the password to the player (Profile screen) and recovery by word returns it. No hashing, so no reset-on-recovery. Because of this, the compensating controls in 5.11 are release blockers, not nice-to-haves.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D12 | Sandbox events (decided 2026-10-25)                         | The webhook accepts `environment = SANDBOX` events and grants premium in the production database. App Review and TestFlight buy in the sandbox against the production build, so ignoring them would fail review (RevenueCat recommends handling sandbox in production). Sandbox accounts can be found through the webhook log or the RevenueCat customer; tag them in the database only if they ever need separate handling.                                                                                                                                                                                                                                                                                           |
| D13 | RevenueCat identity after restore (decided 2026-10-25)      | A restored device keeps its **own** RevenueCat customer (its Supabase uid); it never logs in as the buyer's customer. Premium comes from the account row (D3). `accounts.rc_customer_id` stays the buyer's customer, so refund and revoke events still find the account and clear every linked device. An iOS restore with the same Apple ID moves the purchase to the restoring device and the `TRANSFER` updates `rc_customer_id` (verified). Rejected: sharing one RevenueCat id per account (needs `get_account_for_device` recreated, can mix two accounts' purchases after a switch, and conflicts with 4.6).                                                                                                    |
| D14 | Desktop platform (decided 2026-10-26, revised the same day) | **Mac App Store = the iOS app as "Mac (Designed for iPad)"** (Apple-silicon Macs; same app record, same `pro_access_unlock` purchase and RevenueCat setup, so an iPhone purchase restores on the Mac with the same Apple ID). Xcode: `SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = YES`, `SUPPORTS_MACCATALYST = NO` (AdMob, UMP and IONFilesystemLib have no Mac Catalyst slice; the Catalyst build fails), Apple Vision off (`SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD = NO`). App Store Connect: keep Apple-silicon Mac availability **on**. The **Electron** build stays the direct download (Windows, Linux, Intel Macs). Blocker before the Mac release: the gray band at the bottom of the window (Progress 2026-10-26). |

### 2.1 Why the RevenueCat ID is not alias + password

- RevenueCat IDs show up in its dashboard, webhook payloads and logs. That would expose the password. RevenueCat already hides a subscriber attribute named `password`, which tells you they treat it as sensitive.
- Alias and password can be changed later (`set_alias` exists). If the ID changes, a later refund or cancel event cannot find the account.
- The alias is public on leaderboards, so the ID would be half public.
- A random UUID is unique, never changes, and reveals nothing. The ID is only a correlation key between a payment and an account. Premium status itself comes from our database, not from RevenueCat.

### 2.2 Alias race: what it is and the fix

1. Players A and B both type alias `PILOTALPHA` while neither has paid. The availability check passes for both.
2. A pays first. The webhook creates the account `PILOTALPHA`.
3. B pays a minute later. The webhook tries to insert `PILOTALPHA` and the database rejects it.
4. B has paid and has no account.

Fix (Phase 0): when the alias is taken at webhook time, create the account with a generated alias (`generate_alias()`), return success to RevenueCat, and show B a message with the alias they actually got. B can change it with the existing alias-change feature. The paying customer is never left without an account.

> **Note:** Aliases are **not reserved before payment**. The `check_alias_availability` RPC is read-only. Accounts are created **only by the webhook** on confirmed purchase events (`INITIAL_PURCHASE`, `RENEWAL`, etc.). No database rows exist for free players or for alias choices that never resulted in a payment.

### 2.3 Risk noted 2026-10-17 (decision D7 unchanged)

`recover-account` has no throttling. The alias is public on the leaderboard, the recovery word can be as short as 4 characters, and the response contains the account password, so the word can be brute-forced (about 1.7 million guesses for letters and digits). Before release, raise the minimum length and add an attempt limit per alias (for example a counter and a lockout window in the database).

### 2.4 Relinking a device (behavior, verified 2026-10-18)

A device is linked to at most one account. Restoring a different account on a linked device returns `already_linked`. The supported way to relink is **Switch to another account** (or "I lost my credentials — start fresh"): `unlinkDevice()` calls `unlink_device`, wipes the local premium state and re-binds RevenueCat to the device's own uid. Nothing is deleted; the old account stays and can be restored again by alias and password. The device is then free and can restore another account or buy a new one.

A premium, linked device has no buy button, by design. A store account can own the lifetime product only once (Apple and Google both block a second purchase), so buying again from the same Apple ID or Google account only happens in tests: clear the sandbox tester's purchase history (App Store Connect), or use another sandbox or license-tester account. In production a returning player restores with alias and password.

"Clear local data" is not a relink: it clears local state only, and the server link stays (the next restore of another account still returns `already_linked`). If a purchase did reach the webhook from a linked device, the webhook would re-point the device to the new account.

---

## 3. Target flows

**New purchase:** client checks formats locally, then alias availability by RPC. The CTA is the only purchase trigger. The client sets RevenueCat attributes `skm_alias` and `skm_secret` and buys. The webhook creates the account (generated alias if taken). The client polls for the account for up to 30 s, then shows a neutral pending message with a **Check again** button.

**Launch and Start Game (Phase 4):** no stored credentials means free mode, with no database call. Stored credentials mean sign in anonymously, then `start_session(alias, password)`:

- `ok`: premium mode.
- `session_busy`: go to `/waiting`.
- `not_found` or `not_paid`: clear stored credentials and continue as free, with a message.

**Waiting page:** text: "Your game is already running on another device. Close it there to continue here." It calls `start_session` every 10 s. On success it redirects to Home automatically. An active device whose heartbeat fails goes to `/waiting`.

**Restore on another device:** alias plus password only. "I lost my password" swaps the password field for the recovery word. Alias plus word returns the password, and the device stores both locally.

---

## Phase 0: backend (shared, do first)

- [ ] **0.1 Inspect the live database.** In the Supabase SQL editor run these (read-only). Paste the output in the pull request.
  ```sql
  select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.accounts'::regclass;
  select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
  select count(*) filter (where is_premium) as premium, count(*) filter (where not is_premium) as free from public.accounts;
  select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('generate_alias','check_alias_availability','start_session','heartbeat');
  select grantee from information_schema.routine_privileges where routine_name = 'check_alias_availability';
  ```
  Done when: you know whether the trigger and the password constraint exist, and whether `anon` can execute `check_alias_availability`.
- [ ] **0.2 Rotate the webhook secret.** Generate a long random value. Set `REVENUECAT_WEBHOOK_SECRET` in Supabase secrets and in the RevenueCat webhook Authorization header (`Bearer <value>`). The old value `atc-app_webhook_secret_iurii712` is public.
- [ ] **0.3 Remove the secret from the client.** Delete `VALIDATE_SECRET` and its fallback literal from `Paywall.vue`. Delete `VITE_RC_WEBHOOK_SECRET` from every `.env*` file and from Netlify.
- [ ] **0.4 Deploy the webhook without the gateway JWT check.** RevenueCat sends a shared secret, not a JWT, so Supabase's gateway returns 401 before the function runs. Add to `supabase/config.toml`:
  ```toml
  [functions.revenuecat-webhook]
  verify_jwt = false
  ```
  then run `supabase functions deploy revenuecat-webhook --no-verify-jwt`. The function still checks the secret itself (keep that code).
- [ ] **0.5 Make alias unique and password non-unique.** If 0.1 shows a unique constraint on `password`, drop it with the name from 0.1: `alter table public.accounts drop constraint <name>;`. Confirm a unique constraint on `alias` exists, and add one if not.
- [ ] **0.6 Make sure `generate_alias()` exists.** If 0.1 shows it missing, create it:
  ```sql
  create or replace function public.generate_alias() returns text language plpgsql as $$
  declare chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; result text; i int;
  begin
    loop
      result := 'PILOT';
      for i in 1..7 loop result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
      exit when not exists (select 1 from public.accounts where alias = result);
    end loop;
    return result;
  end $$;
  ```
- [ ] **0.7 Webhook: read renamed attributes.** In `supabase/functions/revenuecat-webhook/index.ts`, read `skm_alias` and `skm_secret` first, then fall back to `alias` and `password`. This avoids RevenueCat hiding the value. Keep reading `user_id` for now (transitional link).
- [ ] **0.8 Webhook: link the buying device with an upsert** (transitional, needed while the current policies use `profiles`). Replace the `.update(...).eq('id', deviceId)` on `profiles` with:
  ```ts
  await db
    .from('profiles')
    .upsert(
      { id: deviceId, account_id: accountId, is_premium: isPremium, updated_at: now },
      { onConflict: 'id' }
    );
  ```
- [ ] **0.9 Webhook: alias race fallback.** Where the code checks `existingAlias`, replace the early return with:
  ```ts
  let finalAlias = alias;
  if (existingAlias && existingAlias.length > 0) {
    const { data: generated } = await db.rpc('generate_alias');
    finalAlias = generated as string;
    console.warn(`Alias ${alias} taken, assigned ${finalAlias}`);
  }
  ```
  Use `finalAlias` in `claimValues`. Also catch Postgres error code `23505` on insert and retry once with a generated alias.
- [ ] **0.10 Verify with curl** (replace the placeholders):
  ```bash
  curl -X POST "https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook" \
    -H "Authorization: Bearer $REVENUECAT_WEBHOOK_SECRET" -H "Content-Type: application/json" \
    -d '{"event":{"type":"INITIAL_PURCHASE","app_user_id":"test-rc-id-1","environment":"SANDBOX","entitlement_ids":["pro_access"],"subscriber_attributes":{"skm_alias":{"value":"TESTALIAS1"},"skm_secret":{"value":"TESTPASS23"}}}}'
  ```
  Done when: HTTP 200, a new row appears in `accounts`, and the function log shows the alias and password as present. Send it again with a different `app_user_id` but the same alias, and confirm the second account gets a generated alias. Delete both test rows.
- [ ] **0.11 Resend** the failed TRANSFER event from RevenueCat's webhook history, and confirm HTTP 200 there.

---

## Phase 1: iOS (`Paywall.vue`, `monetization.ts`)

- [ ] **1.1 Local format rules.** Create `packages/app/src/lib/credentialRules.ts` exporting:

  - `ALIAS_RE = /^[A-Z0-9]{8,16}$/` and `PASSWORD_RE` with the same pattern (uppercase A–Z and digits 0–9).
  - `WORD_RE = /^[A-Z0-9]{4,16}$/`.
  - `normalize(s) = s.trim().toUpperCase()`.
  - The cross rules: alias differs from password, word differs from alias, word differs from password.

  Use these in `Paywall.vue` for every format check. Done when: format errors show instantly and make no network call.

- [ ] **1.2 Alias availability by RPC.** Replace `validateWithServer` with a debounced (400 ms) call:
  ```ts
  const { data, error } = await supabase.rpc('check_alias_availability', { candidate: alias });
  // error -> treat as "unknown": do not block the user (the webhook handles collisions)
  // data?.[0]?.is_available === false -> show "alias taken"
  ```
  If 0.1 showed that `anon` cannot execute it: `grant execute on function public.check_alias_availability(text) to anon, authenticated;`. Do not show `is_premium` to the user.
- [ ] **1.3 Confirm password locally.** Make `confirm === password` a `computed`. Remove every call that sent the confirm field as `word`. Delete the `VALIDATE_ENDPOINT` constant.
- [ ] **1.4 Remove the password as RevenueCat ID.** In `handlePurchase`, delete `RevenueCatService.logIn(password)`. In `restoreAccount` (`monetization.ts`), replace `logIn(userPassword.value)` with `logIn(<rc_customer_id from the account>)`. Rewrite the comments in `monetization.ts`, `revenuecat-webhook` and `revenueCatService.ts` so all of them say: "RevenueCat user ID = device Supabase uid until Phase 4".
- [ ] **1.5 Rename attributes.** In `handlePurchase` send `skm_alias`, `skm_secret` and `user_id` (replacing `alias` and `password`).
- [ ] **1.6 Best Value block is static.** Change the package `<button>` to `<div class="package-card featured package-card--static">`. Remove `@click` and the `selected` class. Add `.package-card--static { pointer-events: none; cursor: default; }`. Treat the web fallback block (`handleWebStaticPurchase`) the same way. Check near line 865 that a package is auto-selected, because the CTA now relies on it. Done when: tapping the block does nothing and the CTA still buys.
- [ ] **1.7 Fix the restore template.** Wrap in `<template v-if="!restoreLostPassword">` the password row and its character badges. Wrap the recovery-word row and its badges in `<template v-else>`. Do not rename the existing refs. Done when: normally only alias and password are visible, and "I lost my password" shows alias and word.
- [ ] **1.8 Neutral pending state.** After the 30 s wait, replace the red text with "Purchase confirmed with the store. Finishing setup…" and a **Check again** button that calls `waitForPremiumAccount(15000)`. Do not clear the inputs.
- [ ] **1.9 Alias race message.** After the account appears, if its alias differs from the one typed, store the real alias locally and show "Your alias was already taken, so yours is X. You can change it in settings."
- [ ] **1.10 Debug badge for premium.** Show the DEBUG badge in the premium branch of the paywall when `DEBUG_ENABLED` is true.

- [ ] **1.11 iOS first-purchase event.** In App Store Connect open Users and Access, Sandbox, Testers, choose the tester and press **Clear Purchase History**. Reset the device (delete the app, or use "I lost my credentials — start fresh" and reinstall), enter a new alias and password, and buy. Done when: the webhook log shows `NON_RENEWING_PURCHASE` (not `TRANSFER`) followed by `Created new account …`.
- [x] **1.12 Stored credentials after restore (iOS/Mac).** (Verified 2026-10-26 on the Mac, Progress "production rollout" step 7.) The debug panel's localStorage section looked empty after the first restore and showed the previous alias after a switch. The code stores credentials in `loadAccount()` and `restoreAccount()`, so it is probably a stale snapshot: press Refresh first. If `atc-app_user_alias_v1` and `atc-app_user_password_v1` still show the wrong value or are empty, find where they should be saved. Done when: after a restore or switch, Refresh shows the current alias, and after a relaunch `hasStoredAlias` and `hasStoredPassword` are `true` in the boot log.
- [ ] **1.13 Pay from a device that was linked.** On the Mac use "Switch to another account", clear the sandbox tester's purchase history (1.11), type a new alias and password, and buy. Done when: the webhook shows `NON_RENEWING_PURCHASE`, a new `accounts` row exists, the device is linked to it, and the previous account is untouched.

- [ ] **1.14 Tell the player which account a purchase landed on.** When the webhook re-links an existing account (`TRANSFER`), it ignores the typed alias and password, and the paywall used to say the alias was taken. Done in the repo copy 2026-10-23 (`accountNoticeAfterPurchase` in `Paywall.vue`, native and web paths): password differs means "This purchase already belongs to account X…", alias differs only means the alias-race message; shown for 7 s. Done when: on iOS, with an Apple ID that already owns the product, a new alias and password plus buy shows the "already belongs to account X" message, and with a free alias the message is not shown. Optional follow-up: let the player see/copy the account's password on that screen.
- [x] **1.16 The RevenueCat re-bind after restore never runs (found 2026-10-25; decided D13; verified on Android 2026-10-25).** `loadAccount()` (`monetization.ts` ~462) read `row.rc_customer_id`, which `get_account_for_device` does not return, so neither `logIn(rc_customer_id)` (native) nor `initWeb(rc_customer_id)` (web) was ever called. Premium after restore comes from the Supabase flag (works on devices). Decision D13: keep it that way; the dead block and the four comments that described it are removed (behaviour unchanged, so no new device risk). Done when: on a device, restore by alias + password still gives premium, and the debug log shows no `logIn` after the restore.
- [ ] **1.15 Web restore still uses the password as the RevenueCat ID (proposed fix 2026-10-25: follow the native flow).** `Paywall.vue` `handleRestore` (web / Electron branch, `stableId = monetization.userPassword || monetization.userId`, then `RevenueCatService.logIn(stableId)`) contradicts 1.4 and D3. Findings: (a) `handleWebPurchase` already identifies the buyer by the device uid (`initWeb(monetization.userId)`), so a password-keyed restore looks at a different, empty RevenueCat customer; (b) the same code creates a RevenueCat customer whose App User ID is the secret password, which exposes it in the RevenueCat dashboard, webhooks and logs, the exact thing the comment above it forbids; (c) `monetization.ts` `loadAccount()` already does the native-equivalent binding on web (`initWeb(row.rc_customer_id)`, original buyer's uid), and `accounts.rc_customer_id` also covers legacy rows keyed by password, so no password fallback is needed. **Fix:** delete the `logIn(stableId)` block in the web branch; restore by alias + password (`restore-key`), then `loadAccount()` binds the web SDK to `rc_customer_id`; with no linked account, `initWeb(userId)` plus `restorePurchasesWeb()`, and if RevenueCat reports `pro_access`, finish with the same `claim-purchase` path native uses (check that its `Capacitor.isNativePlatform()` gate at `monetization.ts` ~1228 has a web branch). Web has no store-level restore (Paddle through RevenueCat Web Billing ties the purchase to the App User ID), so alias + password is the only self-service path, as on Android after Billing 8; the support Transfer (2.8) is the fallback. Before changing it: confirm that `revenueCatService.ts` `logIn` does something on web, and check the RevenueCat dashboard for customers whose App User ID looks like a password (8 to 16 characters, A-Z and 0-9); each is a leaked password (see 5.12) and should be handled. Done when: a Paddle sandbox purchase on web (3.4), then restore in a second browser with alias + password, gives premium and creates no password-shaped customer id.
- [x] **0.12 Webhook: look at every `transferred_from` id.** Done in the repo copy 2026-10-23 (`revenuecat-webhook/index.ts`): the lookup used only `transferred_from[0]`. Redeploy with `supabase functions deploy revenuecat-webhook --no-verify-jwt`. Done when: a `TRANSFER` whose first id has no account but a later one does still finds the account. Verified 2026-10-25: the deployed v44 equals the repo, and the all-ids log line was seen live on 2026-10-23.
- [x] **0.13 `restore-key`: device uid from the JWT (found 2026-10-25; verified 2026-10-25, Progress "production rollout" steps 3 and 6).** The function linked whatever `currentUserId` the body named, and the gateway accepts the public anon key as a JWT, so anyone could link any device. Fixed in the repo: the uid comes from `auth.getUser(token)`; a body `currentUserId` must match, otherwise 401 `unauthorized` (the client keeps the stored credentials on it). Deploy: `supabase functions deploy restore-key`. Done when: restore by alias + password still works on a device, and a curl with the anon key as the bearer returns 401 `unauthorized`.
- [ ] **0.14 Webhook input checks (found 2026-10-25; done in the repo, deploy pending).** Attributes are client-written, so: (a) `skm_alias` and `skm_secret` are trimmed, uppercased and checked with `^[A-Z0-9]{8,16}$`; a bad password gets `generate_password()` (the linked device reads it back through `get_account_for_device` and shows it on the Profile screen), a bad alias or one equal to the password gets `generate_alias()`; on an existing account invalid values are never written. (b) The `user_id` attribute is used only when it equals the RevenueCat customer id or one of `transferred_to` (D3); otherwise it is logged and ignored. (c) `purchased_at` is set on creation and otherwise only while it is null. (d) Sandbox events stay accepted (D12). Known effect of (b): a purchase made while the web SDK is still logged in with a password-shaped id (the old web restore path, 1.15) creates the account but links no device; restore by alias + password links it. Also: the secret is compared in constant time, and a missing `REVENUECAT_WEBHOOK_SECRET` refuses every request instead of accepting `Bearer undefined`. Deploy: `supabase functions deploy revenuecat-webhook --no-verify-jwt`. Done when: RevenueCat "Send test event" still returns 200; a curl `NON_RENEWING_PURCHASE` with alias `bad!` creates an account with a generated alias and a `user_id` that differs from `app_user_id` links no device (delete the test row afterwards); a real sandbox purchase still creates the account with the typed credentials.

**iOS test (Mac, sandbox Apple ID):**

1. Buy as a new user: the account appears, the premium screen shows, `accounts` has one row. ✅ 2026-10-17 (as a `TRANSFER`; first-purchase event is 1.11).
2. Buy with an alias that was just taken: you get a generated alias and the message. Pending. Insert a decoy `accounts` row with that alias first, then buy.
3. Restore on a second simulator with alias plus password. ✅ 2026-10-17 (Mac, new uid `5ab978b5…`).
4. Lost password with alias plus word. ✅ success path 2026-10-18 (iPhone, new uid). Pending: a wrong word, an account with no word (distinct message), an unknown alias.
5. Delete account still works. ◐ 2026-10-20: server side verified; the client crashed after success (fixed 2026-10-23, `store.reset` undefined). Re-test on device, then also the `delete-account` CORS change in 2.7.
6. Switch account on a linked device. ✅ 2026-10-18 (Mac).

---

### Session 2026-10-11 — Static verification completed

- **Android emulator test attempted (Phase 2.1) — BLOCKED by environment, not code.**
  Built a debug APK, installed it on a booted emulator, launched it, dumped the UI
  hierarchy, and captured full logcat. The paywall rendered correctly.
  `Offerings: null` / `current: ❌ null`. Root cause found in the RC SDK debug logcat:
  ```
  API request completed: GET .../offerings 304
  Requesting products from the store with identifiers: pro_access_unlock, lifetime
  Starting connection for BillingClientImpl...
  PurchasesError(... ErrorCode: BILLING_UNAVAILABLE. Billing service unavailable on device.)
  ```
  The RC API returns offerings fine; the failure is at the Play Store BillingClient layer
  (`BILLING_UNAVAILABLE` — the emulator has no signed Google account). This is an emulator
  limitation, not a code or dashboard bug. Phase 2.1 requires a physical device.
- **Bundle audit (both directions, verified by grepping the built artifacts):**
  - Web build (`vite build`): the real `@revenuecat/purchases-js` is present in the main
    bundle (`rcPackage`, `getOfferings`); the stub chunk is absent. Builds clean (Dart Sass
    deprecation warning only).
  - Mobile APK: the stub chunk `revenuecat-web.stub-*.js` is present and minified; real RC
    Web SDK markers are absent from every main bundle. Stubbing works.
- **Android manifest (merged, from build output):** `minSdkVersion=24`, `targetSdkVersion=36`,
  `com.android.vending.BILLING` present, RC SDK v9.18.0 / Android Billing Client 8.0.0.
- **Live backend verified via REST:** 13 premium accounts, 0 free; 451 `profiles`
  rows (the `handle_new_user` trigger IS running — it is the only writer of
  `profiles`, so this count is direct proof); `get_account_for_device` returns
  `[]` for unknown users; `user_scores` empty.
- **Dashboard confirmed by user:** `default_v2` is the default offering; the Android
  `lifetime` product is attached and active. SDK logcat proves the offering resolves both
  `pro_access_unlock` and `lifetime` — the old product should be removed from the Android
  slot per CONTEXT.md (cleanup item, non-blocking).

## Phase 2: Android

- [ ] **2.1** Rerun the whole iOS test on a device with a license-tester account.
- [~] **2.2** In RevenueCat confirm which Play product the offering uses (`lifetime` or `pro_access_unlock`) and that it is attached to `pro_access`.
  - [x] 2.2 RC dashboard — `default_v2` resolves Android → `lifetime` (confirmed from dashboard: the `$rc_lifetime` "Lifetime unlock" package has iOS `pro_access_unlock` and Android `lifetime`). `default` (the old offering) still had Android `pro_access_unlock` — that was the source of the union the SDK requested, and it is the one to fix. `lifetime` → `pro_access` entitlement confirmed. **Verified via logcat on a rebuilt emulator build:** `Requesting products from the store with identifiers: lifetime` — `pro_access_unlock` no longer requested on Android. The remaining `BILLING_UNAVAILABLE` is the emulator's billing limitation (no signed Google account), not a code bug.
- [~] **2.3** Check the webhook payload `store` is `PLAY_STORE` and the account is created. Account creation is verified through a `TRANSFER` event (`env=SANDBOX`). Still to verify: a real `NON_RENEWING_PURCHASE` event from a Play purchase. It needs a Google account that does not already own the product (refund the old order in Play Console, or add a second license tester).
- [x] **2.4** Read `adb logcat | grep -i -E "purchases|billing"` and fix any errors that are ours. The only errors are Play's `getPurchaseHistory` `ERROR` during restore (not ours, see Progress).
- [ ] **2.5 Fresh Android purchase test.** Set `android:allowBackup="false"`, use one Google account (the installer), clear the Play Store cache, install from Play, enter a new alias and password, buy. Done when: the webhook log shows `Webhook: NON_RENEWING_PURCHASE … password=present` then `Created new account …`, the `accounts` row exists, and reinstall plus Restore Account with the same alias and password gives premium.
- [x] **2.6 RevenueCat SDK upgrade for Android restore. CLOSED 2026-10-25, not a fix.** Outcome: the only upgrade that keeps Capacitor 7 (plugin 11.3.3, purchases-android 9.29.0) fails the same way; rolled back to 11.3.2 / 9.18.0; 12.x and 13.x need Capacitor 8 and nothing indicates they differ, so do not migrate Capacitor for this. Recovery continues in 2.8 to 2.12. The original plan is kept below for the record. Own branch, one dependency family at a time (`SYNC_VERS.md`). 0. **Diagnose first (30 minutes, no code).** On the failing device run `adb logcat | grep -i -E "purchases|billing"` while tapping Restore: does the SDK find any purchase after `syncPurchases` (Play Billing answer), and does it POST a receipt to RevenueCat and with what response? In the RevenueCat dashboard open the new customer (`4e8aacae…`) and the customer that holds the Google purchase (search by Google order id or the earlier uids `c3ca2098…`, `5b7afdfe…`), and check Project settings, Restore behavior. This tells (a) "Play returns nothing" from (b) "RevenueCat refuses to transfer" and decides whether the SDK upgrade can fix it. **Step 0 partly done 2026-10-23 (see Progress): Play's `getPurchaseHistory` returns ERROR; holder found (`5a914a6f…`), cause identified.**
  1. Research only: `npm view @revenuecat/purchases-capacitor versions` and `peerDependencies` of the 12.x line. Pick the newest version that accepts Capacitor 7; if none does, stop, because it needs the Capacitor 8 migration. Read the release notes for Android restore and purchase-history changes.
  2. Pin the exact version in both `package.json` files, `pnpm install`, `pnpm -r why @revenuecat/purchases-capacitor` (one copy), `cap sync`, Gradle billing check.
  3. Android test: logcat `Restoring purchases` no longer ends in `ERROR`; run `supabase/functions/reset_test_account/reset_test_account.sql`, reinstall, tap Restore Account, and confirm a `TRANSFER` recreates the account without a manual Transfer. Also re-test restore through the database row, `ITEM_ALREADY_OWNED` followed by `claimPurchase`, and a fresh purchase.
  4. iOS: `pod install`, simulator, TestFlight sandbox purchase and restore. The plugin version is shared, so do not release iOS before this passes.
  5. Rollback: re-pin the previous version, `cap sync`, bump `versionCode`, update `SYNC_VERS.md`.
- [ ] **2.7 Account deletion and restore on Android.** Decision (2026-10-23): **do not delete the RevenueCat customer** in `delete-account`. The store purchase belongs to the Apple ID or Google account and cannot be released; deleting the RevenueCat customer would probably also remove the record RevenueCat uses to transfer it back (unverified; test before ever doing it). Deleting the `accounts` row, scores and devices is the right "delete my data" (App Store 5.1.1(v) and Google Play both require an in-app path; neither requires revoking a purchase). Do instead:

  1. **Code (done in the repo copy 2026-10-23):** `delete-account` uses the shared `corsHeaders` import and sends CORS on the 405 and 500 responses too. Redeploy: `supabase functions deploy delete-account`.
  2. **Wording (done in the repo copy 2026-10-23, `AccountSettingsScreen.vue`: Danger Zone line plus a per-platform note in the dialog):** Danger Zone and the confirm dialog must not say "purchase history" is deleted. Say: "Your account and progress are deleted. Your store purchase stays with your Apple ID or Google account; you can get premium back by restoring the purchase with a new alias and password." On Android until 2.10 ships, add: "If premium does not come back, contact support."
  3. **iOS:** restore after delete works through the receipt and a `TRANSFER`. Verified 2026-10-20 (an account of the same Apple ID still existed: it is re-linked, see 1.14) and 2026-10-23 (the account holding the purchase was deleted, then a new purchase with new credentials: webhook `Created new account`).
  4. **Android:** the SDK upgrade did not fix it (2.6 closed). Until 2.9 and 2.10 ship, the support workaround is the RevenueCat dashboard Transfer (2.8). After they ship, the player recovers by entering the Google order id (2.10).
     Done when: iOS case 3 verified, wording shipped, `delete-account` redeployed, and either 2.10 is shipped or the limitation and the support contact are in the store listing's support notes.

- [ ] **2.8 Support procedure (no code, do first).** Write `docs/ANDROID_RECOVERY.md`: the player sends the Google order id (`GPA…`, purchase email or Play order history) and their **Support ID** (the device's RevenueCat App User ID); support searches the order id in the RevenueCat dashboard, opens the customer and uses **Transfer** to the Support ID; the `TRANSFER` event makes the webhook create the account (verified 2026-10-15 to 2026-10-17 and 2026-10-23). Add the Support ID (copy button) to the Profile or Settings screen, and the support contact to the delete-account wording (also an open item from the 2026-10-23 handoff). Done when: the document exists, the Support ID is shown, and one sandbox dry run (new uid, dashboard Transfer, premium after restart) is logged in Progress.
- [ ] **2.9 `restore-by-order` Edge Function (server-side recovery for Android).** Options: A = RevenueCat REST v2 "Restore by Order ID" (chosen); B = dashboard Transfer by support (2.8, the fallback); C = native plugin reads the Play token and the server posts it with REST v1 `is_restore` (stronger proof, but needs native code and the flag is deprecated; not planned).
  1. **Verify before building** (read the endpoint page: https://www.revenuecat.com/docs/api-v2#tag/Customer/operation/restore-purchase-by-order-id, then curl it with a sandbox order id against a fresh customer): the exact path and body; whether it works for license-tester orders; whether it fires a `TRANSFER` webhook event; the status and body for a wrong id (expect 4xx) and for an id already claimed (RevenueCat staff say 422). Record the results in Progress. If the sandbox does not support it, stop and decide whether to ship it untested.
  2. **Rules (from RevenueCat staff guidance, see Progress 2026-10-25):** JWT verification ON; the RevenueCat customer id is `auth.uid()` from the JWT, never taken from the body; the body holds only `{ order_id }`; the secret v2 key lives in Supabase secrets (never a `VITE_*` variable); business outcomes return HTTP 200 `{ success, error }` (lesson: `supabase-js` hides non-2xx bodies) with errors `invalid_order`, `already_claimed`, `rate_limited`, `rc_error`; do not log the full order id (last 4 only).
  3. **Rate limit:** per uid and per IP (for example 5 attempts per hour, table `restore_attempts`), because the endpoint turns an order id into premium. An order id leaked in a screenshot would let someone else claim the purchase until the owner claims it; accepted for a USD 5.9 product, but disclose it in the notes.
  4. **After a successful restore call**, reuse the existing `claim-purchase` step (it proves `pro_access` for the caller's uid through the RevenueCat REST API, then creates or links the account). Check that it receives the typed alias and password in its body; do not depend on RevenueCat subscriber attributes reaching the server in time.
     Done when: with a sandbox order id a fresh uid gets premium and a new `accounts` row with the typed credentials; a wrong id and an already-claimed id return the business errors; the rate limit blocks the 6th attempt.
- [ ] **2.10 Client: "Restore with Google order ID" (Android only).** Shown when alias + password restore returns `not_found` on Android, and as a "Can't restore?" link on the restore modal. Fields: new alias, new password (they create a new account) and the order id. Help text: Google Play > Payments & subscriptions > Budget & history, or the purchase email (`GPA…`). Rename the native button to "Restore purchase from the store" with the note that on some Android devices the store cannot return it, and point to the order id option. Update the wording in `AccountSettingsScreen.vue` and `PREMIUM_PROS.md` when it ships. Done when, on a device, after deleting the account: new alias + password + order id gives premium and a new account row.
- [ ] **2.11 RevenueCat support ticket and second device (on hold, owner decision 2026-10-25).** Questions: (a) why `getPurchaseHistory` (AIDL v7) returns `ERROR` on SDK 9.18.0 and 9.29.0; (b) is a non-restore `POST /v1/receipts` of a token owned by another customer ever transferred under "Transfer to new App User ID"; (c) is there a supported way to force a restore-style post on Android without history. Attach the 2026-10-24 log lines and the two dashboard screenshots. Also test Restore Purchases once on a second device or an emulator with Play: RevenueCat documents this as a Billing 8 limitation, so it is probably not device-specific, but the test is cheap (the Xiaomi's Play billing service crashes often).
- [ ] **2.12 Android Auto Backup (decision proposed 2026-10-25: keep `allowBackup="false"` for now).** RevenueCat's documented mitigation is recovering the previous anonymous user id through Auto Backup. Not followed, for these reasons: (a) it only helps players who still have their credentials after a reinstall or new phone, who never hit the gap; (b) it does nothing after account deletion (the restored session belongs to a deleted auth user, and the app already creates a new one); (c) the Supabase session and the plain-text password share the same WebView localStorage, so the password cannot be excluded from the backup until credentials move to their own store (task 4.1); (d) with plain-text passwords (D11) a Drive backup of credentials is a bigger exposure. The real gap (account deleted, purchase kept) is handled by 2.8 to 2.10. Revisit after 4.1: with credentials in Capacitor Preferences (SharedPreferences), backup rules can include the session and the RevenueCat id and exclude the credential file. Until then 5.9 (permanent `allowBackup="false"`) stands. Do not change the manifest (do-not-touch list).

---

## Phase 3: Web (and Electron)

- [ ] **3.1** Check the Netlify build command and variables. If `CAPACITOR_PLATFORM` is set, remove it. It causes "RevenueCat Web SDK is not available on native mobile builds".
- [ ] **3.2** Use `VITE_RC_PADDLE_SERVER_SANDBOX_API_KEY` in dev. Attach `pro_access` to the sandbox Paddle product (it shows "Attach") and put it in an offering the web paywall reads.
- [ ] **3.3** Remove or align the web `purchase()` path in `monetization.ts` so it follows the same attribute names and identity as native. Includes 1.15 (web restore identity).
- [ ] **3.4** Test a Paddle sandbox purchase end to end. Disable browser request-logger extensions while testing.
- [ ] **3.5 (optional) Electron in the Mac App Store.** Possible with electron-builder's `mas` target, but App Store Review guideline 3.1.1 requires Apple in-app purchase for the premium unlock inside a Mac App Store app, so the Paddle / RevenueCat Web Billing path cannot be used in that build. Needed: (1) a macOS app record and certificates (Apple Distribution, Mac Installer Distribution) plus a Mac App Store provisioning profile; (2) App Sandbox entitlements (`entitlements.mas.plist` + `entitlements.mas.inherit.plist`), dropping the camera, microphone, Documents and Downloads usage strings and the `anyconnect:check` shell call; (3) purchases through Electron's `inAppPurchase` module (Mac App Store builds only), with the App Store receipt posted to RevenueCat from the server (REST `POST /v1/receipts`) so the webhook creates the account as on iOS; (4) no `electron-updater` in that build (`process.mas`), because the App Store delivers updates; (5) category `public.app-category.games`, and an Electron upgrade first (26 is out of support). Option: build it with bundle id `com.atcapp.app` inside the iOS app record (Universal Purchase), so an iPhone purchase restores on the Mac with the same Apple ID. The direct download (signed and notarized DMG or zip, Paddle allowed) needs none of this. Owner decision before starting.

---

## Phase 4: device-less accounts and single session

**Do not start until Phases 0 to 3 pass.**

> **Re-evaluation 2026-10-23.** Still the right direction (accounts independent of devices, one session), but it is a production schema change on a Free-plan project with no backups, and Phase 3 (web) is untested. Two cautions: (1) it does not fix the Android restore gap (2.6 does), so do not start it for that reason; (2) it silently breaks `delete-account` (4.11). Prefer to ship Phases 0 to 3 plus 2.6/2.7 first, take a manual export of `accounts` and `profiles` before 4.3, and treat 4.1 (credential store) and 4.6 (install UUID) as separable, lower-risk steps.

> **Already implemented — do not re-implement.** The single-session protocol below
> was written before the code existed. It is now live under different names:
>
> | Plan name       | Actual function                                 | File                                    |
> | --------------- | ----------------------------------------------- | --------------------------------------- |
> | `start_session` | `check_and_claim_play_session(current_user_id)` | `SUPABASE_SCHEMA_ACCOUNTS.sql` line 704 |
> | `heartbeat`     | `heartbeat_play_session(current_user_id)`       | line 764                                |
> | `end_session`   | `release_play_session(current_user_id)`         | line 809                                |
> | `holds_session` | (folded into the claim/heartbeat WHERE clauses) | —                                       |
>
> Client side: `packages/app/src/services/playSession.ts` —
> `checkAndClaim()` / `startHeartbeat()` / `stopHeartbeat(release)`.
> Session TTL is **3 minutes** with a **60 s** heartbeat, not the 90 s / 30 s the
> draft below assumed. The waiting page already exists (`/waiting`).
>
> What 4.0–4.5 still need to do is **wire the client into these RPCs on Start Game
> and app background**, not write the RPCs themselves. Keep the draft SQL below
> only as a reference for the claim/heartbeat logic if the shipped functions ever
> need to change.

- [ ] **4.0 Collect inputs before coding.** Run, save the output, and send it for review:
  ```sql
  select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public';
  select proname, pg_get_functiondef(oid) from pg_proc where pronamespace = 'public'::regnamespace;
  ```
  and in the repo: `grep -rn "heartbeat\|active_device\|get_account_for_device\|restore_account" packages supabase`.
  Reason: current policies and functions join `profiles`, and the existing heartbeat code was not available when this plan was written.
- [ ] **4.1 Credential store.** One module `credentialStore.ts` with `get/set/clear` for alias and password. Web and Electron: `localStorage` (same keys as now). Native: add `@capacitor/preferences@^7` to both `packages/app` and `packages/mobile`, run `cap sync`, and migrate existing `localStorage` values once. Do not add a vite alias stub for this plugin.
- [ ] **4.2 Session functions** — **SKIP, already implemented** (see the table above). Re-read `SUPABASE_SCHEMA_ACCOUNTS.sql` lines 700–831 instead of running the SQL below.

  ```sql
  create or replace function public.start_session(p_alias text, p_password text)
  returns table(success boolean, error text, account_id uuid, alias text, is_premium boolean)
  language plpgsql security definer set search_path = public as $$
  declare a public.accounts%rowtype;
  begin
    if auth.uid() is null then return query select false, 'no_auth', null::uuid, null::text, false; return; end if;
    select * into a from public.accounts
      where accounts.alias = upper(btrim(p_alias)) and accounts.password = upper(btrim(p_password));
    if not found then return query select false, 'not_found', null::uuid, null::text, false; return; end if;
    if not a.is_premium then return query select false, 'not_paid', a.id, a.alias, false; return; end if;
    if a.active_device_id is not null and a.active_device_id <> auth.uid() and a.session_expires_at > now() then
      return query select false, 'session_busy', a.id, a.alias, true; return;
    end if;
    update public.accounts set active_device_id = auth.uid(), last_heartbeat = now(),
      session_expires_at = now() + interval '90 seconds', updated_at = now() where id = a.id;
    return query select true, null::text, a.id, a.alias, true;
  end $$;

  create or replace function public.heartbeat() returns boolean language plpgsql security definer set search_path = public as $$
  begin
    update public.accounts set last_heartbeat = now(), session_expires_at = now() + interval '90 seconds'
      where active_device_id = auth.uid() and session_expires_at > now();
    return found;
  end $$;

  create or replace function public.end_session() returns void language sql security definer set search_path = public as $$
    update public.accounts set session_expires_at = now() where active_device_id = auth.uid();
  $$;

  create or replace function public.holds_session(p_account uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.accounts a where a.id = p_account and a.is_premium
      and a.active_device_id = auth.uid() and a.session_expires_at > now());
  $$;

  grant execute on function public.start_session(text, text), public.heartbeat(), public.end_session(), public.holds_session(uuid) to authenticated;
  ```

- [ ] **4.3 Policies.** For each policy and function found in 4.0 that joins `profiles`, create a new policy using `public.holds_session(account_id)` (new names, for example suffix `_v2`). Test, then drop the old ones. Covers premium reads and writes of scores and progress, `cast_vote`, `set_recovery_word` and `set_alias`.
- [ ] **4.4 Client login.** Replace `loadAccount` / `get_account_for_device` with: read credentials from `credentialStore`, and on Start Game call `start_session`. Replace `restore_account` linking with: call `start_session`, then store the credentials locally. No credentials means free mode with no database call and no anonymous sign-in.
- [ ] **4.5 Heartbeat and waiting page.** Call `heartbeat()` every 30 s during a premium session. On `false`, route to `/waiting`. Create `WaitingForSession.vue` at `/waiting` with the text from section 3, a call to `start_session` every 10 s, and an automatic redirect to Home on success. Call `end_session()` on exit. Done when: two devices cannot play at once, closing the first lets the second in within about 90 s, and the waiting page redirects by itself.
- [ ] **4.6 RevenueCat ID.** Generate one random UUID per install (`crypto.randomUUID()`), keep it in `credentialStore` under `atc-app_rc_id_v1`, and initialize RevenueCat with it on all platforms. Defer the anonymous Supabase sign-in until the player taps purchase or restore.
- [ ] **4.7 Webhook simplification.** Remove the `deviceId`, `profiles` upsert and first-session handoff code. Keep the account lookup by `rc_customer_id` (the install UUID), the creation with the alias race fallback, and the revoke events.
- [ ] **4.8 Poll by purchase.** Add the RPC `claim_purchase(p_rc_customer_id text, p_password text)` returning alias and `is_premium`. Poll it after purchase instead of `get_account_for_device`. Then store alias and password locally and call `start_session`.
- [ ] **4.9 Recovery word** stays: alias plus word returns the password through the existing `recover-account` function, and the device stores it locally.
- [ ] **4.10 Retire `validate-credentials`.** After nothing calls it, delete the function.
- [ ] **4.11 Rework `delete-account` for device-less accounts.** Today it finds the account through `profiles.account_id`. Phase 4 and 5.4 remove that link, so the function would delete only the auth user and leave the `accounts` row. Find the account through the session instead (`accounts.active_device_id = auth.uid()` and an unexpired session), or require alias and password in the body; then delete the row, scores and progress and the caller's auth user. Do this in the same release as 4.3/4.4. Done when: delete works for a premium player who has no `profiles` link, and the `accounts` row is gone.

**Test (iOS, then Android, then Web):** new purchase; launch with stored credentials; clear storage and sign in to a different account; second device blocked then released; heartbeat expiry after killing the app; refund event (webhook `REFUND`) makes the next `start_session` return `not_paid`.

---

## Phase 5: cleanup (after Phase 4 passes)

- [ ] **5.1** Take a backup (Supabase dashboard, Database, Backups).
- [ ] **5.2** Drop the trigger found in 0.1, for example: `drop trigger on_auth_user_created on auth.users;`.
- [ ] **5.3** Delete free rows once: `delete from public.accounts where is_premium = false and alias is null;`.
- [ ] **5.3b Delete free devices** (anonymous users with no account). Preview first: the same `where` as a `select` (keep list: non-anonymous, created less than a day ago, profile linked to an account, `is_premium`, or holder of an active session). Then:
  ```sql
  delete from auth.users u
  using (select u2.id from auth.users u2
         left join public.profiles p on p.id = u2.id
         where u2.is_anonymous
           and u2.created_at < now() - interval '1 day'
           and (p.id is null or (p.account_id is null and not p.is_premium))
           and not exists (select 1 from public.accounts a where a.active_device_id = u2.id)) d
  where u.id = d.id;
  ```
  Profiles are removed by the `on delete cascade` from `auth.users`. Free plan: there is no automatic backup, so export `profiles` to CSV first if you want a record. Done when: `auth.users`, `profiles` and `accounts` counts match the preview (kept rows only).
- [ ] **5.4** Drop the old policies and `profiles` columns that Phase 4 no longer uses. Drop `get_account_for_device` and `restore_account` only after `grep` shows no callers.
- [ ] **5.5** Update `SUPABASE_SETUP.md` to match the live database.
- [ ] **5.6** Sync `SUPABASE_SCHEMA_ACCOUNTS.sql` with the deployed functions: `link_account`, `restore_account`, `set_alias`, `set_password` (copy the live bodies with `pg_get_functiondef`; `fix_credential_rpcs.sql` is no longer in the repo) and the RLS policies from the rewritten `fix_rls_recursion.sql`. Otherwise re-running the schema brings back `[A-Z2-9]`, the ambiguous columns and the recursive policies.
- [x] **5.7** Delete the unused `stripe-webhook` function (web purchases go through Paddle via RevenueCat). Owner decision 2026-10-25: remove Stripe from the project. Docs cleaned of Stripe as a current component 2026-10-25 (code had none left). **Move up, no dependency on Phase 4:** on 2026-10-25 it was still deployed (v11, `verify_jwt=false`, public) and could grant premium by password match from any validly signed event; it fails only because `STRIPE_WEBHOOK_SECRET` is unset. Delete with `supabase functions delete stripe-webhook --project-ref boajtcfnyxaedanykfil` (the repo no longer has the source; keep a downloaded copy if wanted). **Done 2026-10-25:** deleted by the owner; `functions list` shows 6 functions and the URL answers 404 `NOT_FOUND`.
- [x] **5.8** Implement the `recover-account` throttling from section 2.3. Done with 5.13: 5 failed words per alias per hour, deployed and verified 2026-10-28 (429 on the sixth wrong word). The minimum word length stays 4 (owner, D7).
- [ ] **5.9** Add `android:allowBackup="false"` to the permanent Android rules in `SYNC_VERS.md`.
- [ ] **5.10 RevenueCat catalog cleanup.** The code checks only `pro_access` (`RC_ENTITLEMENT_ID`, `Paywall.vue`, the webhook and `claim-purchase`). The `pro` entitlement ("Full access", created 2026-04-11) is attached to the App Store and Play `pro_access_unlock` products and nothing reads it. Before deleting it: run `git log -S"'pro'" --oneline -- packages/app/src` and confirm no shipped build reads it, and confirm the RevenueCat paywall "Full Game" does not require it. Then detach both products and delete `pro`. Also: the Play `pro_access_unlock` product is attached to `pro_access` but is not in the `default_v2` package (Android sells `lifetime`), so detach it only after confirming it has no transactions; delete the old `default` offering once nothing references it. The App Store product `pro_access_unlock` shows "Ready to Submit": submit it with the first iOS build. Done when: a purchase still returns `pro_access` on iOS and Android.

- [ ] **5.11 Safeguards for plain-text passwords (D11).** Hashing is rejected, so protect the column instead. (1) Apply `supabase/functions/harden_supabase/harden_supabase.sql` (still unticked) and prove it (`verify_hardening.sql` in the same folder): with the anon key a REST `select` on `accounts` must return nothing or 401/403; `recover_by_word` and `restore_account` must be service-role only. (2) No password in any log: grep the Edge Functions and the client for `console.log` of `password`, `skm_secret`, `skm_alias`; the webhook may log only `password=present`. (3) The debug overlay and its Copy output must be off in release builds (`VITE_SHOW_DEBUG`) and must mask the password and recovery word. (4) Remove `skm_secret` from RevenueCat after use (5.12). (5) Rate limits (5.13). (6) Keep credentials out of Android backups (2.12) and treat every export of `accounts` or `profiles` (for example the export before 4.3 or 5.3b) as a secret file. (7) Do not put the password in analytics or error reports. Done when: each item is checked with evidence in Progress.
- [ ] **5.12 Password inside RevenueCat attributes.** `skm_secret` travels through RevenueCat and is probably visible in the dashboard Attributes of the customer (verify on one customer; the earlier rename from `password` avoided RevenueCat's automatic hiding). After the webhook or `claim-purchase` has consumed it, overwrite the attribute with an empty value through the RevenueCat REST API (verify that this is supported). Phase 4 (4.8) removes the need. Also look for customers whose App User ID is a password (see 1.15) and remove the cause.
- [x] **5.13 Rate limits.** `restore-key` per alias and per IP (the alias is public), `recover-account` (with 5.8), and 2.9. Raise the recovery word minimum to 8 (changes D7). Done when: repeated wrong guesses return `rate_limited`.
  - **Applied and deployed 2026-10-28** (owner): `rate_limits.sql` check grid shows the four functions closed to `anon` and `authenticated`; `restore-key` v15 and `recover-account` v12, both `verify_jwt=true`, downloaded sources byte-identical to the repo. Test with the anon key and a made-up alias `RLTEST000001`: five wrong recovery words answer 404 `not_found`, the sixth 429 `{"error":"rate_limited","retry_after_seconds":3596}`; `restore-key` with the anon key still answers 401 `unauthorized`. Device test 2026-10-28 (owner, iPhone, made-up alias): the sixth wrong password shows "Too many attempts. Try again in 60 minutes." (Progress 2026-10-28). `supabase/functions/rate_limits/rate_limits.sql`: table `credential_attempts` (service role only; failures only, rows older than a day deleted, network address stored as an HMAC keyed with the service-role key, never the IP) and `link_account_limited` / `recover_by_word_limited`, which count recent failures, run the real check and record the result in one transaction behind per-alias and per-address advisory locks, so parallel guesses cannot all pass. Limits over a rolling hour, the same for restore and recover: 5 per alias, 15 per address, 5 per device. A success clears the alias's failures. `restore-key` answers 200 `rate_limited` with `retry_after_seconds`, `recover-account` 429 with the same body. Client: `rate_limited` never logs out, never falls back to `claim-purchase`, and shows "Too many attempts. Try again in N minutes." (paywall restore and recovery forms, restore modal); the startup credential check keeps credentials on it. The SQL parses with the Postgres parser (`libpg-query`); function bodies are checked by Postgres at apply time. The recovery word minimum stays 4 (owner, D7). 2.9 gets its own limit when it is built.
- [ ] **5.14 Review `active_device_id` and the play session on restore.** Check what a restore on a new device does to an unexpired session of the old device, what `delete-account` does with the session columns, and that a stale session cannot lock the owner out or be taken over (TTL 3 minutes, heartbeat 60 s). Done when: the cases are written in Progress with evidence.

---

## Test matrix (fill in as you go)

| Scenario                                           | iOS | Android       | Web |
| -------------------------------------------------- | --- | ------------- | --- |
| New purchase creates account                       | ◐   | ◐             |     |
| Alias taken during purchase gets a generated alias |     |               |     |
| Restore with alias plus password                   | ✅  | ✅            |     |
| Lost password with alias plus word                 | ◐   |               |     |
| Best Value block does nothing when tapped          |     |               |     |
| Clear storage, sign in to another account          |     |               |     |
| Second device blocked, then released               |     |               |     |
| Refund makes the player free                       |     |               |     |
| Delete account still works                         |     |               |     |
| Restore after delete (store purchase kept)         | ✅  | ✗ (2.9, 2.10) |     |

Legend: ✅ verified, ◐ partly verified (see Progress, 2026-10-15 to 2026-10-17; iOS 2026-10-17).
