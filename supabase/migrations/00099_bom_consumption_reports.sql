-- ============================================================
-- 00099: Báo cáo Tiêu hao NVL + COGS thực theo BOM (CEO 18/05/2026)
--
-- Phase 2 của Sprint BOM-CONSUME. 2 RPC:
--   - report_nvl_consumption_by_branch: tiêu hao NVL group by branch × material
--   - report_cogs_by_bom: COGS thực tính từ BOM × cost_price NVL (thay
--     COGS đang dùng products.cost_price trên SKU bán)
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. Tiêu hao NVL theo chi nhánh trong khoảng thời gian
-- Dùng stock_movements với reference_type='bom_consume' (do migration 00097 ghi).
-- ────────────────────────────────────────────────────────────────
create or replace function public.report_nvl_consumption_by_branch(
  p_from_date date,
  p_to_date date,
  p_branch_id uuid default null
) returns table (
  branch_id uuid,
  branch_name text,
  material_id uuid,
  material_code text,
  material_name text,
  total_qty numeric,
  unit text,
  total_cost numeric,
  movement_count int
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := public._current_caller_tenant();

  return query
  select
    sm.branch_id,
    br.name as branch_name,
    sm.product_id as material_id,
    p.code as material_code,
    p.name as material_name,
    sum(sm.quantity)::numeric as total_qty,
    coalesce(p.stock_unit, p.unit, '') as unit,
    round((sum(sm.quantity) * coalesce(p.cost_price, 0))::numeric, 0) as total_cost,
    count(*)::int as movement_count
  from public.stock_movements sm
    join public.branches br on br.id = sm.branch_id
    join public.products p on p.id = sm.product_id
  where sm.tenant_id = v_tenant_id
    and sm.reference_type = 'bom_consume'
    and sm.type = 'out'
    and sm.created_at::date >= p_from_date
    and sm.created_at::date <= p_to_date
    and (p_branch_id is null or sm.branch_id = p_branch_id)
  group by sm.branch_id, br.name, sm.product_id, p.code, p.name, p.stock_unit, p.unit, p.cost_price
  order by br.name, total_cost desc;
end;
$$;

grant execute on function public.report_nvl_consumption_by_branch(date, date, uuid) to authenticated;

comment on function public.report_nvl_consumption_by_branch is
  'Báo cáo tiêu hao NVL theo chi nhánh × material trong khoảng date. CEO 18/05/2026.';

-- ────────────────────────────────────────────────────────────────
-- 2. COGS thực theo BOM
-- Tính cost thực của 1 invoice_item của SKU có BOM:
--   cogs = SUM(bom_items.qty × (1+waste%) × material.cost_price) × qty bán
-- So sánh với cost_price snapshot ở invoice_items để thấy chênh lệch.
-- ────────────────────────────────────────────────────────────────
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
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := public._current_caller_tenant();

  return query
  with bom_costs as (
    -- Cost của BOM = sum(qty × waste × material.cost_price)
    select
      b.id as bom_id,
      b.product_id,
      b.branch_id as bom_branch_id,
      sum(bi.quantity * (1 + coalesce(bi.waste_percent, 0)/100) * coalesce(mp.cost_price, 0)) as unit_cost
    from public.bom b
      join public.bom_items bi on bi.bom_id = b.id
      left join public.products mp on mp.id = bi.material_id
    where b.tenant_id = v_tenant_id and b.is_active = true
    group by b.id, b.product_id, b.branch_id
  )
  select
    inv.id as invoice_id,
    inv.code as invoice_code,
    inv.created_at as invoice_date,
    inv.branch_id,
    br.name as branch_name,
    ii.product_id,
    p.code as product_code,
    p.name as product_name,
    ii.quantity as qty_sold,
    ii.total as revenue,
    -- COGS thực: ưu tiên BOM riêng branch, fallback BOM global
    round((coalesce(
      (select unit_cost from bom_costs
        where product_id = ii.product_id and bom_branch_id = inv.branch_id limit 1),
      (select unit_cost from bom_costs
        where product_id = ii.product_id and bom_branch_id is null limit 1),
      0
    ) * ii.quantity)::numeric, 0) as cogs_real,
    -- margin = revenue - cogs_real
    (ii.total - round((coalesce(
      (select unit_cost from bom_costs
        where product_id = ii.product_id and bom_branch_id = inv.branch_id limit 1),
      (select unit_cost from bom_costs
        where product_id = ii.product_id and bom_branch_id is null limit 1),
      0
    ) * ii.quantity)::numeric, 0))::numeric as margin
  from public.invoice_items ii
    join public.invoices inv on inv.id = ii.invoice_id
    join public.branches br on br.id = inv.branch_id
    join public.products p on p.id = ii.product_id
  where inv.tenant_id = v_tenant_id
    and inv.status = 'completed'
    and p.has_bom = true
    and inv.created_at::date >= p_from_date
    and inv.created_at::date <= p_to_date
    and (p_branch_id is null or inv.branch_id = p_branch_id)
  order by inv.created_at desc;
end;
$$;

grant execute on function public.report_cogs_by_bom(date, date, uuid) to authenticated;

comment on function public.report_cogs_by_bom is
  'COGS thực theo BOM cho từng invoice_item của SKU has_bom=true. CEO 18/05/2026.';

notify pgrst, 'reload schema';
