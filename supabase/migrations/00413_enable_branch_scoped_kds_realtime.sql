-- Publish only branch-scoped kitchen order changes. Item changes are not
-- published because kitchen_order_items has no branch_id; KDS keeps polling
-- as a fallback and order-status RPCs also update kitchen_orders.
begin;
set local lock_timeout = '1s';

do $preflight$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     or to_regclass('public.kitchen_orders') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00413_PREREQUISITE_MISSING';
  end if;
  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'kitchen_orders'
       and c.relrowsecurity
  ) or not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'kitchen_orders'
       and cmd in ('SELECT', 'ALL')
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_00413_KDS_RLS_REQUIRED';
  end if;
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'kitchen_orders'
  ) then
    alter publication supabase_realtime add table public.kitchen_orders;
  end if;
end;
$preflight$;

commit;
