-- Report-only replacement. Historical margin must not change when a BOM or
-- a material's current price changes. No document, price or stock data writes.
create or replace function public.report_cogs_by_bom(
  p_from_date date,
  p_to_date date,
  p_branch_id uuid default null
) returns table (
  invoice_id uuid,
  invoice_code text,
  invoice_date timestamptz,
  branch_id uuid,
  branch_name text,
  product_id uuid,
  product_code text,
  product_name text,
  qty_sold numeric,
  revenue numeric,
  cogs_real numeric,
  margin numeric
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    inv.id,
    inv.code,
    inv.created_at,
    inv.branch_id,
    br.name,
    ii.product_id,
    p.code,
    ii.product_name,
    ii.quantity,
    ii.total,
    case when ii.unit_cost > 0
      then round(ii.unit_cost * ii.quantity, 2)
      else null end,
    case when ii.unit_cost > 0
      then ii.total - round(ii.unit_cost * ii.quantity, 2)
      else null end
  from public.invoice_items ii
  join public.invoices inv on inv.id = ii.invoice_id
  join public.branches br on br.id = inv.branch_id
  join public.products p on p.id = ii.product_id
  where inv.tenant_id = public._current_caller_tenant()
    and inv.status = 'completed'
    and p.has_bom = true
    and inv.created_at::date between p_from_date and p_to_date
    and (p_branch_id is null or inv.branch_id = p_branch_id)
  order by inv.created_at desc, ii.id;
$$;

comment on function public.report_cogs_by_bom(date, date, uuid) is
  'Historical gross-sale BOM item cost from invoice_items.unit_cost; unknown cost remains NULL. Returns are reported separately.';

notify pgrst, 'reload schema';
