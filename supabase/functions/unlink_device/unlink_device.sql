-- unlink_device: detaches the calling device from its account without deleting
-- anything. Used by "Switch to another account" and "Start fresh".
--
-- Differences from the first version:
--   * active_device_id (the real column) instead of current_device_id (does not exist).
--   * Columns are table-qualified. The OUT column `account_id` would otherwise clash
--     with profiles.account_id and raise "column reference is ambiguous" on every call.
--   * Own-session guard (same pattern as check_and_claim_play_session): a caller may
--     only unlink ITS OWN device.
--   * search_path pinned, because the function is SECURITY DEFINER.
--   * Frees the play session the way release_play_session does (expires it immediately).
--   * Execute limited to signed-in (including anonymous) users.

create or replace function public.unlink_device(p_user_id uuid)
returns table(success boolean, was_linked boolean, account_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  if auth.uid() is distinct from p_user_id then
    return query select false, false, null::uuid;
    return;
  end if;

  select profiles.account_id into v_account_id
  from public.profiles
  where profiles.id = p_user_id;

  if v_account_id is null then
    return query select true, false, null::uuid;
    return;
  end if;

  update public.profiles
  set account_id = null,
      is_premium = false,
      updated_at = now()
  where profiles.id = p_user_id;

  update public.accounts
  set active_device_id = null,
      session_expires_at = now(),
      updated_at = now()
  where accounts.id = v_account_id
    and accounts.active_device_id = p_user_id;

  return query select true, true, v_account_id;
end;
$$;

revoke all on function public.unlink_device(uuid) from public, anon;
grant execute on function public.unlink_device(uuid) to authenticated;
