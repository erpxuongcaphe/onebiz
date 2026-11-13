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
 from public.sales_returns r join public.invoices i on i.id=r.invoice_id and i.tenant_id=tenant
 where r.tenant_id=tenant and r.branch_id=any(branches) and i.source='fnb'
  and r.status in ('confirmed','completed')
  and (p_from is null or r.created_at>=p_from) and (p_to is null or r.created_at<p_to)
 order by r.created_at desc nulls first,r.id desc offset p_offset limit p_limit;
end $$;
revoke all on function public.staff_fnb_invoice_detail_page(uuid,timestamptz,timestamptz,integer,integer),
 public.staff_fnb_return_detail_page(uuid,timestamptz,timestamptz,integer,integer) from public,anon;
grant execute on function public.staff_fnb_invoice_detail_page(uuid,timestamptz,timestamptz,integer,integer),
 public.staff_fnb_return_detail_page(uuid,timestamptz,timestamptz,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
