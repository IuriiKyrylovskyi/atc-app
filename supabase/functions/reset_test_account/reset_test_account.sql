-- reset_test_account.sql  (TEST DATA ONLY)
-- Recreates the "lost accounts row" situation so the next Restore Account has to go
-- through claim-purchase + RevenueCat, not through the database row.
-- The paid purchase stays in RevenueCat on whichever customer last held it.

delete from public.accounts where alias = 'TESTPLAYER';
-- profiles.account_id -> null (on delete set null); scores/progress cascade-delete.

update public.profiles set is_premium = false where is_premium;
