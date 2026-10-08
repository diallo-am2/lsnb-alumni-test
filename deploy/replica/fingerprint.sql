-- One line per structural fact of the synced schemas (columns, constraints, policies,
-- triggers, functions). Two databases can exchange data only when both lists are identical.
-- Run with:  psql -At -v schemas="'auth','public','storage'" -f fingerprint.sql
select line
from (
  select 'col ' || c.table_schema || '.' || c.table_name || '.' || c.column_name || ' '
         || c.data_type || ' ' || c.is_nullable || ' ' || coalesce(c.column_default, '') || ' ' || c.is_generated as line
  from information_schema.columns c
  where c.table_schema in (:schemas)

  union all
  select 'con ' || n.nspname || '.' || t.relname || '.' || k.conname || ' ' || pg_get_constraintdef(k.oid)
  from pg_constraint k
  join pg_class t on t.oid = k.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname in (:schemas)

  union all
  select 'pol ' || p.schemaname || '.' || p.tablename || '.' || p.policyname || ' ' || p.cmd || ' ' || p.permissive
         || ' ' || coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
  from pg_policies p
  where p.schemaname in (:schemas)

  union all
  select 'trg ' || n.nspname || '.' || t.relname || ' ' || pg_get_triggerdef(g.oid)
  from pg_trigger g
  join pg_class t on t.oid = g.tgrelid
  join pg_namespace n on n.oid = t.relnamespace
  where not g.tgisinternal and n.nspname in (:schemas)

  union all
  select 'fn ' || n.nspname || '.' || f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ') ' || md5(f.prosrc)
  from pg_proc f
  join pg_namespace n on n.oid = f.pronamespace
  where n.nspname in (:schemas)
) facts
order by line collate "C";
