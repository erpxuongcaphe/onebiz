-- Read-only reporting. No document, inventory or price backfill (00461).
begin;

create or replace function public.report_nvl_consumption_by_branch(
  p_from_date date, p_to_date date, p_branch_id uuid default null
) returns table(branch_id uuid, branch_name text, material_id uuid, material_code text,
  material_name text, total_qty numeric, unit text, total_cost numeric, movement_count int)
language plpgsql stable security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  if p_from_date is null or p_to_date is null or p_from_date > p_to_date then
    raise exception using errcode='22007', message='REPORT_DATE_RANGE_INVALID';
  end if;
  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);
  select tenant_id into v_tenant from public.profiles where id=auth.uid() and coalesce(is_active,true);
  if v_tenant is null then raise exception using errcode='42501', message='ACTIVE_PROFILE_REQUIRED'; end if;
  return query
  with source as (
    select sm.branch_id, sm.product_id, sm.quantity,
      case when event.id is not null and event.direction='out'
        and abs(event.quantity-sm.quantity)<=0.0001 then event.total_cost
      when public._fnb_branch_cost_tracking_enabled_00390(sm.tenant_id,sm.branch_id) then null::numeric
      when sm.unit_cost is not null and sm.unit_cost>=0 then sm.quantity*sm.unit_cost
      else null::numeric end as amount
    from public.stock_movements sm
    left join public.fnb_branch_product_cost_events event
      on event.source_stock_movement_id=sm.id and event.tenant_id=sm.tenant_id
      and event.branch_id=sm.branch_id and event.product_id=sm.product_id
    where sm.tenant_id=v_tenant and sm.reference_type='bom_consume' and sm.type='out'
      and sm.created_at >= (p_from_date::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and sm.created_at < ((p_to_date+1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and (p_branch_id is null or sm.branch_id=p_branch_id)
  )
  select s.branch_id, br.name, s.product_id, p.code, p.name, sum(s.quantity),
    coalesce(p.stock_unit,p.unit,''),
    case when count(*) filter(where s.amount is null and abs(s.quantity)>0.0000001)>0
      then null::numeric else coalesce(sum(s.amount),0) end,
    count(*)::int
  from source s join public.products p on p.id=s.product_id and p.tenant_id=v_tenant
    join public.branches br on br.id=s.branch_id and br.tenant_id=v_tenant
  group by s.branch_id,br.name,s.product_id,p.code,p.name,p.stock_unit,p.unit
  order by p.code,br.name;
end $$;
revoke all on function public.report_nvl_consumption_by_branch(date,date,uuid) from public,anon;
grant execute on function public.report_nvl_consumption_by_branch(date,date,uuid) to authenticated;

create or replace function public.get_sku_financial_report(
  p_from timestamptz, p_to timestamptz, p_branch_id uuid default null,
  p_customer_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid;
begin
  if p_from is null or p_to is null or p_from>=p_to then
    raise exception using errcode='22007',message='REPORT_DATE_RANGE_INVALID';
  end if;
  perform public.assert_report_access('reports.analytics',p_branch_id);
  perform public.assert_report_access('reports.view_detail',p_branch_id);
  select tenant_id into v_tenant from public.profiles where id=auth.uid() and coalesce(is_active,true);
  if v_tenant is null then raise exception using errcode='42501',message='ACTIVE_PROFILE_REQUIRED'; end if;
  if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id and tenant_id=v_tenant) then
    raise exception using errcode='42501',message='REPORT_CUSTOMER_DENIED';
  end if;
  return (
    with sales as (
      select ii.product_id, coalesce(nullif(ii.unit,''),p.unit,'') as unit, i.customer_id,
        i.id as invoice_id, ii.quantity as sold_qty,
        case when invoice_lines.amount>0 and i.subtotal-coalesce(i.discount_amount,0) between 0 and invoice_lines.amount
          then ii.total*(i.subtotal-coalesce(i.discount_amount,0))/invoice_lines.amount
          else ii.total end as sales_amount,
        ii.quantity*ii.unit_cost as sales_cost,
        case when ii.unit_cost is null and ii.quantity<>0 then 1 else 0 end as missing,
        coalesce(i.issued_at,i.created_at) as document_at
      from public.invoices i join public.invoice_items ii on ii.invoice_id=i.id
      cross join lateral (select sum(line.total) amount from public.invoice_items line where line.invoice_id=i.id) invoice_lines
      join public.products p on p.id=ii.product_id and p.tenant_id=v_tenant
      where i.tenant_id=v_tenant and i.status='completed'
        and coalesce(i.issued_at,i.created_at)>=p_from and coalesce(i.issued_at,i.created_at)<p_to
        and (p_branch_id is null or i.branch_id=p_branch_id)
    ), refunds as (
      select ri.product_id, coalesce(nullif(ri.unit,''),p.unit,'') as unit, i.customer_id,
        ri.quantity as returned_qty, ri.total as return_amount,
        ri.quantity*source.unit_cost as return_cost,
        case when source.unit_cost is null and ri.quantity<>0 then 1 else 0 end as missing,
        sr.created_at as document_at
      from public.sales_returns sr join public.return_items ri on ri.return_id=sr.id
      join public.invoices i on i.id=sr.invoice_id and i.tenant_id=v_tenant
      join public.products p on p.id=ri.product_id and p.tenant_id=v_tenant
      left join lateral public.resolve_sales_return_source_line(ri.id) source on true
      where sr.tenant_id=v_tenant and sr.status in ('confirmed','completed')
        and sr.created_at>=p_from and sr.created_at<p_to
        and (p_branch_id is null or sr.branch_id=p_branch_id)
    ), activity as (
      select product_id,unit,customer_id,invoice_id,sold_qty,0::numeric returned_qty,
        sales_amount,0::numeric return_amount,sales_cost,0::numeric return_cost,missing,document_at from sales
      union all
      select product_id,unit,customer_id,null::uuid,0,returned_qty,0,return_amount,0,return_cost,missing,document_at from refunds
    ), grouped as (
      select a.product_id,p.code,p.name,coalesce(cat.name,'Chưa phân loại') category_name,a.unit,
        count(distinct a.invoice_id) order_count, count(distinct a.customer_id) customer_count,
        sum(a.sold_qty) sold_qty,sum(a.returned_qty) returned_qty,
        sum(a.sold_qty-a.returned_qty) net_qty,
        sum(a.sales_amount) sales_amount,sum(a.return_amount) return_amount,
        sum(a.sales_amount-a.return_amount) net_revenue,
        case when sum(a.missing)>0 then null::numeric else sum(coalesce(a.sales_cost,0)-coalesce(a.return_cost,0)) end cogs,
        sum(a.missing) missing_cost_lines,max(a.document_at) last_activity_at
      from activity a join public.products p on p.id=a.product_id and p.tenant_id=v_tenant
      left join public.categories cat on cat.id=p.category_id and cat.tenant_id=v_tenant
      where p_customer_id is null or a.customer_id=p_customer_id
      group by a.product_id,p.code,p.name,cat.name,a.unit
    )
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object(
      'gross_profit',g.net_revenue-g.cogs,
      'margin_percent',case when g.net_revenue>0 then (g.net_revenue-g.cogs)*100/g.net_revenue else null end,
      'average_sale_price',case when g.sold_qty<>0 then g.sales_amount/g.sold_qty else null end
    ) order by g.code,g.unit) from grouped g),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(to_jsonb(c) order by c.name,c.id) from (
      select distinct cu.id,cu.code,cu.name from activity a
      join public.customers cu on cu.id=a.customer_id and cu.tenant_id=v_tenant
    ) c),'[]'::jsonb))
  );
end $$;
revoke all on function public.get_sku_financial_report(timestamptz,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.get_sku_financial_report(timestamptz,timestamptz,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
