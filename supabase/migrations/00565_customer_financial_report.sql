begin;

-- Same line-level revenue and immutable cost basis as get_sku_financial_report.
create or replace function public.get_customer_financial_report(
 p_from timestamptz, p_to timestamptz, p_branch_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid;
begin
 if p_from is null or p_to is null or p_from >= p_to then
  raise exception using errcode='22007', message='REPORT_DATE_RANGE_INVALID';
 end if;
 perform public.assert_report_access('reports.analytics',p_branch_id);
 perform public.assert_report_access('reports.view_detail',p_branch_id);
 select tenant_id into v_tenant from public.profiles
 where id=auth.uid() and coalesce(is_active,true);
 if v_tenant is null then
  raise exception using errcode='42501', message='ACTIVE_PROFILE_REQUIRED';
 end if;
 return (
  with sales as (
   select i.customer_id, i.id invoice_id, ii.product_id,
    case when invoice_lines.amount > 0
     and i.subtotal-coalesce(i.discount_amount,0) between 0 and invoice_lines.amount
    then ii.total*(i.subtotal-coalesce(i.discount_amount,0))/invoice_lines.amount
    else ii.total end sales_amount,
    ii.quantity*ii.unit_cost sales_cost,
    case when ii.unit_cost is null and ii.quantity<>0 then 1 else 0 end missing,
    coalesce(i.issued_at,i.created_at) document_at
   from public.invoices i
   join public.invoice_items ii on ii.invoice_id=i.id
   join public.products p on p.id=ii.product_id and p.tenant_id=v_tenant
   cross join lateral (select sum(line.total) amount from public.invoice_items line where line.invoice_id=i.id) invoice_lines
   where i.tenant_id=v_tenant and i.status='completed'
    and coalesce(i.issued_at,i.created_at)>=p_from and coalesce(i.issued_at,i.created_at)<p_to
    and (p_branch_id is null or i.branch_id=p_branch_id)
  ), refunds as (
   select i.customer_id, sr.id return_id, ri.product_id, ri.total return_amount,
    ri.quantity*source.unit_cost return_cost,
    case when source.unit_cost is null and ri.quantity<>0 then 1 else 0 end missing,
    sr.created_at document_at
   from public.sales_returns sr
   join public.return_items ri on ri.return_id=sr.id
   join public.invoices i on i.id=sr.invoice_id and i.tenant_id=v_tenant
   join public.products p on p.id=ri.product_id and p.tenant_id=v_tenant
   left join lateral public.resolve_sales_return_source_line(ri.id) source on true
   where sr.tenant_id=v_tenant and sr.status in ('confirmed','completed')
    and sr.created_at>=p_from and sr.created_at<p_to
    and (p_branch_id is null or sr.branch_id=p_branch_id)
  ), activity as (
   select customer_id,invoice_id,null::uuid return_id,product_id,sales_amount,
    0::numeric return_amount,sales_cost,0::numeric return_cost,missing,document_at from sales
   union all
   select customer_id,null::uuid,return_id,product_id,0,return_amount,0,return_cost,missing,document_at from refunds
  ), grouped as (
   select a.customer_id,coalesce(c.code,'') code,
    coalesce(c.name,case when a.customer_id is null then 'Chưa gắn khách hàng' else 'Khách hàng không còn trong danh mục' end) name,
    count(distinct a.invoice_id) order_count,count(distinct a.return_id) return_count,
    count(distinct a.product_id) product_count,
    sum(a.sales_amount) sales_amount,sum(a.return_amount) return_amount,
    sum(a.sales_amount-a.return_amount) net_revenue,
    case when sum(a.missing)>0 then null::numeric
     else sum(coalesce(a.sales_cost,0)-coalesce(a.return_cost,0)) end cogs,
    sum(a.missing) missing_cost_lines,max(a.document_at) last_activity_at
   from activity a
   left join public.customers c on c.id=a.customer_id and c.tenant_id=v_tenant
   group by a.customer_id,c.code,c.name
  )
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object(
   'gross_profit',g.net_revenue-g.cogs,
   'margin_percent',case when g.net_revenue>0 then (g.net_revenue-g.cogs)*100/g.net_revenue else null end,
   'average_order_value',case when g.order_count>0 then g.sales_amount/g.order_count else null end
  ) order by g.code,g.customer_id nulls last) from grouped g),'[]'::jsonb))
 );
end $$;
revoke all on function public.get_customer_financial_report(timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.get_customer_financial_report(timestamptz,timestamptz,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
