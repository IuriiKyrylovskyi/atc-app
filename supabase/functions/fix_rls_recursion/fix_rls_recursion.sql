-- fix_rls_recursion.sql
-- Run once in the Supabase SQL editor, AFTER harden_supabase_2.sql. Safe to re-run.
-- Rewritten 2026-10-25 from the live policies (verify_hardening.sql block 2);
-- the original file was lost. It fixes three things:
--
--   1. The account_scores, account_progress and game_votes policies read
--      public.accounts as the player. Since harden_supabase.sql, accounts is
--      service_role only, so that subquery sees no rows and every read and write
--      of a premium player fails. A SECURITY DEFINER helper does the check instead.
--   2. The account_scores update policy read account_scores itself, and the
--      select policy it reaches there has a subquery too, which is 42P17
--      "infinite recursion" on every upsert (score sync never stored a row: no
--      premium-linked account has one), and its non-decreasing check compared
--      account_scores_1 with itself. A BEFORE UPDATE trigger keeps the best value.
--   3. The profiles update policy reads profiles itself. That does NOT raise
--      42P17 (Postgres only does when the inner policies have subqueries of their
--      own, and the profiles select policy is a plain auth.uid() = id), so
--      profile updates work, but the policy guards only is_premium: a device can
--      set its own account_id to any account id it knows, and
--      get_account_for_device then hands it that account's password. Column
--      privileges replace the subquery and protect every server-owned column.

begin;

-- ── 1. Helper: is this account the caller's own, linked and premium? ─────────
create or replace function public.is_my_premium_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.accounts a on a.id = p.account_id
    where p.id = auth.uid()
      and a.id = p_account_id
      and a.is_premium
  );
$$;

revoke all on function public.is_my_premium_account(uuid) from public, anon;
grant execute on function public.is_my_premium_account(uuid) to authenticated;

-- ── 2. account_scores ────────────────────────────────────────────────────────
drop policy if exists "Premium users can view account scores" on public.account_scores;
drop policy if exists "Premium users can insert account scores" on public.account_scores;
drop policy if exists "Premium users can update account scores (non-decreasing)" on public.account_scores;
drop policy if exists "Premium users can update account scores" on public.account_scores;

create policy "Premium users can view account scores"
  on public.account_scores for select to authenticated
  using (public.is_my_premium_account(account_id));

create policy "Premium users can insert account scores"
  on public.account_scores for insert to authenticated
  with check (public.is_my_premium_account(account_id));

create policy "Premium users can update account scores"
  on public.account_scores for update to authenticated
  using (public.is_my_premium_account(account_id))
  with check (public.is_my_premium_account(account_id));

-- A player's best never goes down. Service role and SECURITY DEFINER functions
-- (run as the owner) may still correct a value.
create or replace function public.account_scores_keep_best()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.max_planes := greatest(old.max_planes, new.max_planes);
  end if;
  return new;
end;
$$;

drop trigger if exists account_scores_keep_best on public.account_scores;
create trigger account_scores_keep_best
  before update on public.account_scores
  for each row execute function public.account_scores_keep_best();

-- ── 3. account_progress (written today only by link_account, a definer) ─────
drop policy if exists "Premium users can view account progress" on public.account_progress;
drop policy if exists "Premium users can upsert account progress" on public.account_progress;
drop policy if exists "Premium users can update account progress" on public.account_progress;

create policy "Premium users can view account progress"
  on public.account_progress for select to authenticated
  using (public.is_my_premium_account(account_id));

create policy "Premium users can upsert account progress"
  on public.account_progress for insert to authenticated
  with check (public.is_my_premium_account(account_id));

create policy "Premium users can update account progress"
  on public.account_progress for update to authenticated
  using (public.is_my_premium_account(account_id))
  with check (public.is_my_premium_account(account_id));

-- ── 4. game_votes (writes go through cast_vote; the select policy is fine) ──
drop policy if exists "Premium users can insert their own votes" on public.game_votes;
drop policy if exists "Premium users can update their own votes" on public.game_votes;

create policy "Premium users can insert their own votes"
  on public.game_votes for insert to authenticated
  with check (public.is_my_premium_account(account_id));

create policy "Premium users can update their own votes"
  on public.game_votes for update to authenticated
  using (public.is_my_premium_account(account_id))
  with check (public.is_my_premium_account(account_id));

-- ── 5. profiles: own row only, progress columns only ────────────────────────
-- The client updates exactly last_passed_level, passed_levels and updated_at
-- (monetization.ts savePassedLevelsToServer and the level update). Everything
-- else (is_premium, account_id, rc_customer_id, purchased_at, platform) is
-- written only by the webhook, Edge Functions and SECURITY DEFINER functions.
drop policy if exists "Users can update own profile (non-premium fields only)" on public.profiles;
drop policy if exists "Users can update own profile (progress fields only)" on public.profiles;

create policy "Users can update own profile (progress fields only)"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke update on table public.profiles from anon, authenticated;
grant update (last_passed_level, passed_levels, updated_at) on public.profiles to authenticated;

commit;

-- Check (the editor shows this result). Expected: no row reads accounts or
-- itself, and every changed policy is for role authenticated.
select tablename, policyname, cmd, roles,
       concat(qual, ' ', with_check) ~* '(from|join)\s+\(?\s*(public\.)?accounts\M' as reads_accounts,
       concat(qual, ' ', with_check) ~* ('(from|join)\s+\(?\s*(public\.)?' || tablename::text || '\M') as reads_itself
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;
