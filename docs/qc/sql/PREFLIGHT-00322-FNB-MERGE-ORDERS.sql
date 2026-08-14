-- Read-only preflight for migration 00322.
-- Safe to run repeatedly. It does not change orders, items, tables or grants.

select
  to_regprocedure('public.user_has_permission(uuid,text)') is not null
    as permission_rpc_exists,
  to_regprocedure('public.user_has_branch_access(uuid,uuid)') is not null
    as branch_access_rpc_exists,
  to_regclass('public.kitchen_orders') is not null as kitchen_orders_exist,
  to_regclass('public.kitchen_order_items') is not null as kitchen_items_exist,
  to_regclass('public.fnb_kitchen_item_batches') is not null as batches_exist,
  to_regclass('public.restaurant_tables') is not null as tables_exist,
  to_regclass('public.audit_log') is not null as audit_log_exists,
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'kitchen_orders'
       and column_name in ('discount_amount', 'merged_into_id')
     group by table_schema, table_name
    having count(*) = 2
  ) as merge_columns_exist;

select
  p.proname,
  p.prosecdef as security_definer,
  pg_get_function_identity_arguments(p.oid) as arguments,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute')
    as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.oid = to_regprocedure(
    'public.merge_kitchen_orders_atomic(uuid,uuid[])'
  );

-- Before 00322: zero rows is expected.
-- After 00322: expect security_definer=true, anon=false, authenticated=true.
