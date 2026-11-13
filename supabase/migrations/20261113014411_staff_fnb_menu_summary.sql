-- Report totals without disclosing the underlying bills or order lines.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_fnb_report_branches(p_branch_id uuid)
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();tenant uuid:=public.get_user_tenant_id();result uuid[];
begin
 if actor is null or tenant is null or not exists(
  select 1 from public.profiles p where p.id=actor and p.tenant_id=tenant and coalesce(p.is_active,false)
 ) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if not (public._staff_permission_any_branch(actor,'reports.fnb') or public._staff_permission_any_branch(actor,'reports.analytics')) then
  raise exception 'FNB_REPORT_PERMISSION_REQUIRED' using errcode='42501'; end if;
 if p_branch_id is not null and not coalesce(public.can_read_branch_document_00567(tenant,p_branch_id),false) then
  raise exception 'BRANCH_ACCESS_DENIED' using errcode='42501'; end if;
 if p_branch_id is not null and not (
  public._staff_permission_at_scope(actor,'reports.fnb',p_branch_id)
  or public._staff_permission_at_scope(actor,'reports.analytics',p_branch_id)
 ) then raise exception 'FNB_REPORT_PERMISSION_REQUIRED' using errcode='42501'; end if;
 select coalesce(array_agg(b.id),'{}'::uuid[]) into result from public.branches b where b.tenant_id=tenant
  and (p_branch_id is null or b.id=p_branch_id)
  and public.can_read_branch_document_00567(tenant,b.id)
  and (public._staff_permission_at_scope(actor,'reports.fnb',b.id)
       or public._staff_permission_at_scope(actor,'reports.analytics',b.id));
 return result;
end $$;
revoke all on function public._staff_fnb_report_branches(uuid) from public,anon,authenticated;
create function public.staff_fnb_menu_summary(
 p_branch_id uuid default null,p_from timestamptz default null,
 p_to timestamptz default null,p_limit integer default 15
) returns table(product_name text,quantity numeric,revenue numeric)
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id(); branches uuid[];
begin
 branches:=public._staff_fnb_report_branches(p_branch_id);
 if p_limit is null or p_limit<0 or p_limit>1000 or (p_from is not null and p_to is not null and p_from>=p_to) then
  raise exception 'FNB_REPORT_FILTER_INVALID' using errcode='22023'; end if;
 return query
 select ki.product_name,sum(ki.quantity)::numeric,sum(ki.quantity*coalesce(ki.unit_price,0))::numeric
 from public.kitchen_orders ko
 join public.invoices i on i.id=ko.invoice_id and i.tenant_id=tenant and i.branch_id=ko.branch_id
 join public.kitchen_order_items ki on ki.kitchen_order_id=ko.id
 where ko.tenant_id=tenant and i.source='fnb' and i.status='completed'
  and ko.branch_id=any(branches)
  and (p_from is null or i.ngay_chung_tu>=p_from)
  and (p_to is null or i.ngay_chung_tu<p_to)
 group by ki.product_name order by sum(ki.quantity*coalesce(ki.unit_price,0)) desc,ki.product_name
 limit p_limit;
end $$;
revoke all on function public.staff_fnb_menu_summary(uuid,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.staff_fnb_menu_summary(uuid,timestamptz,timestamptz,integer) to authenticated;
create function public.staff_fnb_table_summary(
 p_branch_id uuid default null,p_from timestamptz default null,p_to timestamptz default null
) returns table(table_name text,revenue numeric,orders bigint)
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id();branches uuid[];
begin
 branches:=public._staff_fnb_report_branches(p_branch_id);
 if p_from is not null and p_to is not null and p_from>=p_to then
  raise exception 'FNB_REPORT_FILTER_INVALID' using errcode='22023'; end if;
 return query
 with invoice_table as (
  select distinct on (i.id) i.id,ko.table_id,i.total
  from public.kitchen_orders ko
  join public.invoices i on i.id=ko.invoice_id and i.tenant_id=tenant and i.branch_id=ko.branch_id
  where ko.tenant_id=tenant and ko.branch_id=any(branches) and ko.table_id is not null
   and i.source='fnb' and i.status='completed'
   and (p_from is null or i.ngay_chung_tu>=p_from)
   and (p_to is null or i.ngay_chung_tu<p_to)
  order by i.id,ko.id
 )
 select coalesce(t.name,'Bàn '||left(it.table_id::text,4)),sum(coalesce(it.total,0))::numeric,count(*)::bigint
 from invoice_table it left join public.restaurant_tables t on t.id=it.table_id
 group by it.table_id,t.name order by sum(coalesce(it.total,0)) desc,it.table_id;
end $$;
revoke all on function public.staff_fnb_table_summary(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.staff_fnb_table_summary(uuid,timestamptz,timestamptz) to authenticated;
create function public.staff_fnb_kpi_summary(
 p_branch_id uuid default null,p_from timestamptz default null,p_to timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id();branches uuid[];
 gross numeric;return_total numeric;order_count bigint;turnover numeric;
begin
 branches:=public._staff_fnb_report_branches(p_branch_id);
 if p_from is not null and p_to is not null and p_from>=p_to then
  raise exception 'FNB_REPORT_FILTER_INVALID' using errcode='22023';end if;
 select coalesce(sum(i.total),0),count(*) into gross,order_count
 from public.invoices i where i.tenant_id=tenant and i.branch_id=any(branches)
  and i.source='fnb' and i.status<>'cancelled'
  and (p_from is null or i.ngay_chung_tu>=p_from)
  and (p_to is null or i.ngay_chung_tu<p_to);
 select coalesce(sum(r.total),0) into return_total from public.sales_returns r
 join public.invoices i on i.id=r.invoice_id and i.tenant_id=tenant
 where r.tenant_id=tenant and r.branch_id=any(branches) and i.source='fnb'
  and r.status in ('confirmed','completed')
  and (p_from is null or r.created_at>=p_from)
  and (p_to is null or r.created_at<p_to);
 select coalesce(floor(avg(extract(epoch from (date_trunc('milliseconds',k.updated_at)-date_trunc('milliseconds',k.created_at)))/60)+0.5),0) into turnover
 from public.kitchen_orders k where k.tenant_id=tenant and k.branch_id=any(branches)
  and k.status='completed' and k.table_id is not null
  and (p_from is null or k.created_at>=p_from)
  and (p_to is null or k.created_at<p_to);
 return jsonb_build_object('totalRevenue',gross,'returnAmount',return_total,'netRevenue',gross-return_total,
  'totalOrders',order_count,'avgTicket',case when order_count=0 then 0 else floor(gross/order_count+0.5) end,
  'avgTurnoverMinutes',turnover);
end $$;
revoke all on function public.staff_fnb_kpi_summary(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.staff_fnb_kpi_summary(uuid,timestamptz,timestamptz) to authenticated;
create function public.staff_fnb_hour_summary(
 p_branch_id uuid default null,p_from timestamptz default null,p_to timestamptz default null
) returns table(hour integer,revenue numeric,orders bigint)
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id();branches uuid[];
begin
 branches:=public._staff_fnb_report_branches(p_branch_id);
 if p_from is not null and p_to is not null and p_from>=p_to then
  raise exception 'FNB_REPORT_FILTER_INVALID' using errcode='22023';end if;
 return query
 with totals as (
  select extract(hour from (coalesce(i.ngay_chung_tu,'1970-01-01 00:00:00+00'::timestamptz) at time zone 'Asia/Ho_Chi_Minh'))::integer as h,
   sum(coalesce(i.total,0))::numeric as amount,count(*)::bigint as n
  from public.invoices i where i.tenant_id=tenant and i.branch_id=any(branches)
   and i.source='fnb' and i.status<>'cancelled'
   and (p_from is null or i.ngay_chung_tu>=p_from)
   and (p_to is null or i.ngay_chung_tu<p_to) group by h
 )
 select hrs.hh,coalesce(t.amount,0)::numeric,coalesce(t.n,0)::bigint
 from generate_series(0,23) as hrs(hh) left join totals t on t.h=hrs.hh order by hrs.hh;
end $$;
create function public.staff_fnb_cashier_summary(
 p_branch_id uuid default null,p_from timestamptz default null,p_to timestamptz default null
) returns table(cashier_name text,revenue numeric,orders bigint,avg_ticket numeric)
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id();branches uuid[];
begin
 branches:=public._staff_fnb_report_branches(p_branch_id);
 if p_from is not null and p_to is not null and p_from>=p_to then
  raise exception 'FNB_REPORT_FILTER_INVALID' using errcode='22023';end if;
 return query
 select coalesce(p.full_name,'Không rõ'),sum(coalesce(i.total,0))::numeric,count(*)::bigint,
  floor(sum(coalesce(i.total,0))/count(*)+0.5)::numeric
 from public.invoices i left join public.profiles p on p.id=i.created_by and p.tenant_id=tenant
 where i.tenant_id=tenant and i.branch_id=any(branches) and i.source='fnb' and i.status<>'cancelled'
  and (p_from is null or i.ngay_chung_tu>=p_from) and (p_to is null or i.ngay_chung_tu<p_to)
 group by i.created_by,p.full_name order by sum(coalesce(i.total,0)) desc,i.created_by;
end $$;
revoke all on function public.staff_fnb_hour_summary(uuid,timestamptz,timestamptz),
 public.staff_fnb_cashier_summary(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.staff_fnb_hour_summary(uuid,timestamptz,timestamptz),
 public.staff_fnb_cashier_summary(uuid,timestamptz,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
