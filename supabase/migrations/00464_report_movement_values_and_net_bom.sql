-- Read-only reports. No business records, valuation balances or posting functions change.
begin;
set local lock_timeout = '2s';

create or replace function public._report_movement_values_00464(
  p_from timestamptz, p_to timestamptz, p_branch uuid, p_tenant uuid
) returns table(product_id uuid,branch_id uuid,movement_type text,reference_type text,
  quantity numeric,amount numeric,is_bom_restore boolean)
language sql stable set search_path='' as $$
  select sm.product_id,sm.branch_id,sm.type,lower(coalesce(sm.reference_type,'')),sm.quantity,
    case
      when e.id is not null and e.direction=sm.type
        and abs(e.quantity-sm.quantity)<0.0000001 then e.total_cost
      when public._fnb_branch_cost_tracking_enabled_00390(sm.tenant_id,sm.branch_id) then null
      when sm.unit_cost>=0 then sm.quantity*sm.unit_cost
      when sm.type='in' and sm.unit_price>=0 then sm.quantity*sm.unit_price
      else null end,
    sm.type='in' and (sm.reference_type='return_bom_restore' or
      (sm.reference_type='invoice_void' and exists(
        select 1 from public.stock_movements original
        where original.tenant_id=sm.tenant_id and original.branch_id=sm.branch_id
          and original.product_id=sm.product_id and original.reference_id=sm.reference_id
          and original.type='out' and original.reference_type='bom_consume'
      )))
  from public.stock_movements sm
  left join public.fnb_branch_product_cost_events e
    on e.source_stock_movement_id=sm.id and e.tenant_id=sm.tenant_id
    and e.branch_id=sm.branch_id and e.product_id=sm.product_id
  where sm.tenant_id=p_tenant and sm.created_at>=p_from and sm.created_at<p_to
    and sm.type in ('in','out') and (p_branch is null or sm.branch_id=p_branch)
$$;
revoke all on function public._report_movement_values_00464(timestamptz,timestamptz,uuid,uuid) from public,anon,authenticated;

create or replace function public.get_xnt_movement_values(
  p_date_from timestamptz,p_date_to timestamptz,p_branch_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid;
begin
  if p_date_from is null or p_date_to is null or p_date_to<=p_date_from then
    raise exception using errcode='22023',message='REPORT_DATE_RANGE_INVALID';
  end if;
  perform public.assert_report_access('reports.analytics',p_branch_id);
  perform public.assert_report_access('reports.view_detail',p_branch_id);
  select tenant_id into v_tenant from public.profiles where id=auth.uid() and is_active;
  if v_tenant is null then raise exception using errcode='42501',message='REPORT_TENANT_DENIED'; end if;
  return (with classified as (
    select m.*,
      case when m.movement_type='in' then case
        when m.reference_type in ('purchase_entry','purchase_order','goods_receipt') then 'inSupplier'
        when m.reference_type in ('inventory_check','stock_adjustment','adjustment') then 'inCheck'
        when m.reference_type in ('sales_return','invoice_void','return_bom_restore') then 'inReturn'
        when m.reference_type in ('transfer','stock_transfer') then 'inTransfer'
        when m.reference_type in ('production_order','production_complete','production_reconcile','production_consume') then 'inProduction'
        else 'inOther' end
      else case
        when m.reference_type in ('invoice','sale','pos_sale','bom_consume','modifier_topping') then 'outSale'
        when m.reference_type in ('disposal','disposal_export') then 'outDisposal'
        when m.reference_type in ('supplier_return','purchase_return','purchase_order_revert') then 'outSupplierReturn'
        when m.reference_type in ('inventory_check','stock_adjustment','adjustment') then 'outCheck'
        when m.reference_type in ('transfer','stock_transfer') then 'outTransfer'
        when m.reference_type in ('production_order','production_complete','production_reconcile','production_consume') then 'outProduction'
        when m.reference_type in ('internal_export','internal_sale','input_invoice') then 'outInternal'
        else 'outOther' end end as bucket
    from public._report_movement_values_00464(p_date_from,p_date_to,p_branch_id,v_tenant) m
    join public.products p on p.id=m.product_id and p.tenant_id=v_tenant
    where coalesce(p.inventory_role,'')<>'fnb_menu_item'
  ), grouped as (
    select product_id,bucket,sum(quantity) quantity,
      case when count(*) filter(where amount is null and quantity<>0)>0 then null else coalesce(sum(amount),0) end amount,
      count(*) filter(where amount is null and quantity<>0) missing_cost_count
    from classified group by product_id,bucket
  ) select coalesce(jsonb_agg(to_jsonb(g) order by product_id,bucket),'[]'::jsonb) from grouped g);
end $$;
revoke all on function public.get_xnt_movement_values(timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.get_xnt_movement_values(timestamptz,timestamptz,uuid) to authenticated;

create or replace function public.report_nvl_consumption_net(
  p_from_date date,p_to_date date,p_branch_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid;
begin
  if p_from_date is null or p_to_date is null or p_to_date<p_from_date then
    raise exception using errcode='22023',message='REPORT_DATE_RANGE_INVALID';
  end if;
  perform public.assert_report_access('reports.analytics',p_branch_id);
  perform public.assert_report_access('reports.view_detail',p_branch_id);
  select tenant_id into v_tenant from public.profiles where id=auth.uid() and is_active;
  if v_tenant is null then raise exception using errcode='42501',message='REPORT_TENANT_DENIED'; end if;
  return (with movements as (
    select m.*,m.movement_type='out' as is_issue
    from public._report_movement_values_00464(
      p_from_date::timestamp at time zone 'Asia/Ho_Chi_Minh',
      (p_to_date+1)::timestamp at time zone 'Asia/Ho_Chi_Minh',p_branch_id,v_tenant) m
    where (m.movement_type='out' and m.reference_type='bom_consume') or m.is_bom_restore
  ), grouped as (
    select m.branch_id,b.name branch_name,m.product_id material_id,p.code material_code,p.name material_name,
      coalesce(nullif(p.stock_unit,''),p.unit,'') unit,
      coalesce(sum(m.quantity) filter(where is_issue),0) issue_qty,
      coalesce(sum(m.quantity) filter(where not is_issue),0) restore_qty,
      case when count(*) filter(where is_issue and amount is null and quantity<>0)>0 then null
        else coalesce(sum(amount) filter(where is_issue),0) end issue_cost,
      case when count(*) filter(where not is_issue and amount is null and quantity<>0)>0 then null
        else coalesce(sum(amount) filter(where not is_issue),0) end restore_cost,
      count(*) movement_count
    from movements m join public.products p on p.id=m.product_id and p.tenant_id=v_tenant
    join public.branches b on b.id=m.branch_id and b.tenant_id=v_tenant
    group by m.branch_id,b.name,m.product_id,p.code,p.name,p.stock_unit,p.unit
  ) select coalesce(jsonb_agg(to_jsonb(g)||jsonb_build_object(
    'total_qty',issue_qty-restore_qty,'total_cost',issue_cost-restore_cost)
    order by material_code,branch_name),'[]'::jsonb) from grouped g);
end $$;
revoke all on function public.report_nvl_consumption_net(date,date,uuid) from public,anon;
grant execute on function public.report_nvl_consumption_net(date,date,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
