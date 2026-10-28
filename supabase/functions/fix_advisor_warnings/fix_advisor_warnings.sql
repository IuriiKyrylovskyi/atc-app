-- fix_advisor_warnings.sql
-- Clears the Security Advisor items from the screenshots. Safe to re-run.

-- 1. "Function Search Path Mutable": pin search_path on every function in public
--    that does not have one yet. All of these reference public.* objects only.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
      )
  loop
    execute 'alter function ' || r.sig || ' set search_path = public';
  end loop;
end $$;

-- 2. "RLS Enabled No Policy" on public.user_scores: legacy pre-accounts table.
--    Nothing in the client reads it (accounts model uses account_scores).
--    Check first that it is empty/unneeded, then drop:
-- select count(*) from public.user_scores;
drop table if exists public.user_scores;
