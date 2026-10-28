-- diagnose_supabase.sql
-- READ-ONLY. Paste into the Supabase SQL editor and run as one query.
-- Send me the full result grid (export CSV or screenshot).

select kind, name, detail from (

  -- Which tables exist
  select 1 as o, 'table' as kind, table_name::text as name, '' as detail
  from information_schema.tables
  where table_schema = 'public'

  union all
  -- Columns of the tables that matter
  select 2, 'column', table_name::text, column_name || ' ' || data_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('accounts','profiles','account_scores','account_progress','game_votes')

  union all
  -- Deployed functions: which regex they use, whether the ambiguity guard is there, who can run them
  select 3, 'function', p.proname::text,
    case when pg_get_functiondef(p.oid) like '%A-Z2-9%' then 'REGEX=A-Z2-9 (BAD)'
         when pg_get_functiondef(p.oid) like '%A-Z0-9%' then 'REGEX=A-Z0-9 (ok)'
         else 'no regex' end
    || ' | ' ||
    case when pg_get_functiondef(p.oid) ilike '%variable_conflict%' then 'use_column' else 'no_var_conflict_guard' end
    || ' | execute: ' ||
    coalesce((select string_agg(distinct g.grantee::text, ',')
              from information_schema.routine_privileges g
              where g.specific_name = p.proname || '_' || p.oid and g.routine_schema = 'public'
                and g.privilege_type = 'EXECUTE'), 'public/default')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'

  union all
  -- Triggers that matter
  select 4, 'trigger', tgname::text, tgrelid::regclass::text
  from pg_trigger
  where not tgisinternal
    and tgrelid::regclass::text in ('auth.users','public.profiles','public.accounts')

  union all
  -- RLS policies
  select 5, 'policy', tablename::text || '.' || policyname::text,
         cmd || ' roles=' || roles::text
  from pg_policies
  where schemaname = 'public'

  union all
  -- Row counts (safe if a table is missing)
  select 6, 'rowcount', t.name,
    case when to_regclass(t.name) is null then 'MISSING'
         else (xpath('/row/c/text()',
               query_to_xml('select count(*) as c from ' || t.name, false, true, '')))[1]::text
    end
  from (values ('auth.users'), ('public.profiles'), ('public.accounts'),
               ('public.account_scores'), ('public.account_progress')) as t(name)

) r
order by o, name, detail;
