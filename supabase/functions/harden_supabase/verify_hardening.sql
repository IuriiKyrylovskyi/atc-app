-- verify_hardening.sql
-- Read-only. Evidence for FIX_PREMIUM.md 5.11 (1) after harden_supabase.sql
-- (blocks 1-5) and for the Phase 0 re-audit (blocks 6-7).
-- The SQL editor shows only the last result, so select ONE block and use
-- "Run selected", then copy the result. No block prints a password or a word.
--
-- Already proven from outside with the anon key (2026-10-25): accounts returns
-- 0 rows; recover_by_word, restore_account, link_account give 42501;
-- claim_account is gone; set_alias / set_password answer "unauthorized".

-- ── Block 1: RLS is on, and legacy leftovers ────────────────────────────────
select c.relname as table_name,
       c.relrowsecurity as rls_on,
       to_regclass('public.user_scores') is not null as user_scores_still_exists,
       (select count(*) from pg_proc
         where pronamespace = 'public'::regnamespace and proname = 'claim_account') as claim_account_versions
from pg_class c
where c.oid in ('public.accounts'::regclass, 'public.profiles'::regclass,
                'public.account_scores'::regclass, 'public.account_progress'::regclass,
                'public.game_votes'::regclass)
order by 1;

-- ── Block 2: every policy, and whether it reads accounts ────────────────────
-- A policy that reads public.accounts runs as the player, and accounts is now
-- service_role only, so that policy can never pass for a player.
select tablename, policyname, cmd, roles,
       concat(qual, ' ', with_check) ~* '(from|join)\s+\(?\s*(public\.)?accounts\M' as reads_accounts,
       concat(qual, ' ', with_check) ~* ('(from|join)\s+\(?\s*(public\.)?' || tablename::text || '\M') as reads_itself,
       qual, with_check
from pg_policies
where schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects')
order by tablename, cmd, policyname;

-- ── Block 3: public functions, definer mode, caller guard, who can run them ──
select p.oid::regprocedure as function_signature,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ','), '') as config,
       position('auth.uid()' in pg_get_functiondef(p.oid)) > 0 as mentions_auth_uid,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
order by p.oid::regprocedure::text;

-- ── Block 4: ground truth as owner (premium devices with the most data) ─────
select left(p.id::text, 8) as device_uid_prefix,
       a.alias,
       (select count(*) from public.account_scores s where s.account_id = a.id) as scores_owned,
       (select count(*) from public.account_progress g where g.account_id = a.id) as progress_owned,
       (select count(*) from public.game_votes v where v.account_id = a.id) as votes_owned
from public.profiles p
join public.accounts a on a.id = p.account_id
where p.is_premium
order by 3 desc, p.updated_at desc nulls last
limit 5;

-- ── Block 5: the same device as a signed-in player (role authenticated) ─────
-- Run all three statements together. They share one implicit transaction, so
-- the role switch ends with it. Check running_as = authenticated first; if not,
-- the numbers are owner numbers and mean nothing.
-- Expected: accounts_visible 0, profiles_visible 1, own_account_rows 1,
-- other_account_rows 0, and scores/progress/votes equal to the first row of
-- block 4. scores_visible 0 there means the policies broke score sync.
select set_config('request.jwt.claims', json_build_object(
         'sub', (select p.id from public.profiles p
                  where p.is_premium and p.account_id is not null
                  order by (select count(*) from public.account_scores s where s.account_id = p.account_id) desc,
                           p.updated_at desc nulls last
                  limit 1),
         'role', 'authenticated')::text, true),
       set_config('skm.other_uid', coalesce((
         select p.id::text from public.profiles p
          where p.account_id is not null
            and p.account_id is distinct from (
              select p2.account_id from public.profiles p2
               where p2.is_premium and p2.account_id is not null
               order by (select count(*) from public.account_scores s where s.account_id = p2.account_id) desc,
                        p2.updated_at desc nulls last
               limit 1)
          limit 1), '00000000-0000-0000-0000-000000000000'), true);
set local role authenticated;
select current_user as running_as,
       left(auth.uid()::text, 8) as uid_prefix,
       (select count(*) from public.accounts) as accounts_visible,
       (select count(*) from public.profiles) as profiles_visible,
       (select count(*) from public.get_account_for_device(auth.uid())) as own_account_rows,
       (select count(*) from public.get_account_for_device(current_setting('skm.other_uid')::uuid)) as other_account_rows,
       (select count(*) from public.account_scores) as scores_visible,
       (select count(*) from public.account_progress) as progress_visible,
       (select count(*) from public.game_votes) as votes_visible;

-- ── Block 6: constraints and the signup trigger (Phase 0: 0.1, 0.5) ─────────
-- Expected: accounts has a primary key and UNIQUE (alias), and no unique
-- constraint or unique index on password; on_auth_user_created exists.
select 'constraint' as kind, conrelid::regclass::text as on_table, conname as name,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.accounts'::regclass, 'public.profiles'::regclass)
union all
select 'index', tablename::text, indexname::text, indexdef
from pg_indexes
where schemaname = 'public' and tablename in ('accounts', 'profiles')
union all
select 'trigger', tgrelid::regclass::text, tgname::text, pg_get_triggerdef(oid)
from pg_trigger
where not tgisinternal and tgrelid in ('auth.users'::regclass, 'public.accounts'::regclass,
                                       'public.profiles'::regclass)
order by 1, 2, 3;

-- ── Block 7: live bodies of the functions the audit depends on ──────────────
-- SUPABASE_SCHEMA_ACCOUNTS.sql is out of date (task 5.6), so these are the only
-- reliable copy. Export the result as CSV. Bodies hold no credentials.
select p.oid::regprocedure::text as function_signature,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  and p.proname in ('generate_alias', 'generate_password', 'handle_new_user',
                    'get_account_for_device', 'link_account', 'restore_account',
                    'recover_by_word', 'set_alias', 'set_password', 'set_recovery_word',
                    'check_alias_availability', 'get_leaderboard', 'cast_vote',
                    'unlink_device', 'check_and_claim_play_session',
                    'heartbeat_play_session', 'release_play_session')
order by 1;
