-- Publish only branch-scoped kitchen order changes. Item changes are not
-- published because kitchen_order_items has no branch_id. A narrow insert
-- trigger touches the parent order for "send more"; KDS keeps polling too.
begin;
set local lock_timeout = '1s';

do $preflight$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     or to_regclass('public.kitchen_orders') is null
     or to_regclass('public.kitchen_order_items') is null then
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

create or replace function public.fnb_touch_kitchen_order_on_item_insert_00413()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.kitchen_orders
     set updated_at = now()
   where id = new.kitchen_order_id;
  return new;
end;
$$;

revoke all on function public.fnb_touch_kitchen_order_on_item_insert_00413()
  from public, anon, authenticated;

do $trigger$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.kitchen_order_items'::regclass
       and tgname = 'fnb_touch_kitchen_order_on_item_insert_00413'
       and not tgisinternal
  ) then
    create trigger fnb_touch_kitchen_order_on_item_insert_00413
    after insert on public.kitchen_order_items
    for each row execute function public.fnb_touch_kitchen_order_on_item_insert_00413();
  end if;
end;
$trigger$;

commit;
