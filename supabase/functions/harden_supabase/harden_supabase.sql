-- harden_supabase.sql
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Based on the diagnose_supabase.sql output: tables/columns/functions are now
-- correct; these are the remaining leftovers and security gaps.

-- 1. accounts was readable AND writable with the shipped anon key
--    ("Service role full access" had roles={public} and using(true)), which
--    exposes every alias, password (= restore credential) and recovery_word.
--    SECURITY DEFINER functions and the service-role Edge Functions bypass RLS,
--    so restricting the policy to service_role breaks nothing.
drop policy if exists "Service role full access" on public.accounts;
create policy "Service role full access" on public.accounts
  for all
  to service_role
  using (true)
  with check (true);

-- 2. recover_by_word returns the account PASSWORD and has no caller guard; it must be
--    reachable only through the recover-account Edge Function (service role).
--    restore_account (legacy, unused by the client) links ANY uid without a
--    caller check, so it gets the same treatment.
revoke all on function public.recover_by_word(text, text) from public, anon, authenticated;
grant execute on function public.recover_by_word(text, text) to service_role;

revoke all on function public.restore_account(text, text, uuid) from public, anon, authenticated;
grant execute on function public.restore_account(text, text, uuid) to service_role;

-- 3. Remove the legacy claim_account (still deployed with the bad [A-Z2-9] regex,
--    callable by anon, and no longer used: the client never calls it).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'claim_account'
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- 4. Optional cleanup of the pre-accounts-model leftovers (only if nothing reads them):
-- drop table if exists public.user_scores;
-- alter table public.profiles drop column if exists current_level;
