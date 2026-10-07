-- Realtime invalidation for existing authorized readers, without changing RLS/grants.
begin;
set local lock_timeout = '1s';
do $migration$
declare v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'LIVE_DASHBOARD_PUBLICATION_MISSING';
  end if;
  foreach v_table in array array['invoices', 'cash_transactions'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=v_table and c.relrowsecurity)
       or not exists (select 1 from pg_policies where schemaname='public' and tablename=v_table and cmd in ('SELECT','ALL')) then
      raise exception 'LIVE_DASHBOARD_RLS_REQUIRED: %', v_table;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$migration$;
commit;
