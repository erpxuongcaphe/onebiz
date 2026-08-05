-- Read-only trace for a decimal quantity reported after POS checkout.
-- Change only the invoice code in params. This query never writes data.

with params as (
  select 'HD001503'::text as invoice_code
)
select
  i.id as invoice_id,
  i.code as invoice_code,
  i.created_at,
  i.customer_name,
  p.full_name as created_by,
  ii.product_name,
  ii.unit,
  ii.quantity,
  ii.unit_price,
  ii.total,
  round(ii.quantity * ii.unit_price - coalesce(ii.discount, 0), 2)
    as recalculated_total,
  ii.total = round(
    ii.quantity * ii.unit_price - coalesce(ii.discount, 0),
    2
  ) as line_total_ok
from params x
join public.invoices i on i.code = x.invoice_code
left join public.profiles p on p.id = i.created_by
join public.invoice_items ii on ii.invoice_id = i.id
order by ii.product_name;

with params as (
  select 'HD001503'::text as invoice_code
), source_invoice as (
  select i.id, i.code
  from public.invoices i
  join params x on x.invoice_code = i.code
), duplicate_events as (
  select
    al.created_at as duplicated_at,
    nullif(al.new_data->>'source_invoice_id', '')::uuid as source_invoice_id,
    al.entity_id as target_invoice_id,
    al.new_data->>'source_invoice_code' as source_invoice_code,
    al.new_data->>'target_order_code' as target_invoice_code
  from public.audit_log al
  join source_invoice s
    on nullif(al.new_data->>'source_invoice_id', '')::uuid = s.id
  where al.action = 'invoice_duplicated_to_order'
)
select
  d.duplicated_at,
  d.source_invoice_code,
  d.target_invoice_code,
  source_item.product_name,
  source_item.unit,
  source_item.quantity as source_quantity,
  target_item.quantity as copied_quantity,
  source_item.quantity = target_item.quantity as copied_exactly
from duplicate_events d
join public.invoice_items source_item
  on source_item.invoice_id = d.source_invoice_id
left join public.invoice_items target_item
  on target_item.invoice_id = d.target_invoice_id
 and target_item.product_id = source_item.product_id
 and target_item.variant_id is not distinct from source_item.variant_id
order by d.duplicated_at desc, source_item.product_name;

-- Result interpretation:
