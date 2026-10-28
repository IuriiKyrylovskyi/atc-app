-- rate_limits.sql
-- Run once in the Supabase SQL editor, BEFORE deploying the restore-key and
-- recover-account versions that call these functions. Safe to re-run.
--
-- FIX_PREMIUM.md 5.13 (and 5.8): attempt limits for the two endpoints that turn
-- a guess into account access. The alias is public (leaderboard), so without a
-- limit restore-key (alias + password) and recover-account (alias + recovery
-- word; it returns the password) can be brute-forced.
--
-- Limits, the same for restore and recover, counting FAILED guesses over a
-- rolling hour (owner decision 2026-10-28):
--   5 per alias, 15 per network address, 5 per device (caller uid)
-- The address limit is higher because many players share one address (home
-- Wi-Fi, schools, mobile carriers), and at 5 a few typos by others on the same
-- network would block everyone there.
-- A successful restore or recovery clears that alias's failures. Only failures
-- are stored, and rows older than a day are deleted. The network address is
-- stored only as a keyed hash computed in the Edge Function, never the IP.

begin;

-- ── 1. Failed attempts ───────────────────────────────────────────────────────
create table if not exists public.credential_attempts (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('restore', 'recover')),
  alias      text not null,
  caller     uuid,
  ip_hash    text,
  created_at timestamptz not null default now()
);

create index if not exists credential_attempts_alias_idx
  on public.credential_attempts (kind, alias, created_at);
create index if not exists credential_attempts_ip_idx
  on public.credential_attempts (kind, ip_hash, created_at);
create index if not exists credential_attempts_caller_idx
  on public.credential_attempts (kind, caller, created_at);
create index if not exists credential_attempts_created_idx
  on public.credential_attempts (created_at);

-- No policy: only service_role (and SECURITY DEFINER functions) touch it.
alter table public.credential_attempts enable row level security;
revoke all on table public.credential_attempts from anon, authenticated;

-- ── 2. Gate: seconds to wait, 0 when the attempt may go ahead ────────────────
-- Takes transaction-level locks on the alias and the address, so concurrent
-- attempts on them run one after another and cannot all pass the count before
-- any of them is recorded. Call it only from the *_limited functions below,
-- inside the same transaction as the check and the record.
create or replace function public.credential_attempt_wait(
  p_kind text, p_alias text, p_caller uuid, p_ip_hash text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  window_start timestamptz := now() - interval '1 hour';
  max_alias  int := 5;
  max_ip     int := 15;
  max_caller int := 5;
  edge timestamptz;
  wait_seconds int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('cred:' || p_kind || ':' || p_alias));
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtext('cred-ip:' || p_kind || ':' || p_ip_hash));
  end if;

  delete from public.credential_attempts where created_at < now() - interval '1 day';

  -- For each bucket: when it holds the maximum number of failures, the attempt
  -- may go ahead once the oldest of those leaves the one-hour window.
  select min(t.created_at) into edge from (
    select a.created_at from public.credential_attempts a
    where a.kind = p_kind and a.alias = p_alias and a.created_at > window_start
    order by a.created_at desc limit max_alias
  ) t having count(*) >= max_alias;
  if edge is not null then
    wait_seconds := greatest(wait_seconds, ceil(extract(epoch from (edge + interval '1 hour' - now())))::int);
  end if;

  if p_ip_hash is not null then
    edge := null;
    select min(t.created_at) into edge from (
      select a.created_at from public.credential_attempts a
      where a.kind = p_kind and a.ip_hash = p_ip_hash and a.created_at > window_start
      order by a.created_at desc limit max_ip
    ) t having count(*) >= max_ip;
    if edge is not null then
      wait_seconds := greatest(wait_seconds, ceil(extract(epoch from (edge + interval '1 hour' - now())))::int);
    end if;
  end if;

  if p_caller is not null then
    edge := null;
    select min(t.created_at) into edge from (
      select a.created_at from public.credential_attempts a
      where a.kind = p_kind and a.caller = p_caller and a.created_at > window_start
      order by a.created_at desc limit max_caller
    ) t having count(*) >= max_caller;
    if edge is not null then
      wait_seconds := greatest(wait_seconds, ceil(extract(epoch from (edge + interval '1 hour' - now())))::int);
    end if;
  end if;

  return greatest(wait_seconds, 0);
end;
$$;

-- ── 3. Record the outcome ────────────────────────────────────────────────────
create or replace function public.credential_attempt_record(
  p_kind text, p_alias text, p_caller uuid, p_ip_hash text, p_success boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_success then
    delete from public.credential_attempts where kind = p_kind and alias = p_alias;
  else
    insert into public.credential_attempts (kind, alias, caller, ip_hash)
    values (p_kind, p_alias, p_caller, p_ip_hash);
  end if;
end;
$$;

-- ── 4. Limited restore (used by restore-key instead of link_account) ─────────
-- Only not_found counts as a failed guess: not_paid and already_linked are
-- answered after the alias + password matched.
create or replace function public.link_account_limited(
  p_alias text, p_password text, p_current_user_id uuid, p_ip_hash text
)
returns table(account_id uuid, alias text, password text, is_premium boolean,
              success boolean, error text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  norm_alias text := upper(btrim(p_alias));
  wait_seconds int;
  r record;
begin
  wait_seconds := public.credential_attempt_wait('restore', norm_alias, p_current_user_id, p_ip_hash);
  if wait_seconds > 0 then
    return query select null::uuid, null::text, null::text, false, false, 'rate_limited'::text, wait_seconds;
    return;
  end if;

  select * into r from public.link_account(p_alias, p_password, p_current_user_id);

  if r.success then
    perform public.credential_attempt_record('restore', norm_alias, p_current_user_id, p_ip_hash, true);
  elsif r.error is null or r.error = 'not_found' then
    perform public.credential_attempt_record('restore', norm_alias, p_current_user_id, p_ip_hash, false);
  end if;

  return query select r.account_id, r.alias, r.password, r.is_premium, r.success, r.error, 0;
end;
$$;

-- ── 5. Limited recovery (used by recover-account instead of recover_by_word) ─
-- not_found and no_recovery_word both count: either way the guess failed.
create or replace function public.recover_by_word_limited(
  p_alias text, p_word text, p_caller uuid, p_ip_hash text
)
returns table(account_id uuid, alias text, password text, success boolean,
              error text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  norm_alias text := upper(btrim(p_alias));
  wait_seconds int;
  r record;
begin
  wait_seconds := public.credential_attempt_wait('recover', norm_alias, p_caller, p_ip_hash);
  if wait_seconds > 0 then
    return query select null::uuid, null::text, null::text, false, 'rate_limited'::text, wait_seconds;
    return;
  end if;

  select * into r from public.recover_by_word(p_alias, p_word);

  if r.success then
    perform public.credential_attempt_record('recover', norm_alias, p_caller, p_ip_hash, true);
  elsif r.error is null or r.error in ('not_found', 'no_recovery_word') then
    perform public.credential_attempt_record('recover', norm_alias, p_caller, p_ip_hash, false);
  end if;

  return query select r.account_id, r.alias, r.password, r.success, r.error, 0;
end;
$$;

-- ── 6. Service role only ─────────────────────────────────────────────────────
revoke all on function public.credential_attempt_wait(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.credential_attempt_record(text, text, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.link_account_limited(text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.recover_by_word_limited(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.credential_attempt_wait(text, text, uuid, text) to service_role;
grant execute on function public.credential_attempt_record(text, text, uuid, text, boolean) to service_role;
grant execute on function public.link_account_limited(text, text, uuid, text) to service_role;
grant execute on function public.recover_by_word_limited(text, text, uuid, text) to service_role;

commit;

-- Check (the editor shows this result). Expected: 4 rows, every
-- anon_can_run and authenticated_can_run false.
select p.oid::regprocedure as function_signature,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('credential_attempt_wait', 'credential_attempt_record',
                    'link_account_limited', 'recover_by_word_limited')
order by p.proname;
