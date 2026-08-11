-- Read-only preflight for 00308. This file does not update business data.

select
  to_regprocedure('public.get_user_tenant_id()') is not null as tenant_rpc_ok,
  to_regprocedure('public.user_has_permission(uuid,text)') is not null as permission_rpc_ok,
  to_regclass('public.suppliers') is not null as suppliers_ok,
  to_regclass('public.purchase_orders') is not null as purchase_orders_ok;

select
  count(*) filter (where column_name = 'is_internal') = 1 as supplier_internal_ok,
  count(*) filter (where column_name = 'province') = 1 as supplier_province_ok
from information_schema.columns
where table_schema = 'public'
  and table_name = 'suppliers'
  and column_name in ('is_internal', 'province');

select
  count(*) filter (where column_name = 'supplier_id') = 1 as po_supplier_ok,
  count(*) filter (where column_name = 'status') = 1 as po_status_ok,
  count(*) filter (where column_name = 'total') = 1 as po_total_ok
from information_schema.columns
where table_schema = 'public'
  and table_name = 'purchase_orders'
  and column_name in ('supplier_id', 'status', 'total');

select
  to_regprocedure(
    'public.get_supplier_list_workspace(integer,integer,text,text,text[],timestamp with time zone,timestamp with time zone,text,numeric,numeric,numeric,numeric)'
  ) is not null as supplier_workspace_rpc_ok;
