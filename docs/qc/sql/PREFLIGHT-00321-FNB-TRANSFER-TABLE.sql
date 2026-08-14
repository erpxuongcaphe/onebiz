-- Read-only preflight for migration 00321.
-- Safe to run repeatedly. It does not change orders, tables, or permissions.

select
  to_regprocedure('public.fnb_transfer_table_atomic(uuid,uuid,uuid,uuid)') is not null
    as transfer_rpc_exists,
  to_regprocedure('public.user_has_permission(uuid,text)') is not null
    as permission_rpc_exists,
  to_regprocedure('public.user_has_branch_access(uuid,uuid)') is not null
    as branch_access_rpc_exists,
  to_regprocedure('public.get_user_tenant_id()') is not null
    as tenant_rpc_exists,
  to_regclass('public.restaurant_tables') is not null
    as tables_exist,
  to_regclass('public.kitchen_orders') is not null
    as kitchen_orders_exist,
  to_regclass('public.audit_log') is not null
    as audit_log_exists;

select
  p.proname,
  p.prosecdef as security_definer,
  pg_get_function_identity_arguments(p.oid) as arguments,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'fnb_transfer_table_atomic';
