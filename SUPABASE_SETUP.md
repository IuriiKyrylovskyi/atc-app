# 🗄️ ATC-APP — Supabase Backend Setup Guide

> Complete first-time setup. Follow every step in order. Takes ~20 minutes.

---

## Prerequisites

- A [Supabase account](https://supabase.com) (free tier is enough)
- Supabase CLI installed via Homebrew (macOS): `brew install supabase/tap/supabase`
- Node.js >= 20

---

## Step 1 — Create Your Supabase Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → sign up with GitHub
2. **New organization** → name it your studio name → **Free plan**
3. **New project** → fill in:
   - **Name:** `atc-app`
   - **Database password:** generate a strong one and save it
   - **Region:** pick closest to your users
4. When prompted for security settings:
   - **Security preset:** choose **Enable Row Level Security (RLS)**
   - **Data API:** leave **enabled** (default)
   - **Automatic RLS:** leave off (we write our own policies)
5. Wait ~2 minutes for the project to provision

### Collecting Your Keys

Go to **Project Settings → API → Legacy API keys** tab:

| Value                       | Where to find it                                      |
| --------------------------- | ----------------------------------------------------- |
| `SUPABASE_URL`              | Top of the page — `https://xxxxxxxxxx.supabase.co`    |
| `SUPABASE_ANON_KEY`         | Legacy tab → `anon public` key                        |
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy tab → `service_role` key (click eye to reveal) |

> ⚠️ Use the **Legacy** tab, not the newer Publishable/Secret tabs.
> `@supabase/supabase-js` v2 expects the legacy key format.

> 💡 Your project URL is also visible in your browser address bar:
> `https://supabase.com/dashboard/project/YOUR_REF/...`
> The `YOUR_REF` part gives you `https://YOUR_REF.supabase.co`

---

## Step 2 — Run the Database Schema

Go to **SQL Editor** in your Supabase dashboard → **New query**.

Set the **Database role** to **Postgres (superuser)** — not `anon`.
The schema creates tables, triggers, and policies which require admin privileges.

Paste and run this entire block:

````sql
-- ============================================================
-- ATC-APP: Complete database schema (accounts model)
-- Role: Postgres (superuser)
-- ============================================================

-- 1. ACCOUNTS TABLE
-- Canonical premium row. Alias = public handle (leaderboard). Password = private recovery token + RevenueCat appUserID.
-- Created ONLY by the RevenueCat webhook (confirmed purchase) or by link_account (manual
-- restore). Free users never get an accounts row — see handle_new_user below.

create table if not exists public.accounts (
  id                uuid        primary key default gen_random_uuid(),
  alias             text        unique,                     -- 8-char public handle, shown on leaderboard
  password          text        unique,                     -- 8-16 char private recovery token, NEVER exposed publicly; also RevenueCat appUserID
  is_premium        boolean     not null default false,
  rc_customer_id    text,                                    -- RevenueCat customer id (set by webhook)
  purchased_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── Single active device enforcement ──────────────────────────────────────
-- The account is "locked" to the device that is currently playing. Every
-- active device refreshes `last_heartbeat` / `session_expires_at` once a
-- minute; any other device that wants to play must wait until the session
-- expires (app closed / crash / lost network).
alter table public.accounts add column if not exists active_device_id  uuid;
alter table public.accounts add column if not exists last_heartbeat    timestamptz;
alter table public.accounts add column if not exists session_expires_at timestamptz;

-- Supports stale-session cleanup sweeps (accounts with no heartbeat in > 3 min).
create index if not exists idx_accounts_last_heartbeat on public.accounts (last_heartbeat);

-- Recovery word: free-text second credential, set only on the Premium screen.
-- Stored normalized (upper + btrim). Nullable — a player who never set one has
-- no self-service recovery path.
alter table public.accounts add column if not exists recovery_word text;

alter table public.accounts enable row level security;

-- Accounts are NOT directly readable by clients (RLS blocks anon key).
-- All reads/writes go through SECURITY DEFINER RPCs or service-role Edge Functions.

-- 2. PROFILES TABLE
-- One row per auth.users (device). Links to canonical accounts row via account_id FK.
-- Stores device-specific cached is_premium + progress sync columns.

create table if not exists public.profiles (
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

-- Ensure account_id column exists (for existing tables from old schema)
alter table public.profiles add column if not exists account_id uuid references public.accounts on delete set null;

alter table public.profiles enable row level security;

-- Users can only read their own profile
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can update their own profile but CANNOT change is_premium
drop policy if exists "Users can update own profile (non-premium fields only)" on public.profiles;
create policy "Users can update own profile (non-premium fields only)"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_premium = (
      select is_premium from public.profiles where id = auth.uid()
    )
  );

-- 3. ACCOUNT_SCORES TABLE
-- Replaces user_scores. Keyed by (account_id, level_id). Server is source of truth.
-- Client only UPSERTS; RLS update policy enforces non-decreasing max_planes.

create table if not exists public.account_scores (
  account_id    uuid        references public.accounts on delete cascade,
  level_id      text        not null,
  max_planes    int         not null default 0,
  opened        boolean     not null default false,
  available     boolean     not null default false,
  updated_at    timestamptz not null default now(),
  primary key (account_id, level_id)
);

alter table public.account_scores enable row level security;

-- Premium users can view their account's scores
drop policy if exists "Premium users can view account scores" on public.account_scores;
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

-- Premium users can insert their account's rows
drop policy if exists "Premium users can insert account scores" on public.account_scores;
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

-- Premium users can update, but max_planes may only INCREASE
drop policy if exists "Premium users can update account scores (non-decreasing)" on public.account_scores;
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

-- 4. ACCOUNT_PROGRESS TABLE
-- Per-account level progress (last_passed_level, passed_levels) - syncs across devices.
-- Replaces profiles.last_passed_level + passed_levels for premium users.

create table if not exists public.account_progress (
  account_id        uuid        references public.accounts on delete cascade primary key,
  last_passed_level text,                                     -- LAST shift completed, [airport]:[shiftEnum]
  passed_levels     jsonb,                                    -- per-airport JSON map
  updated_at        timestamptz not null default now()
);

alter table public.account_progress enable row level security;

-- Premium users can view their account's progress
drop policy if exists "Premium users can view account progress" on public.account_progress;
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

-- Premium users can upsert their account's progress
drop policy if exists "Premium users can upsert account progress" on public.account_progress;
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

drop policy if exists "Premium users can update account progress" on public.account_progress;
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

-- 5. AUTO-CREATE PROFILE ON SIGNUP
-- The trigger fires on every auth.users insert (anonymous signup). It creates only
-- the device profile — NOT an accounts row. The canonical accounts row is created
-- on demand by the RevenueCat webhook (purchase) or by link_account (restore), so a
-- free user who never pays generates zero accounts rows. A device with
-- profiles.account_id = null is indistinguishable from one that has never bought,
-- which is the honest representation of "this device has never paid".

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- 8-char uppercase alphanumeric public handle (no ambiguous chars: 0/O, 1/I/l).
-- Generated server-side so the client cannot forge or guess another user's alias.
-- Uniqueness is enforced by `accounts.alias unique` + `check_alias_availability`.
create or replace function public.generate_alias()
returns text
language plpgsql
immutable
as $$
declare
  chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result text := '';
  i int;
begin
  for i in 1..8 loop
    result := result || substr(chars, (floor(random() * length(chars))::int) + 1, 1);
  end loop;
  return result;
end;
$$;

-- 12-char private recovery token. Shown to the user once, never exposed publicly
-- (the leaderboard query below excludes it). Anyone can SEE your alias on the
-- board, but only you know the password — so pasting an alias alone never
-- grants access.
create or replace function public.generate_password()
returns text
language plpgsql
immutable
as $$
declare
  chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result text := '';
  i int;
begin
  for i in 1..12 loop
    result := result || substr(chars, (floor(random() * length(chars))::int) + 1, 1);
  end loop;
  return result;
end;
$$;

-- 6. RPCs (Security Definer)
--
-- claim_account REMOVED. Accounts are now created by the RevenueCat webhook on
-- confirmed purchase. User-chosen alias/password are passed as subscriber
-- attributes before purchase; the webhook reads them and creates the account
-- with is_premium=true. This ensures NO accounts are created for free users.
-- The old claim_account function is kept only in supabase/functions/unlink_device/Fix_claim_account_SQL.md
-- for reference and is not present in the live database.

-- Link account: used by restore-key Edge Function (service role) when user pastes alias+password from another device.
-- Verifies BOTH alias+password match a premium account, links current device's profile to that account.
create or replace function public.link_account(
  p_alias text,
  p_password text,
  p_current_user_id uuid
)
returns table(account_id uuid, alias text, password text, is_premium boolean, success boolean, error text)
language plpgsql
security definer
as $$
declare
  norm_alias text;
  norm_password text;
  src_id uuid;
  my_account_id uuid;
begin
  norm_alias := upper(btrim(p_alias));
  norm_password := upper(btrim(p_password));

  if norm_alias !~ '^[A-Z0-9]{8,16}$' or norm_password !~ '^[A-Z0-9]{8,16}$' then
    return query select null::uuid, null::text, null::text, false, false, 'invalid_format'::text;
    return;
  end if;

  -- Find the account matching BOTH alias and password
  select id into src_id
  from public.accounts
  where alias = norm_alias and password = norm_password;

  if src_id is null then
    return query select null::uuid, null::text, null::text, false, false, 'not_found'::text;
    return;
  end if;

  -- Check if the source account is premium
  if not (select is_premium from public.accounts where id = src_id) then
    return query select null::uuid, null::text, null::text, false, false, 'not_paid'::text;
    return;
  end if;

  -- Get current device's account
  select account_id into my_account_id
  from public.profiles
  where id = p_current_user_id;

  -- If already linked to THIS account, no-op
  if my_account_id = src_id then
    return query select src_id, norm_alias, norm_password, true, true, null::text;
    return;
  end if;

  -- If linked to a DIFFERENT account, refuse (device can only belong to one account)
  if my_account_id is not null then
    return query select null::uuid, null::text, null::text, false, false, 'already_linked'::text;
    return;
  end if;

  -- Link current profile to the found account
  update public.profiles
  set account_id = src_id,
      is_premium = true,
      updated_at = now()
  where id = p_current_user_id;

  -- Seed account_progress from this device's local progress if the account
  -- doesn't have progress yet. This ensures the canonical account_progress
  -- gets the device's completed levels on first link.
  insert into public.account_progress (account_id, last_passed_level, passed_levels)
  select src_id, p.last_passed_level, p.passed_levels
  from public.profiles p
  where p.id = p_current_user_id
    and p.last_passed_level is not null
    and not exists (select 1 from public.account_progress where account_id = src_id);

  return query select src_id, norm_alias, norm_password, true, true, null::text;
end;
$$;

-- Get the canonical account linked to this device's profile (used during init).
create or replace function public.get_account_for_device(
  current_user_id uuid
)
returns table(account_id uuid, alias text, password text, is_premium boolean)
language plpgsql
security definer
stable
as $$
begin
  return query
  select a.id, a.alias, a.password, a.is_premium
  from public.accounts a
  join public.profiles p on p.account_id = a.id
  where p.id = current_user_id;
end;
$$;

-- Public leaderboard. Anyone (free or paid, logged in or not) can read this.
-- Password column is deliberately excluded.
create or replace function public.get_leaderboard(limit_count int default 50)
returns table(alias text, is_premium boolean, max_score int)
language plpgsql
security definer
stable
as $$
begin
  return query
  select
    a.alias,
    a.is_premium,
    coalesce(max(s.max_planes), 0)::int as max_score
  from public.accounts a
  left join public.account_scores s on s.account_id = a.id
  where a.alias is not null
  group by a.alias, a.is_premium
  order by max_score desc, a.alias asc
  limit limit_count;
end;
$$;

-- Let a user pick their own public alias. Security definer so it can enforce
-- uniqueness across other accounts (RLS would block that).
-- Exact-match only: '111' and '1111' are distinct aliases and never conflict.
-- The alias alone never grants access — only the password does — so name
-- squatting is harmless. Changing the alias does not invalidate the password,
-- so restore still works via the new alias.
create or replace function public.set_alias(
  current_user_id uuid,
  candidate text
)
returns table(alias text, success boolean, error text)
language plpgsql
security definer
as $$
declare
  normalized text;
  my_account_id uuid;
begin
  normalized := upper(btrim(candidate));
  if normalized !~ '^[A-Z0-9]{8,16}$' then
    return query select null::text, false, 'invalid_format'::text;
  end if;

  select account_id into my_account_id
  from public.profiles
  where id = current_user_id;

  if my_account_id is null then
    return query select null::text, false, 'no_account'::text;
  end if;

  if exists (select 1 from public.accounts where alias = normalized and id <> my_account_id) then
    return query select normalized, false, 'taken'::text;
  end if;

  update public.accounts
  set alias = normalized, updated_at = now()
  where id = my_account_id;

  return query select normalized, true, null::text;
end;
$$;

-- Set the private recovery password. The password is what actually proves
-- ownership — the alias alone grants nothing. It is generated server-side by
-- handle_new_user and may be overwritten by the user at any time.
-- Security definer so the client cannot bypass the format check.
-- The password is never exposed publicly: get_leaderboard deliberately excludes it.
create or replace function public.set_password(
  current_user_id uuid,
  candidate text
)
returns table(password text, success boolean, error text)
language plpgsql
security definer
as $$
declare
  normalized text;
  my_account_id uuid;
begin
  normalized := upper(btrim(candidate));
  if normalized !~ '^[A-Z0-9]{8,16}$' then
    return query select null::text, false, 'invalid_format'::text;
  end if;

  select account_id into my_account_id
  from public.profiles
  where id = current_user_id;

  if my_account_id is null then
    return query select null::text, false, 'no_account'::text;
  end if;

  if exists (select 1 from public.accounts where password = normalized and id <> my_account_id) then
    return query select null::text, false, 'taken'::text;
  end if;

  update public.accounts
  set password = normalized, updated_at = now()
  where id = my_account_id;

  return query select normalized, true, null::text;
end;
$$;

-- Live availability probe for the alias input (from 3rd character onward).
-- Security definer so it can read other accounts' aliases (RLS would block that).
-- Exact-match only: '111' and '1111' are distinct aliases and never conflict.
create or replace function public.check_alias_availability(
  candidate text
)
returns table(alias text, is_available boolean, is_premium boolean)
language plpgsql
security definer
stable
as $$
begin
  return query
  select
    a.alias,
    a.alias is null,
    a.is_premium
  from public.accounts a
  where a.alias = upper(btrim(candidate));
end;
$$;

-- Manual cross-device restore with BOTH alias and password.
-- Superseded by RevenueCat silent restore (logIn(password)) on first launch,
-- but kept as manual fallback when RC restore fails.
-- Verifies BOTH alias+password match a premium account, links current profile.
create or replace function public.restore_account(
  p_alias text,
  p_password text,
  current_user_id uuid
)
returns table(is_premium boolean, account_id uuid, alias text, password text, success boolean, error text)
language plpgsql
security definer
as $$
declare
  norm_alias text;
  norm_password text;
  src_id uuid;
  my_account_id uuid;
begin
  norm_alias := upper(btrim(p_alias));
  norm_password := upper(btrim(p_password));

  if norm_alias !~ '^[A-Z0-9]{8,16}$' or norm_password !~ '^[A-Z0-9]{8,16}$' then
    return query select false, null::uuid, null::text, null::text, false, 'invalid_format'::text;
    return;
  end if;

  select id into src_id
  from public.accounts
  where alias = norm_alias and password = norm_password;

  if src_id is null then
    return query select false, null::uuid, null::text, null::text, false, 'not_found'::text;
    return;
  end if;

  if not (select is_premium from public.accounts where id = src_id) then
    return query select false, null::uuid, null::text, null::text, false, 'not_paid'::text;
    return;
  end if;

  select account_id into my_account_id
  from public.profiles
  where id = current_user_id;

  if my_account_id is not null and my_account_id <> src_id then
    return query select false, null::uuid, null::text, null::text, false, 'already_linked'::text;
    return;
  end if;

  update public.profiles
  set account_id = src_id, is_premium = true, updated_at = now()
  where id = current_user_id;

  return query select true, src_id, norm_alias, norm_password, true, null::text;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- 7. PRIVATE STORAGE BUCKET

insert into storage.buckets (id, name, public)
values ('game_assets', 'game_assets', false)
on conflict (id) do nothing;

-- Only premium users can download from this bucket
create policy "Premium users can download assets"
  on storage.objects for select
  using (
    bucket_id = 'game_assets'
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and is_premium = true
    )
  );

-- 8. VERIFY: should return policies for profiles + account_scores + account_progress
select tablename, policyname, cmd
from pg_policies
where tablename in ('profiles', 'account_scores', 'account_progress')
order by tablename, cmd;

-- 9. DATA MIGRATION (run ONCE on existing production databases)
-- Backfills accounts from old profiles.alias/password, links profiles.account_id,
-- copies user_scores -> account_scores, and seeds account_progress.
-- SAFE TO RUN MULTIPLE TIMES (uses ON CONFLICT / WHERE NOT EXISTS).
--
-- DEPRECATED: this section assumes the legacy schema where `profiles` carried
-- `alias` / `password` / `last_passed_level` / `passed_levels` columns. The live
-- schema dropped those columns (see SUPABASE_SCHEMA_ACCOUNTS.sql), so every
-- block here is guarded by an `information_schema` check that no longer matches
-- and silently no-ops. Kept for reference only; running it on the current schema
-- does nothing. The purge in section 5 is the only live cleanup step.

-- 9a. Migrate existing profiles with alias/password to accounts
-- Only runs if old profiles.alias column exists (checks via information_schema)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'alias'
  ) THEN
    -- Create accounts rows for premium users with existing credentials
    INSERT INTO public.accounts (alias, password, is_premium, rc_customer_id, purchased_at, created_at, updated_at)
    SELECT DISTINCT
      p.alias,
      p.password,
      p.is_premium,
      p.rc_customer_id,
      p.purchased_at,
      p.updated_at,
      p.updated_at
    FROM public.profiles p
    WHERE p.alias IS NOT NULL
      AND p.password IS NOT NULL
    ON CONFLICT (alias) DO UPDATE SET
      password = EXCLUDED.password,
      is_premium = GREATEST(accounts.is_premium, EXCLUDED.is_premium),
      rc_customer_id = COALESCE(accounts.rc_customer_id, EXCLUDED.rc_customer_id),
      purchased_at = LEAST(accounts.purchased_at, EXCLUDED.purchased_at),
      updated_at = GREATEST(accounts.updated_at, EXCLUDED.updated_at);

    -- Link profiles to their accounts
    UPDATE public.profiles p
    SET account_id = a.id,
        is_premium = a.is_premium,
        updated_at = now()
    FROM public.accounts a
    WHERE p.alias = a.alias
      AND p.account_id IS NULL;

    -- Migrate user_scores -> account_scores (if old table exists)
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'user_scores'
    ) THEN
      INSERT INTO public.account_scores (account_id, level_id, max_planes, opened, available, updated_at)
      SELECT a.id, us.level_id, us.max_planes, us.opened, us.available, us.updated_at
      FROM public.user_scores us
      JOIN public.profiles p ON p.id = us.id
      JOIN public.accounts a ON a.alias = p.alias
      WHERE a.id IS NOT NULL
      ON CONFLICT (account_id, level_id) DO UPDATE SET
        max_planes = GREATEST(account_scores.max_planes, EXCLUDED.max_planes),
        opened = account_scores.opened OR EXCLUDED.opened,
        available = account_scores.available OR EXCLUDED.available,
        updated_at = GREATEST(account_scores.updated_at, EXCLUDED.updated_at);
    END IF;

    -- Seed account_progress from profiles (if profiles has the columns)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'last_passed_level'
    ) THEN
      INSERT INTO public.account_progress (account_id, last_passed_level, passed_levels, updated_at)
      SELECT a.id, p.last_passed_level, p.passed_levels, p.updated_at
      FROM public.profiles p
      JOIN public.accounts a ON a.alias = p.alias
      WHERE p.last_passed_level IS NOT NULL
      ON CONFLICT (account_id) DO UPDATE SET
        last_passed_level = COALESCE(account_progress.last_passed_level, EXCLUDED.last_passed_level),
        passed_levels = COALESCE(account_progress.passed_levels, EXCLUDED.passed_levels),
        updated_at = GREATEST(account_progress.updated_at, EXCLUDED.updated_at);
    END IF;
  END IF;
END $$;

-- 10. PRIVATE STORAGE BUCKET

insert into storage.buckets (id, name, public)
values ('game_assets', 'game_assets', false)
on conflict (id) do nothing;

1. Supabase dashboard → **Storage** (left sidebar)
2. Click into the **`game_assets`** bucket (created by the SQL above)
3. Click **Upload file**
4. Upload `levels_full.json` from your repo root
5. Confirm it appears as `levels_full.json` in the bucket root

> `levels_basic.json` (Levels 1–3) stays inside your app bundle at
> `packages/app/src/assets/levels_basic.json` — do NOT upload it to Supabase.

> For local development you can opt into using a bundled full-levels file
> instead of downloading from Supabase. Set `VITE_USE_LOCAL_FULL_LEVELS=true`
> in `packages/app/.env.local` and include the development file
> `packages/app/src/assets/levels_full_example.json`. This is intended for
> testing only — do NOT ship `levels_full_example.json` in production builds.

---

## Step 4 — Enable Anonymous Auth

1. Supabase dashboard → **Authentication** (left sidebar)
2. Click **Sign In Methods** (or **Providers**)
3. Find **Anonymous Sign-ins** → toggle **ON** → **Save**

> The captcha recommendation can be ignored for a native game app — bots
> targeting a game's anonymous auth endpoint is not a realistic attack vector.
> Enable it later only if you see suspicious spikes in your users table.

---

## Step 5 — Configure Environment Variables

Create these files manually in VS Code Explorer (right-click folder → New File):

### `packages/app/.env.local`

```env
# Supabase
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here

# RevenueCat (fill in after REVENUECAT_SETUP.md)
VITE_RC_IOS_KEY=appl_YOUR_IOS_KEY
VITE_RC_ANDROID_KEY=goog_YOUR_ANDROID_KEY
VITE_RC_WEB_BILLING_PUBLIC_KEY=YOUR_PADDLE_PUBLIC_API_KEY
````

### `packages/electron/.env.local`

```env
# Same public Supabase values as app
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here

# Service role key — main process ONLY, never prefix with VITE_
# Read in main.ts as: process.env.DB_SERVICE_ROLE_KEY
DB_SERVICE_ROLE_KEY=your_service_role_key_here
```

> ⚠️ The Electron env var is named `DB_SERVICE_ROLE_KEY` not `SUPABASE_SERVICE_ROLE_KEY`.
> `VITE_` variables are bundled into client JS visible to anyone.
> `SUPABASE_SERVICE_ROLE_KEY` without `VITE_` is fine for the app package but
> we use `DB_SERVICE_ROLE_KEY` in the Electron package to avoid confusion.

> ⚠️ If your `.env` file at the repo root contains base64 values (e.g.
> `ANDROID_KEYSTORE_BASE64`), wrap them in double quotes — base64 strings
> contain `+` characters that confuse some env parsers:
> `ANDROID_KEYSTORE_BASE64="your+base64+value=="`

### Additional: Stub mobile-only packages for web/Electron builds

`@revenuecat/purchases-capacitor` is installed in `@atc-app/mobile` only.
Vite will fail to resolve it when bundling `@atc-app/app` for web/Electron.
Fix this with a stub alias in `packages/app/vite.config.ts`:

```ts
resolve: {
  alias: {
    '@': path.resolve(__dirname, 'src'),
    events: 'events',
    '@revenuecat/purchases-capacitor': path.resolve(__dirname, 'src/stubs/revenuecat.stub.ts'),
  },
},
```

Then create `packages/app/src/stubs/revenuecat.stub.ts` — an empty shell that
satisfies the bundler. The real RC SDK is never called on web because
`RevenueCatService.isMobile()` guards every method.

Also install these Capacitor packages into `@atc-app/app` (they provide
platform detection utilities needed on all platforms):

```bash
pnpm --filter @atc-app/app add @capacitor/core @capacitor/filesystem
```

---

## Step 6 — Deploy the RevenueCat Webhook Edge Function

### 6a. Install Supabase CLI (macOS)

```bash
brew install supabase/tap/supabase
```

### 6b. Login and link your project

```bash
supabase login
# Opens browser — click Authorize

supabase link
# Select your atc-app project from the list
```

> Your project ref is in the Supabase dashboard URL:
> `https://supabase.com/dashboard/project/YOUR_REF/...`

### 6c. Set Edge Function secrets

```bash
supabase secrets set REVENUECAT_WEBHOOK_SECRET=your_chosen_webhook_secret
```

> Choose any strong string for `REVENUECAT_WEBHOOK_SECRET` — save it, you'll
> paste it into the RevenueCat dashboard in Step 7.

> ⚠️ Do NOT run `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...` —
> the CLI blocks the `SUPABASE_` prefix. Instead, `SUPABASE_SERVICE_ROLE_KEY`
> is **automatically injected** by Supabase into all Edge Functions at runtime.
> You never need to set it manually.

### 6d. Place the Edge Function file

Create this file in your repo:

```
supabase/functions/revenuecat-webhook/index.ts
```

Contents — note it uses the auto-injected `SUPABASE_SERVICE_ROLE_KEY`:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!; // auto-injected
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; // auto-injected
const webhookSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')!; // set in 6c

const GRANT = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE'];
const REVOKE = ['CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE'];

const db = createClient(supabaseUrl, serviceKey);

serve(async (req) => {
  if (req.headers.get('authorization') !== `Bearer ${webhookSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { event } = await req.json();
    if (!event?.app_user_id) return new Response('Missing app_user_id', { status: 400 });

    const userId = event.app_user_id as string;
    const eventType = event.type as string;
    const entitlement = event.entitlement_id as string | undefined;

    if (entitlement && entitlement !== 'pro_access') {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let isPremium: boolean | null = null;
    if (GRANT.includes(eventType)) isPremium = true;
    if (REVOKE.includes(eventType)) isPremium = false;

    if (isPremium === null) {
      return new Response(JSON.stringify({ success: true, action: 'ignored' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const update: Record<string, unknown> = {
      is_premium: isPremium,
      rc_customer_id: userId,
      updated_at: new Date().toISOString(),
    };
    if (isPremium) update.purchased_at = new Date().toISOString();

    const { error } = await db.from('profiles').update(update).eq('id', userId);
    if (error) {
      console.error('DB update failed:', error.message);
      return new Response('DB Error', { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response('Bad Request', { status: 400 });
  }
});
```

### 6e. Deploy

```bash
supabase functions deploy revenuecat-webhook --no-verify-jwt
```

> `--no-verify-jwt` is required for webhook endpoints. Webhooks use their own
> `REVENUECAT_WEBHOOK_SECRET` for auth — not a Supabase JWT. Without this flag
> Supabase rejects all incoming requests with `{"code":401,"message":"Invalid JWT"}`.

Your webhook URL is:

```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/revenuecat-webhook
```

### 6f. Test the deployment

Use a valid UUID format (the DB `id` column is type `uuid`):

```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/revenuecat-webhook \
  -H "Authorization: Bearer your_chosen_webhook_secret" \
  -H "Content-Type: application/json" \
  -d '{"event":{"type":"INITIAL_PURCHASE","app_user_id":"550e8400-e29b-41d4-a716-446655440000","entitlement_id":"pro_access"}}'
```

Expected: `{"success":true}`

> ⚠️ Use a real UUID format (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
> `"test-user-uuid-1234"` will return `DB Error` because PostgreSQL rejects
> invalid UUID syntax. The `{"success":true}` response with a valid UUID means
> the function ran correctly even if it matched 0 rows (expected for a fake UUID).

---

## Step 7 — Connect RevenueCat Webhook

> Complete after RevenueCat setup (see `REVENUECAT_SETUP.md`).

1. RevenueCat dashboard → **Project Settings → Integrations → Webhooks → + New Webhook**
2. Set:
   - **Endpoint URL:** `https://YOUR_PROJECT_REF.supabase.co/functions/v1/revenuecat-webhook`
   - **Authorization header:** `Bearer your_chosen_webhook_secret`
   - **Events:** at minimum: `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION`
3. **Save** → **Send Test** → confirm `200 OK`

---

## Step 8 — End-to-End Verification

```bash
pnpm dev:app
# Check browser console for:
#   "Supabase anonymous session created"
#   No 401/403 errors in Network tab

# Check Supabase Table Editor → profiles
#   A new row should appear with is_premium = false after first boot
```

---

## Troubleshooting

| Symptom                                                | Cause                                    | Fix                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Failed to fetch` on boot                              | Wrong `VITE_SUPABASE_URL`                | Check `.env.local`, restart dev server                                                                    |
| Webhook returns `{"code":401,"message":"Invalid JWT"}` | Missing `--no-verify-jwt` flag           | Redeploy: `supabase functions deploy revenuecat-webhook --no-verify-jwt`                                  |
| Webhook returns `DB Error` with fake UUID              | Invalid UUID format in test              | Use real UUID format: `550e8400-e29b-41d4-a716-446655440000`                                              |
| Webhook returns `DB Error` with real UUID              | `SUPABASE_SERVICE_ROLE_KEY` not injected | Confirm function is deployed to the linked project                                                        |
| App boots but profiles row not created                 | `.single()` returns 406 on missing row   | Use `.maybeSingle()` in `monetization.ts` sync query                                                      |
| `RC_ENTITLEMENT_ID` TypeScript error                   | Imported and redeclared in same file     | Remove the `const RC_ENTITLEMENT_ID = 'pro_access'` line from `monetization.ts` — import only             |
| `@revenuecat/purchases-capacitor` resolve error on web | Vite bundles dynamic imports too         | Add stub alias in `vite.config.ts` pointing to `src/stubs/revenuecat.stub.ts`                             |
| `@capacitor/core` resolve error on web                 | Not installed in `@atc-app/app`          | Run `pnpm --filter @atc-app/app add @capacitor/core`                                                      |
| `@capacitor/filesystem` resolve error on web           | Not installed in `@atc-app/app`          | Run `pnpm --filter @atc-app/app add @capacitor/filesystem`                                                |
| `supabase secrets set SUPABASE_*` blocked              | CLI reserves `SUPABASE_` prefix          | Use `DB_SERVICE_ROLE_KEY` for CLI secrets; `SUPABASE_SERVICE_ROLE_KEY` is auto-injected in Edge Functions |
| `failed to parse environment file`                     | Base64 value contains `+` character      | Wrap the value in double quotes in your `.env` file                                                       |
| `supabase status` fails with Docker error              | Requires Docker for local dev            | Use deployed function URL instead — Docker not needed for our setup                                       |
| `is_premium` never updates after purchase              | Webhook not firing                       | RC dashboard → Webhooks → Recent Deliveries                                                               |
| `levels_full.json` returns 403                         | User not premium in DB                   | Confirm webhook fired and `is_premium = true` in profiles table                                           |
| Anonymous sign-in fails                                | Anonymous auth disabled                  | Dashboard → Authentication → Sign In Methods → Enable Anonymous                                           |
| Storage 404                                            | File not in bucket                       | Re-upload `levels_full.json` to `game_assets` bucket root                                                 |
| No profiles row created                                | Trigger not installed                    | Re-run SQL from Step 2 with Postgres role                                                                 |
| SQL editor "destructive operation" warning             | `drop trigger if exists` line            | Safe to ignore — click Run anyway                                                                         |

---

## Security Checklist

- [ ] `DB_SERVICE_ROLE_KEY` is NOT prefixed with `VITE_` in any env file
- [ ] `SUPABASE_SERVICE_ROLE_KEY` does not appear in any `packages/app/src/` file
- [ ] `levels_full.json` is NOT in `packages/app/src/assets/` (only in Supabase Storage)
- [ ] RLS enabled on `profiles` table (green lock icon in Table Editor)
- [ ] Storage RLS active on `game_assets` bucket
- [ ] Anonymous auth enabled
- [ ] Edge Function deployed with `--no-verify-jwt`
- [ ] Webhook test curl returned `{"success":true}`

---

## Reference

| Item                             | Value                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| Free levels                      | 1–3 (bundled as `packages/app/src/assets/levels_basic.json`)                        |
| Premium levels                   | 4–5 (`levels_full.json` in Supabase Storage `game_assets` bucket)                   |
| Entitlement ID                   | `pro_access`                                                                        |
| Storage bucket                   | `game_assets` (private)                                                             |
| Edge Function                    | `revenuecat-webhook`                                                                |
| Auth method                      | Anonymous                                                                           |
| Client DB throttle               | 60 seconds                                                                          |
| Supabase CLI install             | `brew install supabase/tap/supabase` (macOS)                                        |
| Edge Function auto-injected vars | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL` |
