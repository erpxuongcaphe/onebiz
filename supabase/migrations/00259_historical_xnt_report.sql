-- ============================================================
-- 00259: Accurate historical stock in/out/on-hand report
-- ============================================================
-- Read-only function. It reconstructs stock at the report end date by
-- reversing movements posted after that date from the current stock balance.

create or replace function public.get_xnt_report(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_branch_id uuid default null,
  p_search text default null
) returns table (
  product_id uuid,
  code text,
  name text,
  unit text,
  category_name text,
  cost_price numeric,
  opening_qty numeric,
  in_supplier numeric,
  in_check numeric,
  in_return numeric,
  in_transfer numeric,
  in_production numeric,
  in_other numeric,
  out_sale numeric,
  out_disposal numeric,
  out_supplier_return numeric,
  out_check numeric,
  out_transfer numeric,
  out_production numeric,
  out_internal numeric,
  out_other numeric,
  closing_qty numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
    raise exception using
      errcode = '22007',
      message = 'REPORT_DATE_RANGE_INVALID';
  end if;

  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = auth.uid()
     and coalesce(p.is_active, true);

  if v_tenant_id is null then
    raise exception using
      errcode = '42501',
      message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  return query
  with scoped_products as (
    select
      p.id,
      p.code,
      p.name,
      coalesce(p.unit, '') as unit,
      coalesce(c.name, '') as category_name,
      coalesce(p.cost_price, 0) as cost_price,
      case
        when p_branch_id is null
          then coalesce(company_bs.quantity, p.stock, 0)
        else coalesce(bs.quantity, 0)
      end::numeric as current_qty
    from public.products p
    left join public.categories c
      on c.id = p.category_id
     and c.tenant_id = v_tenant_id
    left join (
      select branch_stock.product_id, sum(branch_stock.quantity)::numeric as quantity
      from public.branch_stock
      where branch_stock.tenant_id = v_tenant_id
        and branch_stock.variant_id is null
      group by branch_stock.product_id
    ) company_bs
      on p_branch_id is null
     and company_bs.product_id = p.id
    left join public.branch_stock bs
      on p_branch_id is not null
     and bs.tenant_id = v_tenant_id
     and bs.branch_id = p_branch_id
     and bs.product_id = p.id
     and bs.variant_id is null
    where p.tenant_id = v_tenant_id
      and coalesce(p.inventory_role, '') <> 'fnb_menu_item'
      and (
        v_search is null
        or p.code ilike '%' || v_search || '%'
        or p.name ilike '%' || v_search || '%'
      )
  ),
  period_movements as (
    select
      sm.product_id,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'in'
          and lower(coalesce(sm.reference_type, '')) in (
            'purchase_entry', 'purchase_order', 'goods_receipt'
          )
      ), 0)::numeric as in_supplier,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'in'
          and lower(coalesce(sm.reference_type, '')) in (
            'inventory_check', 'stock_adjustment', 'adjustment'
          )
      ), 0)::numeric as in_check,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'in'
          and lower(coalesce(sm.reference_type, '')) in (
            'sales_return', 'invoice_void', 'return_bom_restore'
          )
      ), 0)::numeric as in_return,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'in'
          and lower(coalesce(sm.reference_type, '')) in (
            'transfer', 'stock_transfer'
          )
      ), 0)::numeric as in_transfer,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'in'
          and lower(coalesce(sm.reference_type, '')) in (
            'production_order', 'production_complete',
            'production_reconcile', 'production_consume'
          )
      ), 0)::numeric as in_production,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'in'
          and lower(coalesce(sm.reference_type, '')) not in (
            'purchase_entry', 'purchase_order', 'goods_receipt',
            'inventory_check', 'stock_adjustment', 'adjustment',
            'sales_return', 'invoice_void', 'return_bom_restore',
            'transfer', 'stock_transfer',
            'production_order', 'production_complete',
            'production_reconcile', 'production_consume'
          )
      ), 0)::numeric as in_other,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'out'
          and lower(coalesce(sm.reference_type, '')) in (
            'invoice', 'sale', 'pos_sale', 'bom_consume', 'modifier_topping'
          )
      ), 0)::numeric as out_sale,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'out'
          and lower(coalesce(sm.reference_type, '')) in (
            'disposal', 'disposal_export'
          )
      ), 0)::numeric as out_disposal,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'out'
          and lower(coalesce(sm.reference_type, '')) in (
            'supplier_return', 'purchase_return', 'purchase_order_revert'
          )
      ), 0)::numeric as out_supplier_return,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'out'
          and lower(coalesce(sm.reference_type, '')) in (
            'inventory_check', 'stock_adjustment', 'adjustment'
          )
      ), 0)::numeric as out_check,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'out'
          and lower(coalesce(sm.reference_type, '')) in (
            'transfer', 'stock_transfer'
          )
      ), 0)::numeric as out_transfer,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'out'
          and lower(coalesce(sm.reference_type, '')) in (
            'production_order', 'production_complete',
            'production_reconcile', 'production_consume'
          )
      ), 0)::numeric as out_production,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'out'
          and lower(coalesce(sm.reference_type, '')) in (
            'internal_export', 'internal_sale', 'input_invoice'
          )
      ), 0)::numeric as out_internal,
      coalesce(sum(sm.quantity) filter (
        where sm.type = 'out'
          and lower(coalesce(sm.reference_type, '')) not in (
            'invoice', 'sale', 'pos_sale', 'bom_consume', 'modifier_topping',
            'disposal', 'disposal_export',
            'supplier_return', 'purchase_return', 'purchase_order_revert',
            'inventory_check', 'stock_adjustment', 'adjustment',
            'transfer', 'stock_transfer',
            'production_order', 'production_complete',
            'production_reconcile', 'production_consume',
            'internal_export', 'internal_sale', 'input_invoice'
          )
      ), 0)::numeric as out_other
    from public.stock_movements sm
    join scoped_products p on p.id = sm.product_id
    where sm.tenant_id = v_tenant_id
      and sm.created_at >= p_date_from
      and sm.created_at < p_date_to
      and (p_branch_id is null or sm.branch_id = p_branch_id)
    group by sm.product_id
  ),
  movements_after_period as (
    select
      sm.product_id,
      coalesce(sum(case
        when sm.type = 'in' then sm.quantity
        when sm.type = 'out' then -sm.quantity
        else 0
      end), 0)::numeric as net_after
    from public.stock_movements sm
    join scoped_products p on p.id = sm.product_id
    where sm.tenant_id = v_tenant_id
      and sm.created_at >= p_date_to
      and sm.created_at < now()
      and (p_branch_id is null or sm.branch_id = p_branch_id)
    group by sm.product_id
  ),
  calculated as (
    select
      p.*,
      coalesce(pm.in_supplier, 0) as in_supplier,
      coalesce(pm.in_check, 0) as in_check,
      coalesce(pm.in_return, 0) as in_return,
      coalesce(pm.in_transfer, 0) as in_transfer,
      coalesce(pm.in_production, 0) as in_production,
      coalesce(pm.in_other, 0) as in_other,
      coalesce(pm.out_sale, 0) as out_sale,
      coalesce(pm.out_disposal, 0) as out_disposal,
      coalesce(pm.out_supplier_return, 0) as out_supplier_return,
      coalesce(pm.out_check, 0) as out_check,
      coalesce(pm.out_transfer, 0) as out_transfer,
      coalesce(pm.out_production, 0) as out_production,
      coalesce(pm.out_internal, 0) as out_internal,
      coalesce(pm.out_other, 0) as out_other,
      p.current_qty - coalesce(ap.net_after, 0) as closing_at_period
    from scoped_products p
    left join period_movements pm on pm.product_id = p.id
    left join movements_after_period ap on ap.product_id = p.id
  )
  select
    c.id,
    c.code,
    c.name,
    c.unit,
    nullif(c.category_name, ''),
    c.cost_price,
    c.closing_at_period
      - (
        c.in_supplier + c.in_check + c.in_return + c.in_transfer
        + c.in_production + c.in_other
      )
      + (
        c.out_sale + c.out_disposal + c.out_supplier_return + c.out_check
        + c.out_transfer + c.out_production + c.out_internal + c.out_other
      ) as opening_qty,
    c.in_supplier,
    c.in_check,
    c.in_return,
    c.in_transfer,
    c.in_production,
    c.in_other,
    c.out_sale,
    c.out_disposal,
    c.out_supplier_return,
    c.out_check,
    c.out_transfer,
    c.out_production,
    c.out_internal,
    c.out_other,
    c.closing_at_period
  from calculated c
  order by c.name, c.code, c.id;
end;
$$;

revoke all on function public.get_xnt_report(
  timestamptz, timestamptz, uuid, text
) from public, anon;

grant execute on function public.get_xnt_report(
  timestamptz, timestamptz, uuid, text
) to authenticated;

comment on function public.get_xnt_report(
  timestamptz, timestamptz, uuid, text
) is
  'Read-only XNT report with historical closing stock reconstructed from immutable stock movements.';
