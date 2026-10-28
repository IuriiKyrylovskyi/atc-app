-- Fix for claim_account: input parameters must NOT share names with the
-- output table's columns (alias/password), or Postgres refuses to create
-- the function ("parameter name ... used more than once"). This mirrors the
-- p_alias/p_password convention already used in link_account.
--
-- Safe to run any time via CREATE OR REPLACE — no data is touched, and the
-- corresponding client call now sends alias_candidate/password_candidate
-- (see monetization.ts claimAccount()).

create or replace function public.claim_account(
current_user_id uuid,
alias_candidate text,
password_candidate text
)
returns table(account_id uuid, alias text, password text, is_premium boolean, success boolean, error text)
language plpgsql
security definer
as $$
declare
norm_alias text;
norm_password text;
existing_account uuid;
my_account_id uuid;
begin
norm_alias := upper(btrim(alias_candidate));
norm_password := upper(btrim(password_candidate));

if norm_alias !~ '^[A-Z0-9]{8,16}$' or norm_password !~ '^[A-Z0-9]{8,16}$' then
return query select null::uuid, null::text, null::text, false, false, 'invalid_format'::text;
return;
end if;

-- Check if alias already exists on another account
select id into existing_account
from public.accounts
where alias = norm_alias;

if existing_account is not null then
return query select null::uuid, null::text, null::text, false, false, 'taken'::text;
return;
end if;

-- Check if password already exists on another account (should be unique)
select id into existing_account
from public.accounts
where password = norm_password;

if existing_account is not null then
return query select null::uuid, null::text, null::text, false, false, 'taken'::text;
return;
end if;

-- Get or create the account linked to this device's profile
select account_id into my_account_id
from public.profiles
where id = current_user_id;

if my_account_id is null then
-- Profile has no account yet (shouldn't happen due to handle_new_user, but defensive)
insert into public.accounts (alias, password, is_premium)
values (norm_alias, norm_password, false)
returning id into my_account_id;

    update public.profiles set account_id = my_account_id where id = current_user_id;

else
-- Update the existing account with the chosen credentials
update public.accounts
set alias = norm_alias, password = norm_password, updated_at = now()
where id = my_account_id;
end if;

return query select my_account_id, norm_alias, norm_password, false, true, null::text;
end;

$$
;
$$
