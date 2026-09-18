-- Read-only postflight for 00387. Expected values are all true.
select
  to_regclass('public.fnb_supply_branch_scopes') is not null as scope_table_ok,
  to_regclass('public.fnb_supply_branch_scope_audit') is not null as scope_audit_table_ok,
  to_regprocedure('public.set_fnb_supply_branch_enforcement(uuid,boolean,text)') is not null as scope_rpc_ok,
  to_regprocedure('public.create_internal_sale_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)') is not null as internal_sale_rpc_ok;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  has_table_privilege('authenticated', 'public.' || c.relname, 'select') as authenticated_select,
  has_table_privilege('authenticated', 'public.' || c.relname, 'insert') as authenticated_insert,
  has_table_privilege('authenticated', 'public.' || c.relname, 'update') as authenticated_update,
  has_table_privilege('authenticated', 'public.' || c.relname, 'delete') as authenticated_delete
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('fnb_supply_branch_scopes', 'fnb_supply_branch_scope_audit')
order by c.relname;

select
  p.proowner::regrole::text as owner,
  p.prosecdef as security_definer,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
from pg_proc p
where p.oid = to_regprocedure('public.set_fnb_supply_branch_enforcement(uuid,boolean,text)');

select
  p.prosrc like '%fnb_supply_branch_scopes%' as opt_in_scope_checked,
  p.prosrc like '%fnb_supply_catalog%' as catalog_checked,
  p.prosrc like '%_create_internal_sale_auth_impl_00243%' as existing_atomic_impl_preserved,
  p.prosrc like '%_reconcile_product_lots_to_branch_00284%' as fifo_reconciliation_preserved,
  p.prosrc like '%FNB_SUPPLY_CATALOG_REQUIRED%' as unapproved_sku_rejected
from pg_proc p
where p.oid = to_regprocedure('public.create_internal_sale_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)');
