-- harden_supabase_2.sql
-- Run once in the Supabase SQL editor. Safe to re-run. Run it BEFORE
-- fix_rls_recursion.sql (this one closes a live leak; that one restores sync).
-- Based on verify_hardening.sql blocks 3, 5 and 7 (2026-10-25).

begin;

-- 1. get_account_for_device returned alias, password and recovery word for ANY
--    device uid, to anon and to every signed-in player (block 5:
--    other_account_rows = 1). Device uids are RevenueCat App User IDs, so they
--    appear in RevenueCat, in support mails and in debug-overlay copies.
--    Same signature and return type, so create or replace is enough. The client
--    always passes its own uid, so it sees no change.
create or replace function public.get_account_for_device(current_user_id uuid)
returns table(account_id uuid, alias text, password text, is_premium boolean, recovery_word text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from current_user_id then
    return;
  end if;

  return query
  select a.id, a.alias, a.password, a.is_premium, a.recovery_word
  from public.accounts a
  join public.profiles p on p.account_id = a.id
  where p.id = current_user_id;
end;
$$;

-- 2. Functions the client calls only while signed in (anonymous sign-in is role
--    authenticated). Each already rejects a foreign uid; anon loses EXECUTE as
--    defence in depth. get_leaderboard and check_alias_availability stay public.
revoke all on function public.get_account_for_device(uuid) from public, anon;
revoke all on function public.cast_vote(uuid, text, text) from public, anon;
revoke all on function public.check_and_claim_play_session(uuid) from public, anon;
revoke all on function public.heartbeat_play_session(uuid) from public, anon;
revoke all on function public.release_play_session(uuid) from public, anon;
revoke all on function public.set_recovery_word(uuid, text) from public, anon;
grant execute on function public.get_account_for_device(uuid) to authenticated;
grant execute on function public.cast_vote(uuid, text, text) to authenticated;
grant execute on function public.check_and_claim_play_session(uuid) to authenticated;
grant execute on function public.heartbeat_play_session(uuid) to authenticated;
grant execute on function public.release_play_session(uuid) to authenticated;
grant execute on function public.set_recovery_word(uuid, text) to authenticated;

-- 3. set_alias and set_password have no caller (client or Edge Function).
--    set_password answers 'taken' when ANY other account already uses the
--    candidate, so a signed-in premium player could test passwords and then try
--    them against the public leaderboard aliases. Service role only until a
--    feature needs them (fix the 'taken' check first).
revoke all on function public.set_alias(uuid, text) from public, anon, authenticated;
revoke all on function public.set_password(uuid, text) from public, anon, authenticated;
grant execute on function public.set_alias(uuid, text) to service_role;
grant execute on function public.set_password(uuid, text) to service_role;

-- 4. generate_alias / generate_password call random() but were declared
--    IMMUTABLE, which lets the planner reuse one result. Only the webhook
--    (service role) calls them.
alter function public.generate_alias() volatile;
alter function public.generate_password() volatile;
revoke all on function public.generate_alias() from public, anon, authenticated;
revoke all on function public.generate_password() from public, anon, authenticated;
grant execute on function public.generate_alias() to service_role;
grant execute on function public.generate_password() to service_role;

commit;

-- Check (the editor shows this result). Expected: anon_can_run false on every
-- row; authenticated_can_run true on the first six, false on the last four.
select p.oid::regprocedure as function_signature,
       p.provolatile as volatility,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('get_account_for_device', 'cast_vote', 'check_and_claim_play_session',
                    'heartbeat_play_session', 'release_play_session', 'set_recovery_word',
                    'set_alias', 'set_password', 'generate_alias', 'generate_password')
order by 4 desc, p.proname;
