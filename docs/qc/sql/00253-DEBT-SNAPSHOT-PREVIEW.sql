-- Read-only preview for the one-time debt carry-forward in migration 00253.
-- This query does not insert, update, or delete any row.

with invoice_debt as (
  select
    i.tenant_id,
    i.customer_id,
    coalesce(sum(greatest(0, i.debt)), 0) as amount
  from public.invoices i
  where i.status = 'completed'
    and i.deleted_at is null
    and i.customer_id is not null
  group by i.tenant_id, i.customer_id
),
differences as (
  select
    c.tenant_id,
    c.id as customer_id,
    c.code as customer_code,
    c.name as customer_name,
    round(coalesce(c.debt, 0) - coalesce(i.amount, 0), 2) as carry_forward
  from public.customers c
  left join invoice_debt i
    on i.tenant_id = c.tenant_id
   and i.customer_id = c.id
  where abs(coalesce(c.debt, 0) - coalesce(i.amount, 0)) > 0.01
)
select
  count(*) as customers_to_snapshot,
  coalesce(sum(carry_forward) filter (where carry_forward > 0), 0) as positive_total,
  coalesce(sum(carry_forward) filter (where carry_forward < 0), 0) as negative_total,
  coalesce(sum(carry_forward), 0) as net_total,
  coalesce(max(abs(carry_forward)), 0) as largest_absolute_difference
from differences;

-- Optional detail. Run separately if the summary above is unexpected.
-- with invoice_debt as (
--   select tenant_id, customer_id,
--          coalesce(sum(greatest(0, debt)), 0) as amount
--   from public.invoices
--   where status = 'completed' and deleted_at is null and customer_id is not null
--   group by tenant_id, customer_id
-- )
-- select c.code, c.name, c.debt as displayed_debt,
--        coalesce(i.amount, 0) as invoice_debt,
--        round(coalesce(c.debt, 0) - coalesce(i.amount, 0), 2) as carry_forward
-- from public.customers c
-- left join invoice_debt i
--   on i.tenant_id = c.tenant_id and i.customer_id = c.id
-- where abs(coalesce(c.debt, 0) - coalesce(i.amount, 0)) > 0.01
-- order by abs(coalesce(c.debt, 0) - coalesce(i.amount, 0)) desc;
