-- F&B report drill-down needs an explicit detail right in each branch.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_fnb_detail_branches(p_branch_id uuid)
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();report_branches uuid[];detail_branches uuid[];
begin
 report_branches:=public._staff_fnb_report_branches(p_branch_id);
 if not public._staff_permission_any_branch(actor,'reports.view_detail') then
  raise exception 'FNB_REPORT_DETAIL_PERMISSION_REQUIRED' using errcode='42501';end if;
 select coalesce(array_agg(b),'{}'::uuid[]) into detail_branches
 from unnest(report_branches) b
 where public._staff_permission_at_scope(actor,'reports.view_detail',b);
 if p_branch_id is not null and not p_branch_id=any(detail_branches) then
  raise exception 'FNB_REPORT_DETAIL_PERMISSION_REQUIRED' using errcode='42501';end if;
 return detail_branches;
end $$;
revoke all on function public._staff_fnb_detail_branches(uuid) from public,anon,authenticated;
create function public.staff_fnb_invoice_detail_page(
 p_branch_id uuid default null,p_from timestamptz default null,p_to timestamptz default null,
 p_offset integer default 0,p_limit integer default 51
) returns table(id uuid,code text,ngay_chung_tu timestamptz,customer_name text,status text,total numeric,paid numeric,debt numeric,payment_method text)
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id();branches uuid[];
begin
 branches:=public._staff_fnb_detail_branches(p_branch_id);
 if p_offset is null or p_offset<0 or p_limit is null or p_limit<1 or p_limit>501
  or (p_from is not null and p_to is not null and p_from>=p_to) then
  raise exception 'FNB_REPORT_FILTER_INVALID' using errcode='22023';end if;
 return query select i.id,i.code,i.ngay_chung_tu,i.customer_name,i.status,i.total,i.paid,i.debt,i.payment_method
 from public.invoices i where i.tenant_id=tenant and i.branch_id=any(branches)
  and i.source='fnb' and i.status<>'cancelled'
  and (p_from is null or i.ngay_chung_tu>=p_from) and (p_to is null or i.ngay_chung_tu<p_to)
 order by i.ngay_chung_tu desc nulls first,i.id desc offset p_offset limit p_limit;
end $$;
create function public.staff_fnb_return_detail_page(
 p_branch_id uuid default null,p_from timestamptz default null,p_to timestamptz default null,
 p_offset integer default 0,p_limit integer default 51
) returns table(id uuid,code text,created_at timestamptz,invoice_code text,total numeric,refunded numeric)
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id();branches uuid[];
begin
 branches:=public._staff_fnb_detail_branches(p_branch_id);
 if p_offset is null or p_offset<0 or p_limit is null or p_limit<1 or p_limit>501
  or (p_from is not null and p_to is not null and p_from>=p_to) then
  raise exception 'FNB_REPORT_FILTER_INVALID' using errcode='22023';end if;
 return query select r.id,r.code,r.created_at,i.code,r.total,r.refunded
 from public.sales_returns r join public.invoices i on i.id=r.invoice_id and i.tenant_id=tenant and i.branch_id=r.branch_id
 where r.tenant_id=tenant and r.branch_id=any(branches) and i.source='fnb'
  and r.status in ('confirmed','completed')
  and (p_from is null or r.created_at>=p_from) and (p_to is null or r.created_at<p_to)
 order by r.created_at desc nulls first,r.id desc offset p_offset limit p_limit;
end $$;
revoke all on function public.staff_fnb_invoice_detail_page(uuid,timestamptz,timestamptz,integer,integer),
 public.staff_fnb_return_detail_page(uuid,timestamptz,timestamptz,integer,integer) from public,anon;
grant execute on function public.staff_fnb_invoice_detail_page(uuid,timestamptz,timestamptz,integer,integer),
 public.staff_fnb_return_detail_page(uuid,timestamptz,timestamptz,integer,integer) to authenticated;
create function public.staff_fnb_delivery_summary(
 p_branch_id uuid default null,p_from timestamptz default null,p_to timestamptz default null
) returns table(staff_id uuid,staff_name text,total_orders bigint,total_revenue numeric,
 total_delivery_fee numeric,avg_delivery_seconds numeric,completed_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id();branches uuid[];
begin
 branches:=public._staff_fnb_detail_branches(p_branch_id);
 if p_from is not null and p_to is not null and p_from>=p_to then
  raise exception 'FNB_REPORT_FILTER_INVALID' using errcode='22023';end if;
 return query
 with scoped as (
  select k.delivery_staff_id,k.delivery_fee,i.total,
   extract(epoch from (date_trunc('milliseconds',k.delivery_completed_at)-date_trunc('milliseconds',k.delivery_assigned_at))) as seconds
  from public.kitchen_orders k left join public.invoices i on i.id=k.invoice_id and i.tenant_id=tenant and i.branch_id=k.branch_id
  where k.tenant_id=tenant and k.branch_id=any(branches) and k.delivery_staff_id is not null
   and (p_from is null or k.created_at>=p_from) and (p_to is null or k.created_at<p_to)
 )
 select s.delivery_staff_id,coalesce(p.full_name,'Không rõ'),count(*)::bigint,
  sum(coalesce(s.total,0))::numeric,sum(coalesce(s.delivery_fee,0))::numeric,
  coalesce(floor(avg(s.seconds) filter(where s.seconds>0)+0.5),0)::numeric,
  count(*) filter(where s.seconds>0)::bigint
 from scoped s left join public.profiles p on p.id=s.delivery_staff_id and p.tenant_id=tenant
 group by s.delivery_staff_id,p.full_name order by count(*) desc,s.delivery_staff_id;
end $$;
create function public.staff_fnb_delivery_detail_page(
 p_staff_id uuid,p_branch_id uuid default null,p_from timestamptz default null,p_to timestamptz default null,
 p_offset integer default 0,p_limit integer default 501
) returns table(kitchen_order_id uuid,order_number text,invoice_id uuid,invoice_code text,customer_name text,
 total numeric,delivery_fee numeric,delivery_tier text,assigned_at timestamptz,completed_at timestamptz,
 duration_seconds numeric,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid:=public.get_user_tenant_id();branches uuid[];
begin
 branches:=public._staff_fnb_detail_branches(p_branch_id);
 if p_staff_id is null or p_offset is null or p_offset<0 or p_limit is null or p_limit<1 or p_limit>501
  or (p_from is not null and p_to is not null and p_from>=p_to) then
  raise exception 'FNB_REPORT_FILTER_INVALID' using errcode='22023';end if;
 return query select k.id,k.order_number,i.id,i.code,coalesce(i.customer_name,'Khách lẻ'),
  coalesce(i.total,0),coalesce(k.delivery_fee,0),k.delivery_distance_tier,k.delivery_assigned_at,k.delivery_completed_at,
  case when k.delivery_assigned_at is not null and k.delivery_completed_at is not null then
   floor(extract(epoch from (date_trunc('milliseconds',k.delivery_completed_at)-date_trunc('milliseconds',k.delivery_assigned_at)))+0.5)
  else null end,k.created_at
 from public.kitchen_orders k left join public.invoices i on i.id=k.invoice_id and i.tenant_id=tenant and i.branch_id=k.branch_id
 where k.tenant_id=tenant and k.branch_id=any(branches) and k.delivery_staff_id=p_staff_id
  and (p_from is null or k.created_at>=p_from) and (p_to is null or k.created_at<p_to)
 order by k.created_at desc nulls first,k.id desc offset p_offset limit p_limit;
end $$;
revoke all on function public.staff_fnb_delivery_summary(uuid,timestamptz,timestamptz),
 public.staff_fnb_delivery_detail_page(uuid,uuid,timestamptz,timestamptz,integer,integer) from public,anon;
grant execute on function public.staff_fnb_delivery_summary(uuid,timestamptz,timestamptz),
 public.staff_fnb_delivery_detail_page(uuid,uuid,timestamptz,timestamptz,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
