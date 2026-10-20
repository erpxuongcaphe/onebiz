-- Read-only sales metrics. No business rows or role grants are changed.
begin;
create or replace function public.get_operational_sales_dashboard(
 p_branch_id uuid,p_from date,p_to date,p_grain text default 'hour'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; branch_kind text; start_at timestamptz; end_at timestamptz; bucket_count integer; result jsonb;
begin
 select tenant_id into tenant from public.profiles where id=actor and is_active;
 if tenant is null then raise exception 'DASHBOARD_ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 if p_branch_id is null then
  if not public.user_has_permission(actor,'reports.view_all_branches') or not public.user_has_permission(actor,'reports.dashboard') then
   raise exception 'DASHBOARD_ALL_BRANCHES_DENIED' using errcode='42501'; end if;
  if exists(select 1 from public.branches b where b.tenant_id=tenant and b.branch_type='store') and not public.user_has_permission(actor,'pos_fnb.view_sales_summary') then
   raise exception 'DASHBOARD_SALES_PERMISSION_DENIED' using errcode='42501'; end if;
 else
  select b.branch_type into branch_kind from public.branches b where b.id=p_branch_id and b.tenant_id=tenant;
  if branch_kind is null or not public.can_read_branch_document_00567(tenant,p_branch_id) then
   raise exception 'DASHBOARD_BRANCH_DENIED' using errcode='42501'; end if;
  if not public.user_has_permission(actor,case when branch_kind='store' then 'pos_fnb.view_sales_summary' else 'reports.dashboard' end) then
   raise exception 'DASHBOARD_SALES_PERMISSION_DENIED' using errcode='42501'; end if;
 end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>2192 or p_grain not in ('hour','day','month','year') or p_grain is null then
  raise exception 'DASHBOARD_RANGE_INVALID' using errcode='22023'; end if;
 start_at:=p_from::timestamp at time zone 'Asia/Ho_Chi_Minh'; end_at:=(p_to+1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
 select count(*) into bucket_count from generate_series(date_trunc(p_grain,p_from::timestamp),date_trunc(p_grain,p_to::timestamp+interval '23 hours'),('1 '||p_grain)::interval);
 if bucket_count>400 then raise exception 'DASHBOARD_TOO_MANY_BUCKETS' using errcode='22023'; end if;
 with scoped as (
  select i.* from public.invoices i where i.tenant_id=tenant and i.deleted_at is null
   and (p_branch_id is null or i.branch_id=p_branch_id)
   and (p_branch_id is not null or coalesce(i.source,'')<>'internal')
 ), modes as (
  select k.invoice_id,case when count(distinct k.order_type)=1 then min(k.order_type) else 'unknown' end mode
  from public.kitchen_orders k join scoped i on i.id=k.invoice_id and i.branch_id=k.branch_id
  where k.tenant_id=tenant and k.status<>'cancelled' group by k.invoice_id
 ), sales as (
  select i.id,i.ngay_chung_tu occurred,i.total amount,coalesce(i.discount_amount,0) discount,1 orders,
   case when i.source='fnb' then coalesce(m.mode,'unknown') when i.source='internal' then 'internal' else 'retail' end mode
  from scoped i left join modes m on m.invoice_id=i.id
  where i.status='completed' and i.ngay_chung_tu>=start_at and i.ngay_chung_tu<end_at
 ), returns as (
  select r.id,r.created_at occurred,-r.total amount,0 discount,0 orders,
   case when i.source='fnb' then coalesce(m.mode,'unknown') when i.source='internal' then 'internal' else 'retail' end mode
  from public.sales_returns r join scoped i on i.id=r.invoice_id and i.branch_id=r.branch_id
  left join modes m on m.invoice_id=i.id
  where r.tenant_id=tenant and r.status='completed' and i.status='completed' and r.created_at>=start_at and r.created_at<end_at
 ), events as (select * from sales union all select * from returns),
 money as (
  select c.type,c.amount,coalesce(c.payment_method,'unknown') method,case when c.type='receipt' then c.amount else -c.amount end signed
  from public.cash_transactions c
  join public.invoices i on i.id=case when c.reference_type='sales_return' then (select r.invoice_id from public.sales_returns r where r.id=c.reference_id and r.tenant_id=tenant and r.branch_id=c.branch_id) else c.reference_id end
   and i.tenant_id=tenant and i.branch_id=c.branch_id
  where c.tenant_id=tenant and (p_branch_id is null or c.branch_id=p_branch_id) and c.status='completed'
   and c.transaction_date>=p_from and c.transaction_date<=p_to
   and (p_branch_id is not null or coalesce(i.source,'')<>'internal')
   and ((c.type='receipt' and c.reference_type='invoice') or (c.type='payment' and c.reference_type in ('invoice','invoice_void','sales_return')))
 ), method_totals as (select method,sum(signed) amount from money group by method),
 buckets as (
  select b.key,coalesce(sum(e.amount),0) sales,coalesce(sum(e.orders),0) orders
  from generate_series(date_trunc(p_grain,p_from::timestamp),date_trunc(p_grain,p_to::timestamp+interval '23 hours'),('1 '||p_grain)::interval) b(key)
  left join events e on date_trunc(p_grain,e.occurred at time zone 'Asia/Ho_Chi_Minh')=b.key group by b.key
 ), mode_totals as (select mode,sum(amount) sales,sum(orders) orders from events group by mode)
 select jsonb_build_object(
  'sales',coalesce((select sum(amount) from events),0),'discounts',coalesce((select sum(discount) from sales),0),
  'returns',coalesce((select -sum(amount) from returns),0),'orders',coalesce((select sum(orders) from sales),0),
  'received',coalesce((select sum(amount) from money where type='receipt'),0),
  'refunded',coalesce((select sum(amount) from money where type='payment'),0),'collected',coalesce((select sum(signed) from money),0),
  'methods',coalesce((select jsonb_object_agg(method,amount) from method_totals),'{}'::jsonb),
  'buckets',coalesce((select jsonb_agg(jsonb_build_object('key',to_char(key,'YYYY-MM-DD"T"HH24:MI:SS'),'sales',sales,'orders',orders) order by key) from buckets),'[]'::jsonb),
  'modes',coalesce((select jsonb_agg(jsonb_build_object('mode',mode,'sales',sales,'orders',orders) order by mode) from mode_totals),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.get_operational_sales_dashboard(uuid,date,date,text) from public,anon;
grant execute on function public.get_operational_sales_dashboard(uuid,date,date,text) to authenticated;
comment on function public.get_operational_sales_dashboard(uuid,date,date,text) is 'Read-only branch-scoped net invoice value and sales collections; no cost/profit fields. Internal sales excluded only for all-company scope.';
commit;
