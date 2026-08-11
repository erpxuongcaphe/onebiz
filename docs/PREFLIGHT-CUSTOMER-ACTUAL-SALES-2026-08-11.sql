-- Read-only preflight for migration 00310.
-- This file does not update customer, invoice, return or debt data.

-- 1. Show whether cached customer counters differ from completed invoices.
with actual as (
  select
    i.tenant_id,
    i.customer_id,
    count(*)::bigint as actual_orders,
    coalesce(sum(i.total), 0)::numeric as actual_sales
  from public.invoices i
  where i.status = 'completed'
    and i.deleted_at is null
    and i.customer_id is not null
  group by i.tenant_id, i.customer_id
)
select
  c.tenant_id,
  count(*) filter (
    where coalesce(c.total_spent, 0) <> coalesce(a.actual_sales, 0)
  ) as customers_with_sales_mismatch,
  count(*) filter (
    where coalesce(c.total_orders, 0) <> coalesce(a.actual_orders, 0)
  ) as customers_with_order_mismatch,
  coalesce(sum(c.total_spent), 0) as cached_sales,
  coalesce(sum(a.actual_sales), 0) as actual_completed_sales
from public.customers c
left join actual a
  on a.tenant_id = c.tenant_id
 and a.customer_id = c.id
where not coalesce(c.is_internal, false)
group by c.tenant_id
order by c.tenant_id;

-- 2. Confirm the existing indexes that support the read-only aggregation.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('invoices', 'sales_returns')
order by tablename, indexname;
