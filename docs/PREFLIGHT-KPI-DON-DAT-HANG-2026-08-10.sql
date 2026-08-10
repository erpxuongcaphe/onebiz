-- Read-only preflight for migration 00306.
-- This file contains SELECT statements only. It does not change business data,
-- schema, policies, grants, functions, or indexes.

-- 1. Required server-side authorization helpers.
select
  to_regprocedure('public.get_user_tenant_id()') is not null
    as tenant_helper_ok,
  to_regprocedure('public.user_has_permission(uuid,text)') is not null
    as permission_helper_ok,
  to_regprocedure('public.user_has_branch_access(uuid,uuid)') is not null
    as branch_access_helper_ok,
  to_regprocedure('public.get_user_accessible_branches(uuid)') is not null
    as accessible_branches_helper_ok;

-- 2. Required columns. All values must be true before running 00306.
with required_columns(table_name, column_name) as (
  values
    ('invoices', 'tenant_id'),
    ('invoices', 'source'),
    ('invoices', 'deleted_at'),
    ('invoices', 'branch_id'),
    ('invoices', 'created_at'),
    ('invoices', 'customer_id'),
    ('invoices', 'order_code'),
    ('invoices', 'code'),
    ('invoices', 'customer_name'),
    ('invoices', 'status'),
    ('invoices', 'total'),
    ('invoices', 'delivery_fee'),
    ('invoices', 'debt'),
    ('invoices', 'fulfilled_by_id'),
    ('shipping_orders', 'tenant_id'),
    ('shipping_orders', 'invoice_id'),
    ('shipping_orders', 'partner_id'),
    ('shipping_orders', 'created_at'),
    ('shipping_orders', 'receiver_address'),
    ('customers', 'id'),
    ('customers', 'tenant_id'),
    ('customers', 'phone')
)
select
  r.table_name,
  r.column_name,
  exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = r.table_name
      and c.column_name = r.column_name
  ) as column_ok
from required_columns r
order by r.table_name, r.column_name;

-- 3. Current production footprint. Read-only and tenant-separated.
select
  i.tenant_id,
  count(*) filter (where i.deleted_at is null) as live_orders,
  count(*) filter (where i.deleted_at is null and i.status = 'cancelled') as cancelled_orders,
  count(*) filter (where i.deleted_at is null and i.fulfilled_by_id is not null) as fulfilled_orders,
  count(*) filter (
    where i.deleted_at is null
      and exists (
        select 1
        from public.shipping_orders so
        where so.tenant_id = i.tenant_id
          and so.invoice_id = i.id
      )
  ) as orders_with_shipping
from public.invoices i
where i.source = 'order'
group by i.tenant_id
order by live_orders desc;

-- 4. Index inventory for the two read paths. This does not create indexes.
select
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('invoices', 'shipping_orders')
order by tablename, indexname;

-- 5. Confirm the previous read-only invoice KPI RPC remains installed.
select
  to_regprocedure(
    'public.get_invoice_list_summary(uuid,timestamp with time zone,timestamp with time zone,text[],text,text,text)'
  ) is not null as invoice_summary_rpc_ok;
