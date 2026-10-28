-- rollback_fix_rls_recursion.sql
-- ONLY if fix_rls_recursion.sql breaks something on a device. Restores the exact
-- live policies of 2026-10-25 (verify_hardening.sql block 2), including their
-- known bugs (score upserts fail with 42P17 again). Safe to re-run.
-- Section B is separate and optional; it never re-opens the
-- get_account_for_device leak.

-- ── A. Undo fix_rls_recursion.sql ───────────────────────────────────────────
begin;

drop policy if exists "Premium users can view account scores" on public.account_scores;
drop policy if exists "Premium users can insert account scores" on public.account_scores;
drop policy if exists "Premium users can update account scores" on public.account_scores;
drop policy if exists "Premium users can update account scores (non-decreasing)" on public.account_scores;

create policy "Premium users can view account scores" on public.account_scores
  for select using (exists (select 1 from public.accounts a join public.profiles p on p.account_id = a.id
    where a.id = account_scores.account_id and p.id = auth.uid() and a.is_premium = true));
create policy "Premium users can insert account scores" on public.account_scores
  for insert with check (exists (select 1 from public.accounts a join public.profiles p on p.account_id = a.id
    where a.id = account_scores.account_id and p.id = auth.uid() and a.is_premium = true));
create policy "Premium users can update account scores (non-decreasing)" on public.account_scores
  for update
  using (exists (select 1 from public.accounts a join public.profiles p on p.account_id = a.id
    where a.id = account_scores.account_id and p.id = auth.uid() and a.is_premium = true))
  with check (exists (select 1 from public.accounts a join public.profiles p on p.account_id = a.id
    where a.id = account_scores.account_id and p.id = auth.uid() and a.is_premium = true)
    and max_planes >= (select max_planes from public.account_scores
      where account_id = account_scores.account_id and level_id = account_scores.level_id));

drop trigger if exists account_scores_keep_best on public.account_scores;
drop function if exists public.account_scores_keep_best();

drop policy if exists "Premium users can view account progress" on public.account_progress;
drop policy if exists "Premium users can upsert account progress" on public.account_progress;
drop policy if exists "Premium users can update account progress" on public.account_progress;

create policy "Premium users can view account progress" on public.account_progress
  for select using (exists (select 1 from public.accounts a join public.profiles p on p.account_id = a.id
    where a.id = account_progress.account_id and p.id = auth.uid() and a.is_premium = true));
create policy "Premium users can upsert account progress" on public.account_progress
  for insert with check (exists (select 1 from public.accounts a join public.profiles p on p.account_id = a.id
    where a.id = account_progress.account_id and p.id = auth.uid() and a.is_premium = true));
create policy "Premium users can update account progress" on public.account_progress
  for update using (exists (select 1 from public.accounts a join public.profiles p on p.account_id = a.id
    where a.id = account_progress.account_id and p.id = auth.uid() and a.is_premium = true));

drop policy if exists "Premium users can insert their own votes" on public.game_votes;
drop policy if exists "Premium users can update their own votes" on public.game_votes;

create policy "Premium users can insert their own votes" on public.game_votes
  for insert with check (exists (select 1 from public.profiles p join public.accounts a on a.id = p.account_id
    where p.id = auth.uid() and p.account_id = game_votes.account_id and a.is_premium = true));
create policy "Premium users can update their own votes" on public.game_votes
  for update
  using (exists (select 1 from public.profiles p
    where p.id = auth.uid() and p.account_id = game_votes.account_id))
  with check (exists (select 1 from public.profiles p join public.accounts a on a.id = p.account_id
    where p.id = auth.uid() and p.account_id = game_votes.account_id and a.is_premium = true));

drop policy if exists "Users can update own profile (progress fields only)" on public.profiles;
drop policy if exists "Users can update own profile (non-premium fields only)" on public.profiles;
create policy "Users can update own profile (non-premium fields only)" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id and is_premium = (select is_premium from public.profiles where id = auth.uid()));

revoke update (last_passed_level, passed_levels, updated_at) on public.profiles from authenticated;
grant update on table public.profiles to anon, authenticated;

drop function if exists public.is_my_premium_account(uuid);

commit;

-- ── B. Optional: undo the anon revokes of harden_supabase_2.sql ─────────────
-- Only if a signed-in client call starts failing with "permission denied for
-- function". Keeps the get_account_for_device caller guard and keeps
-- set_alias / set_password / generate_* service-role only.
-- grant execute on function public.get_account_for_device(uuid) to anon;
-- grant execute on function public.cast_vote(uuid, text, text) to anon;
-- grant execute on function public.check_and_claim_play_session(uuid) to anon;
-- grant execute on function public.heartbeat_play_session(uuid) to anon;
-- grant execute on function public.release_play_session(uuid) to anon;
-- grant execute on function public.set_recovery_word(uuid, text) to anon;
