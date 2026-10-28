# ATC-APP Login Flow — Anonymous, Cross-Device (accounts model)

Last synced with `FIX_PREMIUM.md` on 2026-10-25. If this file and `FIX_PREMIUM.md` disagree, `FIX_PREMIUM.md` wins. `SUPABASE_SCHEMA_ACCOUNTS.sql` is out of date versus the deployed functions (task 5.6), so treat the live database as the source of truth for exact function bodies.

ATC-APP uses **anonymous authentication only**. No email, no phone, no personal data. Every device gets its own Supabase anonymous `user.id`. A purchase is carried across devices by a player-chosen **public alias** plus **private password** stored on a canonical `accounts` row.

Changes against the earlier version of this file: the account is **created by the RevenueCat webhook after payment** (not before, no `claim_account`); on iOS and Android the RevenueCat user ID is the **device Supabase uid**, also after a restore (decision D13: premium comes from the account row; `accounts.rc_customer_id` only records the buyer's RevenueCat customer for webhook events), never the password or alias; the web/Electron restore branch in `Paywall.vue` still uses the password until task 1.15 (proposed: delete it and restore by alias + password only); the password is chosen in the paywall and passed to the webhook as a subscriber attribute.

---

## 1. Database

### `public.accounts`: one row per paid account

| Column                                                     | Description                                                                                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                       | uuid PK. Canonical account id.                                                                                                                                    |
| `alias`                                                    | **Public** handle, unique, 8-16 chars `[A-Z0-9]`. Shown on leaderboards.                                                                                          |
| `password`                                                 | **Private**, 8-16 chars `[A-Z0-9]`, chosen by the player, **not unique**. Stored in plain text by decision D11 (no hashing); protected by the safeguards in 5.11. |
| `recovery_word`                                            | Optional, 4-16 chars `[A-Z0-9]`. Alias + word returns the password (`recover-account`, no throttling yet).                                                        |
| `is_premium`                                               | Set only by the webhook (and `claim-purchase`).                                                                                                                   |
| `rc_customer_id`                                           | RevenueCat app user id of the buying device (its Supabase uid). Updated only by `TRANSFER`.                                                                       |
| `active_device_id`, `last_heartbeat`, `session_expires_at` | Single-session play lock (TTL 3 minutes, heartbeat 60 s).                                                                                                         |
| `purchased_at`, `created_at`, `updated_at`                 | Timestamps.                                                                                                                                                       |

Only `service_role` reads or writes it directly. Everything else goes through `security definer` functions or Edge Functions. Alias, password and word must all differ from each other.

### `public.profiles`: one row per device

`id` (PK, FK to `auth.users`), `account_id` (FK to `accounts`, null until linked), `is_premium` (cached), `platform`, `last_passed_level`, `passed_levels`, `rc_customer_id`, `purchased_at`, `updated_at`. Created by the `on_auth_user_created` trigger for every anonymous sign-in (removed in Phase 5). Known: `platform` shows `web` on an Android device (to check).

### `public.account_scores` and `public.account_progress`

Per-level bests and per-account progress for premium accounts. Free players never read or write them. Unique `(account_id, level_id)`; `max_planes` never decreases.

### Functions (`security definer`)

| Function                                                                         | Purpose                                                         |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `check_alias_availability(candidate)`                                            | Read-only live probe. Does not reserve the alias.               |
| `generate_alias()`                                                               | Fallback alias (`PILOT` + 7 chars) when the typed one is taken. |
| `link_account` / `restore_account`                                               | Verify alias + password, link this device to the account.       |
| `unlink_device`                                                                  | "Switch account" / "start fresh": unlink and wipe local state.  |
| `get_account_for_device(uid)`                                                    | Account linked to this device.                                  |
| `set_alias`, `set_password`, `set_recovery_word`                                 | Player edits.                                                   |
| `check_and_claim_play_session`, `heartbeat_play_session`, `release_play_session` | Single-session lock.                                            |
| `get_leaderboard(limit)`, `cast_vote`                                            | Public leaderboard, premium voting.                             |

The legacy `claim_account` is dropped by `supabase/functions/harden_supabase/harden_supabase.sql` (confirm it was applied).

### Edge Functions

| Function             | What it does                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `revenuecat-webhook` | `verify_jwt = false`, checks the shared secret. Creates/updates `accounts` from RevenueCat events, links the buying device, grants the first session. Alias taken: generates one. Revoking events for an unknown customer do nothing. |
| `restore-key`        | `{alias, password, currentUserId}` to `link_account`. Business outcomes are HTTP 200 `{success, error}`.                                                                                                                              |
| `claim-purchase`     | Proves `pro_access` through the RevenueCat REST API for the caller's uid, then creates or links the account.                                                                                                                          |
| `recover-account`    | Alias + recovery word returns the password.                                                                                                                                                                                           |
| `delete-account`     | Deletes the account row and every linked device's auth user. Does not touch the store purchase or the RevenueCat customer.                                                                                                            |
| `restore-by-order`   | **Planned (2.9):** Google order id, server-side recovery for Android.                                                                                                                                                                 |

`validate-credentials` is unused and will be deleted (4.10). `stripe-webhook` is deleted (repo and live project, 2026-10-25).

---

## 2. Identity at a glance

```
Device A  auth.users[aaa] -> profiles[aaa] -.
                                              >-> accounts[id1]  (alias, password, is_premium, rc_customer_id = aaa)
Device B  auth.users[bbb] -> profiles[bbb] -'      after restore with alias + password
```

One canonical `accounts` row per paid player. A device links to at most one account. RevenueCat user ID = device Supabase uid on native (until Phase 4 makes it a random per-install UUID); web/Electron restore still passes the password (task 1.15, open). Premium status comes from `accounts.is_premium`, not from RevenueCat CustomerInfo.

---

## 3. Flows

### New purchase (any device)

1. Paywall: formats are checked locally; alias availability by `check_alias_availability` (debounced). Nothing is written to the database.
2. The app sets RevenueCat attributes `skm_alias`, `skm_secret`, `user_id` and starts the store purchase.
3. Store pays; RevenueCat sends the webhook (`NON_RENEWING_PURCHASE`, or `TRANSFER` when the store account already owned the product).
4. The webhook creates the account (generated alias if taken), links the buying device and grants the first session.
5. The app polls for the account for up to 30 s, then shows a neutral pending message with **Check again**. If the alias differs from the typed one, or the purchase landed on an existing account, a notice says so (1.9, 1.14).

### Restore on another device (primary path, all platforms)

Alias + password on the restore modal calls `restore-key`, which links the device and returns premium with the account's scores and progress. If the account does not exist, the client tries `claim-purchase` (works when RevenueCat holds the purchase for this uid). A device that is already linked returns `already_linked`; use **Switch to another account**.

### Lost password

Alias + recovery word calls `recover-account`, the device stores the returned password, then restores as above.

### Switch account / start fresh

`unlinkDevice()` calls `unlink_device`, wipes local premium state and re-binds RevenueCat to the device's own uid. Nothing is deleted; the old account can be restored again.

### Delete account

Settings, Danger Zone: `delete-account` removes the account row, scores, progress and all linked devices, then the app clears local data. The **store purchase stays** with the Apple ID or Google account and the RevenueCat customer is kept. The player can unlock premium again with a new alias and password:

- **iOS:** buy/restore again; the receipt lets RevenueCat transfer the purchase and the webhook creates a new account (verified 2026-10-23).
- **Android:** the SDK restore does not work with Play Billing 8 (`getPurchaseHistory` returns `ERROR`). Today only a support Transfer works; planned: restore by Google order id (2.8 to 2.10).

### Free players

No alias or password, no restore modal, no server reads or writes; scores stay local. (Until Phase 5 they still get an anonymous auth user and a `profiles` row.)

### Incorrect credentials

`restore-key` answers `not_found`; the client signs the device out locally (no data sent) and shows "No user found, check your spelling".

---

## 4. Why alias + password, and why the RevenueCat ID is neither

The alias is public (leaderboard), so an alias alone proves nothing; the password proves ownership. The RevenueCat ID must not be the password or alias: RevenueCat IDs appear in its dashboard, webhook payloads and logs, and aliases and passwords can change later. It is the device Supabase uid (a random UUID per install in Phase 4). Passwords are kept as plain text on purpose (D11), so the database must stay closed to clients (`accounts` readable by `service_role` only), nothing may log them, and recovery by word returns the stored password. Known weaknesses being addressed: the password passing through RevenueCat as an attribute (5.12) and missing rate limits (5.13).
