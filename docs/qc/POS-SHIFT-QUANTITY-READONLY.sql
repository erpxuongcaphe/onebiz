-- Read-only QC: verify fractional quantities stored by Retail POS.
-- This query does not insert, update or delete data.

with recent_lines as (
  select
    i.code as invoice_code,
    i.created_at,
    b.name as branch_name,
    coalesce(i.customer_name, 'Khách lẻ') as customer_name,
    ii.product_name,
    ii.unit,
    ii.quantity,
    ii.unit_price,
    ii.discount,
    ii.total,
    abs(
      ii.total
      - (ii.quantity * ii.unit_price - coalesce(ii.discount, 0))
    ) as line_total_difference
  from public.invoice_items ii
  join public.invoices i on i.id = ii.invoice_id
  left join public.branches b on b.id = i.branch_id
  where i.created_at >= now() - interval '30 days'
    and i.status = 'completed'
)
select
  count(*) filter (where quantity <> trunc(quantity)) as fractional_lines_30d,
  count(*) filter (where abs(quantity - 5.17) < 0.0001) as quantity_5_17_lines_30d,
  count(*) filter (where line_total_difference > 1) as mismatched_line_totals_30d,
  max(line_total_difference) as largest_line_total_difference
from recent_lines;

select
  i.code as invoice_code,
  i.created_at,
  b.name as branch_name,
  coalesce(i.customer_name, 'Khách lẻ') as customer_name,
  ii.product_name,
  ii.unit,
  ii.quantity,
  ii.unit_price,
  ii.total
from public.invoice_items ii
join public.invoices i on i.id = ii.invoice_id
left join public.branches b on b.id = i.branch_id
where i.created_at >= now() - interval '30 days'
  and i.status = 'completed'
  and ii.quantity <> trunc(ii.quantity)
order by i.created_at desc
limit 50;