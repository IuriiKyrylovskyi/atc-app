# 🗄️ ATC-APP — Backend Architecture Guide

> Technical reference for the Supabase backend: database schema, security model, storage, webhook flow, and Electron verification layer.

---

## 📋 Table of Contents

- [Overview](#overview)
- [File Structure](#file-structure)
- [Security Model](#security-model)
- [Database Schema](#database-schema)
- [Authentication Flow](#authentication-flow)
- [Webhook Flow](#webhook-flow)
- [Storage Layer](#storage-layer)
- [Electron Security Layer](#electron-security-layer)
- [Request Throttling](#request-throttling)
- [Extending the Backend](#extending-the-backend)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

The backend is a **Supabase-hosted system** (PostgreSQL + Auth + Storage + Edge Functions) that acts as the server-side source of truth for premium status. The client application **reads** from it but can never **write** its own premium flag — all monetization state flows in one direction through verified external services.

### Key Principles

- ✅ **Server-side truth** — `is_premium` is written only by the RevenueCat webhook, never by the client
- ✅ **Fail-closed** — network failures default to `isPremium = false`, never to unlocked
- ✅ **RLS-enforced** — PostgreSQL Row Level Security prevents any client from reading or writing another user's row
- ✅ **Offline-tolerant** — 60-second local cache means the app works without network after the first boot check
- ✅ **Platform-agnostic** — same database serves iOS, Android, and Electron with no platform-specific DB logic

---

## 📁 File Structure

```
atc-app/
│
├── supabase/
│   └── functions/
│       └── revenuecat-webhook/
│           └── index.ts          # Edge Function — receives RC purchase events
│
packages/app/src/
│
├── lib/
│   └── supabase.ts               # Supabase client singleton + Profile type
│
├── services/
│   ├── revenueCatService.ts      # RevenueCat SDK wrapper (mobile purchases)
│   └── levelManager.ts           # levels_basic / levels_full asset delivery
│
└── stores/
    └── monetization.ts           # Pinia store — auth, premium state, throttle
```

---

## 🔐 Security Model

Understanding the security model is essential before modifying any backend code.

### Trust Hierarchy

```
                    ┌─────────────────────────────────┐
                    │        TRUST BOUNDARY            │
                    │                                  │
  TRUSTED           │  Supabase DB (PostgreSQL)        │
  (cannot be        │  service_role key                │
   faked)           │  RevenueCat servers              │
                    │  Edge Function (Deno)            │
                    │                                  │
                    ├─────────────────────────────────┤
                    │                                  │
  UNTRUSTED         │  Client app (Electron / Mobile)  │
  (treat as         │  anon key                        │
   hostile)         │  renderer process JS             │
                    │                                  │
                    └─────────────────────────────────┘
```

### Why the Client Cannot Grant Itself Premium

Three independent layers prevent this:

| Layer                     | Mechanism                                            | What it blocks                              |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| **RLS policy**            | `with check (is_premium = existing_value)` on UPDATE | Client writing `is_premium = true`          |
| **Webhook-only writes**   | Only `service_role` key can bypass RLS               | Any JWT-authenticated write to `is_premium` |
| **Electron IPC re-check** | Main process fetches Supabase with `service_role`    | Renderer-side JS variable tampering         |

### Key Principle: One-Way Data Flow

```
App Store / Google Play
        │
        ▼
  RevenueCat servers
  (validates receipt)
        │
        ▼ HTTP POST (signed with REVENUECAT_WEBHOOK_SECRET)
  Supabase Edge Function
  (verifies signature, uses service_role)
        │
        ▼
  profiles.is_premium = true
        │
        ▼ SELECT (anon key, RLS-filtered)
  Client app reads new status
```

The client is **at the bottom** of this chain. It reads but never writes the premium flag.

---

## 🗃️ Database Schema (accounts model)

### `accounts` Table

```sql
create table public.accounts (
  id                uuid        primary key default gen_random_uuid(),
  alias             text        unique,                     -- 8-char public handle, shown on leaderboard
  password          text        unique,                     -- 8-16 char private recovery token, NEVER exposed publicly; also RevenueCat appUserID
  is_premium        boolean     not null default false,
  rc_customer_id    text,                                    -- RevenueCat customer id (set by webhook)
  purchased_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

| Column           | Type          | Description                                                                          |
| ---------------- | ------------- | ------------------------------------------------------------------------------------ |
| `id`             | `uuid`        | Canonical account UUID                                                               |
| `alias`          | `text`        | Public 8-char handle shown on the leaderboard; never grants access alone             |
| `password`       | `text`        | Private 8-16 char recovery token; the RC `appUserID` and the only proof of ownership |
| `is_premium`     | `boolean`     | **The guarded flag.** Only the webhook can set this to `true`                        |
| `rc_customer_id` | `text`        | RevenueCat's `app_user_id` — used to match webhook events to rows                    |
| `purchased_at`   | `timestamptz` | Timestamp of the first confirmed purchase                                            |
| `created_at`     | `timestamptz` | Account creation timestamp                                                           |
| `updated_at`     | `timestamptz` | Auto-updated on every write                                                          |

### `profiles` Table

```sql
create table public.profiles (
  id                    uuid        references auth.users on delete cascade primary key,
  account_id            uuid        references public.accounts on delete set null,
  is_premium            boolean     not null default false,
  last_passed_level     text,                                  -- LAST shift completed, [airport]:[shiftEnum] (e.g. 'eglc:1')
  passed_levels         jsonb,                                 -- per-airport JSON map { "eglc": "1", "ksdm/mmtj": "3" }
  platform              text        not null default 'web',
  rc_customer_id        text,
  purchased_at          timestamptz,
  updated_at            timestamptz not null default now()
);
```

| Column              | Type          | Description                                                                                                 |
| ------------------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`                | `uuid`        | Matches `auth.users.id` — the Supabase anonymous user ID                                                    |
| `account_id`        | `uuid`        | FK to canonical `accounts` row; null until user claims account                                              |
| `is_premium`        | `boolean`     | Cached copy from `accounts.is_premium`; synced by webhook/RPCs                                              |
| `last_passed_level` | `text`        | The LAST shift the user COMPLETED, as `[airport]:[shiftEnum]` (enum values). `endless` deliberately absent. |
| `passed_levels`     | `jsonb`       | Same data as `last_passed_level`, as a per-airport map                                                      |
| `platform`          | `text`        | `'ios'` / `'android'` / `'electron'` / `'web'`                                                              |
| `rc_customer_id`    | `text`        | Legacy RevenueCat customer id (kept for backwards compat)                                                   |
| `purchased_at`      | `timestamptz` | Legacy purchase timestamp                                                                                   |
| `updated_at`        | `timestamptz` | Auto-updated on every write                                                                                 |

### `account_scores` Table

Replaces the old `user_scores`. Keyed by `(account_id, level_id)`. Server is source of truth. Client only UPSERTS; RLS update policy enforces non-decreasing `max_planes`.

```sql
create table public.account_scores (
  account_id    uuid        references public.accounts on delete cascade,
  level_id      text        not null,
  max_planes    int         not null default 0,
  opened        boolean     not null default false,
  available     boolean     not null default false,
  updated_at    timestamptz not null default now(),
  primary key (account_id, level_id)
);
```

### `account_progress` Table

Per-account level progress (`last_passed_level`, `passed_levels`) — syncs across devices. Replaces `profiles.last_passed_level` + `passed_levels` for premium users.

```sql
create table public.account_progress (
  account_id        uuid        references public.accounts on delete cascade primary key,
  last_passed_level text,                                     -- LAST shift completed, [airport]:[shiftEnum]
  passed_levels     jsonb,                                    -- per-airport JSON map
  updated_at        timestamptz not null default now()
);
```

### Row Level Security Policies

```sql
-- profiles: users can only read their own row
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- profiles: users can update their own row, but cannot change is_premium
create policy "Users can update own profile (non-premium fields only)"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_premium = (select is_premium from public.profiles where id = auth.uid())
  );

-- account_scores: premium users can view their account's scores
create policy "Premium users can view account scores"
  on public.account_scores for select
  using (
    exists (
      select 1 from public.accounts a
      join public.profiles p on p.account_id = a.id
      where a.id = account_scores.account_id
      and p.id = auth.uid()
      and a.is_premium = true
    )
  );

-- account_scores: premium users can insert their account's rows
create policy "Premium users can insert account scores"
  on public.account_scores for insert
  with check (
    exists (
      select 1 from public.accounts a
      join public.profiles p on p.account_id = a.id
      where a.id = account_scores.account_id
      and p.id = auth.uid()
      and a.is_premium = true
    )
  );

-- account_scores: premium users can update, but max_planes may only INCREASE
create policy "Premium users can update account scores (non-decreasing)"
  on public.account_scores for update
  using (
    exists (
      select 1 from public.accounts a
      join public.profiles p on p.account_id = a.id
      where a.id = account_scores.account_id
      and p.id = auth.uid()
      and a.is_premium = true
    )
  )
  with check (
    exists (
      select 1 from public.accounts a
      join public.profiles p on p.account_id = a.id
      where a.id = account_scores.account_id
      and p.id = auth.uid()
      and a.is_premium = true
    )
    and max_planes >= (
      select max_planes from public.account_scores
      where account_id = account_scores.account_id and level_id = account_scores.level_id
    )
  );

-- account_progress: premium users can view/insert/update their account's progress
create policy "Premium users can view account progress"
  on public.account_progress for select
  using (
    exists (
      select 1 from public.accounts a
      join public.profiles p on p.account_id = a.id
      where a.id = account_progress.account_id
      and p.id = auth.uid()
      and a.is_premium = true
    )
  );

create policy "Premium users can upsert account progress"
  on public.account_progress for insert
  with check (
    exists (
      select 1 from public.accounts a
      join public.profiles p on p.account_id = a.id
      where a.id = account_progress.account_id
      and p.id = auth.uid()
      and a.is_premium = true
    )
  );

create policy "Premium users can update account progress"
  on public.account_progress for update
  using (
    exists (
      select 1 from public.accounts a
      join public.profiles p on p.account_id = a.id
      where a.id = account_progress.account_id
      and p.id = auth.uid()
      and a.is_premium = true
    )
  );
```

> **Critical:** The `accounts` table has NO direct client policies — all reads/writes go through SECURITY DEFINER RPCs or service-role Edge Functions. This is the core security boundary: the canonical premium row is never directly exposed to the anon key.

### Auto-Create Trigger (updated)

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_account_id uuid;
begin
  -- Create a new accounts row (empty alias/password initially; user chooses them pre-purchase via claim_account)
  insert into public.accounts (alias, password, is_premium)
  values (null, null, false)
  returning id into new_account_id;

  -- Create the profile linked to this account
  insert into public.profiles (id, account_id)
  values (new.id, new_account_id)
  on conflict (id) do update set account_id = new_account_id;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

Every new anonymous sign-in automatically gets an `accounts` row (empty credentials) and a `profiles` row linked to it. The user chooses their alias+password BEFORE purchase via `claim_account()`.

---

## 🔑 Authentication Flow

ATC-APP uses **anonymous authentication** — every user (including guests who have never paid) gets a stable `user_id` without requiring registration.

```
App boot
  │
  ├─ getSession() ──────────────── existing session? ──► return existing user_id
  │                                        │
  │                                        no
  │                                        ▼
  └─ signInAnonymously() ────────► new user_id created
                                   profiles row auto-inserted (trigger)
```

### Why Anonymous Auth

- Zero friction — no signup screen before the user has decided to pay
- Stable identity — `user_id` persists across app restarts via stored session token
- Upgradeable — can be linked to an email/social account later without losing purchase history
- RevenueCat matching — the anonymous `user_id` is passed to RC as `appUserID`, so the webhook can find the correct `profiles` row when a purchase is confirmed

### Anonymous Premium Key + Cross-Device Restore

Supabase anonymous `user.id` is device-local, so a purchase confirmed on device A is
invisible to device B's anonymous id. To bridge them without any email or personal
data, every profile gets a server-generated **public `alias`** (8-char, shown on the
leaderboard) plus a **private `password`** (8-16-char, shown once, never exposed publicly).
Both are chosen by the user BEFORE purchase via `claim_account()` (not auto-generated anymore).

```
Before purchase on device A:
  1. User types alias + password + confirm in paywall (validated by claim_account RPC)
  2. claim_account creates/updates the canonical accounts row with alias+password
  3. Client binds RevenueCat via logIn(password) — RC appUserID = password
  4. Purchase happens; RC webhook fires, sets accounts.is_premium = true
  5. Device A shows: alias + password (copyable)
  6. Top-right of main page shows: 💎 PAID <ALIAS>

On device B (fresh anonymous id), first launch:
  1. RC is bound to the PASSWORD (not the alias — the alias is public and appears
     on the leaderboard, so anyone who guesses it could otherwise steal access).
     RevenueCat restores the purchase silently.
  2. If RC restore + server sync still leaves the device non-premium, the manual
     restore modal appears: paste alias + password.
  3. restore_account(alias, password, current_user_id) verifies BOTH, then links
     profiles[bbb] to the canonical accounts row (is_premium=true, alias=alias).
     Scores/progress sync from account_scores/account_progress (no row copying).
```

**Why alias + password (not alias alone):** the alias is a **public handle** — it
appears on the leaderboard, so anyone can see it. Pastes of an alias alone therefore
grant nothing; only the password proves ownership. The `restore_account` / `link_account` RPCs require
both. The RC `appUserID` must be the **private password**, never the public alias —
this is the single security-critical detail of the whole flow.

**Leaderboard:** `get_leaderboard(limit)` RPC (security definer) — public read, returns
`alias, is_premium, max_score`. The `password` column is deliberately excluded. Anyone
(free or paid) can view it without authenticating.

**Choosing your own alias:** `set_alias(current_user_id, candidate)` RPC (security
definer, enforces uniqueness). Exact-match only — `111` and `1111` are distinct aliases
and never conflict. The alias alone never grants access (only the password does), so
name squatting is harmless. Changing the alias does not invalidate the password, so
restore still works via the new alias.

**Free users:** no alias or password is ever shown (no purchase), the restore modal
never appears, and `loadFromServer()`/`flush()` are gated on `isPremium` so free users
never read from or write to the server. Their scores stay local-only.

### Session Persistence

The Supabase client is configured with `persistSession: true`. The session JWT is stored in `localStorage` and refreshed automatically. On Electron, `localStorage` is sandboxed to the app's user data directory.

---

## 🪝 Webhook Flow

The webhook is the most security-critical part of the system. It is the **only** path through which `is_premium` can become `true`.

### Full Sequence

```
User taps "Buy" in app
        │
        ▼
RevenueCatService.purchasePackage()
  (native App Store / Google Play sheet)
        │
        ▼
App Store / Google Play processes payment
        │
        ▼
RevenueCat servers receive receipt confirmation
        │
        ▼ POST https://<project>.supabase.co/functions/v1/revenuecat-webhook
          Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>
          Body: { event: { type: "INITIAL_PURCHASE", app_user_id: "<password>", ... } }
        │
        ▼
Edge Function: verify Authorization header
  ├─ wrong secret → 401 Unauthorized (request dropped)
  └─ correct secret → continue
        │
        ▼
Edge Function: parse event type
  ├─ INITIAL_PURCHASE / RENEWAL / UNCANCELLATION → is_premium = true
  └─ CANCELLATION / EXPIRATION / BILLING_ISSUE   → is_premium = false
        │
        ▼
supabase.from('accounts').update({ is_premium: true, rc_customer_id: app_user_id })
  .or(`password.eq.${app_user_id},rc_customer_id.eq.${app_user_id}`)
  (uses service_role key — bypasses RLS — this is the ONLY authorised writer)
        │
        ▼
Also sync is_premium cache on all linked profiles:
supabase.from('profiles').update({ is_premium: true }).eq('account_id', account_id)
        │
        ▼
App calls syncFromServer(forceCheck: true) ~2s later
  → reads is_premium = true from DB
  → LevelManager.getLevelData() downloads levels_full.json
```

### Edge Function: `supabase/functions/revenuecat-webhook/index.ts`

Key implementation decisions:

| Decision                                                     | Reason                                                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY` auto-injected into Edge Function | Supabase injects it automatically at runtime — never set it manually via `supabase secrets set` (CLI blocks `SUPABASE_` prefix)           |
| `--no-verify-jwt` on deploy                                  | Webhook endpoints use their own `REVENUECAT_WEBHOOK_SECRET` — not a Supabase JWT. Without this flag all requests return `401 Invalid JWT` |
| Shared secret in `Authorization` header                      | Prevents spoofed purchase events from arbitrary HTTP clients                                                                              |
| Handles both `INITIAL_PURCHASE` and `RENEWAL`                | Subscriptions renew automatically; status must stay `true`                                                                                |
| Handles `CANCELLATION` / `EXPIRATION`                        | Revokes access correctly if user disputes or subscription lapses                                                                          |
| Matches by `accounts.password` first, then `rc_customer_id`  | RC's `app_user_id` = account `password` (set by `RevenueCatService.logIn(password)`), fallback for legacy events                          |

### Required Edge Function Secrets

Set via the CLI (`supabase secrets set`):

| Secret                      | How to set                                           | Notes                                                          |
| --------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| `REVENUECAT_WEBHOOK_SECRET` | `supabase secrets set REVENUECAT_WEBHOOK_SECRET=...` | A string you choose — paste into the RevenueCat webhook config |
| `SUPABASE_SERVICE_ROLE_KEY` | **Do not set manually**                              | Auto-injected by Supabase into all Edge Functions at runtime   |

> ⚠️ The Supabase CLI blocks `supabase secrets set SUPABASE_*`. You never need to set
> `SUPABASE_SERVICE_ROLE_KEY` manually — Supabase provides it automatically alongside
> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_DB_URL`.

---

## 📦 Storage Layer

### Bucket: `game_assets` (private)

The `levels_full.json` file is hosted in a private Supabase Storage bucket — not in the app bundle. This is the tutor's key security insight: **a file that doesn't exist on the device cannot be hacked**.

```
Storage bucket: game_assets (public = false)
└── levels_full.json     ← full level definitions, all airports unlocked
```

### Storage RLS Policy

```sql
create policy "Premium users can download assets"
  on storage.objects for select
  using (
    bucket_id = 'game_assets'
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and is_premium = true
    )
  );
```

A request to download `levels_full.json` with a free user's JWT returns **403 Forbidden** — the file never transfers.

### `LevelManager` Flow

```
getLevelData()
  │
  ├─ isPremium = false ──────────────────────────────► return bundled levels_basic.json
  │
  └─ isPremium = true
        │
        ├─ readCachedLevels() ── cache exists? ──────► return device-cached levels_full.json
        │                              │
        │                              no
        │                              ▼
        └─ downloadAndCacheLevels()
              │
              ├─ supabase.storage.from('game_assets').download('levels_full.json')
              │    ├─ 403 (not premium) ────────────► fallback: return levels_basic.json
              │    └─ 200 OK
              │         ▼
              ├─ writeCachedLevels() ──────────────── saves to Filesystem.Data (mobile)
              │                                       or localStorage (Electron/web)
              └─ return parsed JSON
```

### Cache Invalidation

If you push a new `levels_full.json` to Supabase Storage after a content update, call `LevelManager.clearCache()` to force re-download on next boot. A practical pattern is to embed a `version` field in the JSON and compare it against a version stored locally.

---

## 🔒 Electron Security Layer

Electron is the easiest platform to hack (renderer JS is inspectable), so an additional verification layer runs in the **main process**.

### IPC Channel: `premium:check`

```
Renderer (renderer.ts)
  │
  └─ window.electronAPI.checkPremium(userId)
        │
        ▼ IPC (contextBridge — renderer cannot access Node directly)
  Main process (main.ts)
        │
        └─ fetch(SUPABASE_URL/profiles?id=eq.{userId})
             Authorization: Bearer SUPABASE_SERVICE_ROLE_KEY
             (service_role key never in renderer bundle)
                  │
                  ▼
             { isPremium: boolean }
                  │
                  ▼
        Returns result to renderer via IPC
```

### Why This Matters

On mobile, the app binary is sandboxed and harder to inspect. On Electron, any developer tool or modified build can read `localStorage`, intercept network calls, or patch in-memory variables. The Electron IPC check is a **second opinion** from a process the renderer cannot tamper with.

The `service_role` key is read in the main process as `process.env.DB_SERVICE_ROLE_KEY` — it is **never bundled into the renderer JS**. The env var is named `DB_SERVICE_ROLE_KEY` in `packages/electron/.env.local` to avoid confusion with the auto-injected Edge Function variable.

### Content Security Policy

The Electron main process sets a strict CSP via `webRequest.onHeadersReceived`:

```
script-src 'self'                           — no inline scripts, no eval()
connect-src 'self' https://*.supabase.co    — DB calls only to Supabase
            https://api.revenuecat.com      — RC calls explicitly whitelisted
```

---

## ⏱️ Request Throttling

Supabase handles backend rate limiting natively. The client adds a **60-second window cache** to avoid hammering the DB during normal gameplay.

### When `syncFromServer()` is Called

| Trigger                                          | `forceCheck` | Reason                              |
| ------------------------------------------------ | ------------ | ----------------------------------- |
| App boot (`init()`)                              | `false`      | First check — no cache yet          |
| Level gate (router guard hits `requiresPremium`) | `false`      | Uses cache if < 60s old             |
| Purchase completes                               | `true`       | Must confirm new status immediately |
| "Restore Purchases" button                       | `true`       | User-initiated — must bypass cache  |
| Level completion                                 | `false`      | Uses cache — not a paywall event    |

### Throttle Implementation

```typescript
const THROTTLE_MS = 60_000;
const lastCheckedAt = ref<number>(0);

async function syncFromServer(forceCheck = false): Promise<void> {
  const now = Date.now();
  if (!forceCheck && lastCheckedAt.value > 0 && now - lastCheckedAt.value < THROTTLE_MS) {
    return; // use cached isPremium
  }
  // ... fetch from Supabase ...
  lastCheckedAt.value = Date.now();
}
```

On a typical session (boot → 3 levels → level gate), Supabase is called at most **twice**: once on boot, once at the level-4 gate.

---

## 🔨 Extending the Backend

### Adding a New Webhook Event Type

In `supabase/functions/revenuecat-webhook/index.ts`, add the new event type to the appropriate array:

```typescript
// Grant premium
const GRANT_EVENTS = [
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'SUBSCRIBER_ALIAS',
  'MY_NEW_GRANT_EVENT', // ← add here
];

// Revoke premium
const REVOKE_EVENTS = [
  'CANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
  'MY_NEW_REVOKE_EVENT', // ← add here
];
```

### Adding a New Protected Asset

1. Upload the file to the `game_assets` Supabase Storage bucket
2. Add a download method to `LevelManager`:

```typescript
static async getMyNewAsset(): Promise<MyAssetType | null> {
  const { data, error } = await supabase.storage
    .from('game_assets')
    .download('my-new-asset.json');
  if (error || !data) return null;
  return JSON.parse(await data.text()) as MyAssetType;
}
```

The existing Storage RLS policy already protects all files in `game_assets` — no new SQL needed.

### Adding a New Profile Field

1. Add the column in Supabase SQL Editor:

```sql
alter table public.profiles add column my_field text default null;
```

2. Update the `Profile` interface in `packages/app/src/lib/supabase.ts`:

```typescript
export interface Profile {
  // ... existing fields ...
  my_field: string | null;
}
```

3. Update the `.select()` call in `monetization.ts` if you need to read it:

```typescript
.select('is_premium, current_level, platform, my_field')
```

> **Never add `is_premium` to any client-writable field list.** The RLS `with check` policy will reject it, but it's better not to attempt it in the first place.

---

## 🎓 Best Practices

### 1. Never use `service_role` in the client

The `service_role` key bypasses all RLS. It belongs only in:

- Edge Functions (Deno server environment)
- Electron main process (Node environment, not renderer)
- CI/CD scripts

If you see `DB_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in any file under `packages/app/src/`, that is a security bug. In `packages/electron/.env.local` the var is named `DB_SERVICE_ROLE_KEY`; the Edge Function uses the auto-injected `SUPABASE_SERVICE_ROLE_KEY`.

### 2. Always use `forceCheck: true` after purchase events

Any time the user's premium status may have just changed, bypass the throttle:

```typescript
await monetizationStore.syncFromServer(true);
```

Without `forceCheck: true`, the 60-second cache will return the old `false` value.

### 3. Fail-closed on network errors

`syncFromServer()` keeps the existing (false) `isPremium` on any error:

```typescript
if (error) {
  console.warn('Could not sync:', error.message);
  return; // isPremium stays false — do not unlock on failure
}
```

Never set `isPremium = true` as a fallback when the network is unreachable.

### 4. Cross-device restore (`restore-key` Edge Function + `link_account` / `restore_account` RPC)

Supabase anonymous `user.id` is device-local, so a purchase confirmed on device A is
invisible to device B's anonymous id. The bridge is a user-chosen **public `alias`**
(8-char, shown on the leaderboard) plus a **private `password`** (8-16-char, shown once,
never exposed publicly). Both are chosen BEFORE purchase via `claim_account()`.

```
supabase/functions/restore-key/index.ts   (service role — bypasses RLS)
  POST { alias, password, currentUserId }
    │
    ▼
  public.link_account(alias, password, current_user_id)   (security definer)
    │
    ├─ alias + password do not match any premium account ──► 404 "not_found"
    │
    ├─ account exists but is_premium = false ──────────────► 403 "not_paid"
    │
    ├─ current device already linked to a DIFFERENT account ──► 409 "already_linked"
    │
    └─ match ──► update profiles[currentUserId] { account_id=account_id, is_premium=true }
                 (scores/progress read from account_scores/account_progress — no row copying)
```

**Manual fallback:** `restore_account(alias, password, current_user_id)` RPC — same verification,
called directly from client when user pastes credentials in paywall. Used when RC silent
restore fails (purchase on different RC customer id).

**Security-critical detail:** the RC `appUserID` must be the **private password**,
never the public alias. The alias appears on the leaderboard, so anyone who guesses it
could otherwise restore the purchase. The password is never exposed publicly.

**Leaderboard:** `get_leaderboard(limit)` (security definer) — public read, returns
`alias, is_premium, max_score`. The `password` column is deliberately excluded.

**Choosing your own alias:** `set_alias(current_user_id, candidate)` (security definer,
enforces uniqueness). Exact-match only — `111` and `1111` are distinct aliases and never
conflict. The alias alone never grants access (only the password does), so name squatting
is harmless. Changing the alias does not invalidate the password, so restore still works
via the new alias.

### 4. Test the webhook locally with Supabase CLI

```bash
supabase functions serve revenuecat-webhook --env-file .env.local

# Simulate a purchase event
curl -X POST http://localhost:54321/functions/v1/revenuecat-webhook \
  -H "Authorization: Bearer your_test_secret" \
  -H "Content-Type: application/json" \
  -d '{"event":{"type":"INITIAL_PURCHASE","app_user_id":"test-uuid-123","entitlement_id":"pro_access"}}'
```

### 5. Keep `levels_basic.json` and `levels_full.json` in sync structurally

Both files must have the same JSON shape so `LevelManager` can return either without the caller knowing. Only the number of level entries differs.

---

## 🐛 Troubleshooting

| Symptom                                                       | Likely Cause                                                                     | Fix                                                                                                                              |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `isPremium` never becomes `true` after purchase               | Webhook not configured in RevenueCat dashboard                                   | Set the webhook URL and secret in RC → Project → Integrations → Webhooks                                                         |
| Webhook returns 401                                           | `REVENUECAT_WEBHOOK_SECRET` mismatch                                             | Ensure the secret in RC dashboard matches the Edge Function env var exactly                                                      |
| `levels_full.json` download returns 403                       | User not premium in DB                                                           | Confirm webhook fired: check Supabase Edge Function logs                                                                         |
| `levels_full.json` download returns 403 even after purchase   | `rc_customer_id` not set on profiles row                                         | Ensure `RevenueCatService.initialize(supabaseUserId)` is called before purchase                                                  |
| Electron `checkPremium` returns `{ error: 'config_missing' }` | `DB_SERVICE_ROLE_KEY` not in Electron env                                        | Add to `packages/electron/.env.local` — note the var is named `DB_SERVICE_ROLE_KEY` in Electron, not `SUPABASE_SERVICE_ROLE_KEY` |
| DB shows `is_premium = true` but app shows free               | 60-second throttle serving stale cache                                           | Call `syncFromServer(true)` or wait 60 seconds                                                                                   |
| `handle_new_user` trigger not firing                          | Trigger not created or dropped                                                   | Re-run the schema SQL from `SUPABASE_SETUP.md`                                                                                   |
| Anonymous sessions lost between app updates                   | `localStorage` cleared on app update                                             | Consider linking account to email once user purchases                                                                            |
| `syncFromServer` returns 406 error                            | `.single()` used instead of `.maybeSingle()`                                     | New users have no profile row yet — `.single()` returns 406, `.maybeSingle()` returns null gracefully                            |
| `RC_ENTITLEMENT_ID` TypeScript duplicate error                | Imported and redeclared in `monetization.ts`                                     | Remove the local `const RC_ENTITLEMENT_ID` — import it from `revenueCatService.ts` only                                          |
| Vite fails to resolve `@revenuecat/purchases-capacitor`       | Package only in `@atc-app/mobile`, Vite scans all imports including dynamic ones | Add stub alias in `vite.config.ts` → `src/stubs/revenuecat.stub.ts`                                                              |
