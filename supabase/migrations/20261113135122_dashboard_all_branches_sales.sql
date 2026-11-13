begin;

-- The consolidated dashboard intentionally excludes internal sales.  This
-- read-only companion reports the amounts excluded, using the same dates and
-- invoice/return rules, so a user can reconcile the sum of branch reports.
create function public.get_dashboard_internal_sales(p_day date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  tenant uuid;
  sold numeric;
  returned numeric;
begin
  select p.tenant_id into tenant from public.profiles p where p.id = actor and p.is_active;
  if tenant is null then raise exception 'DASHBOARD_ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
  if not public.user_has_permission(actor, 'reports.view_all_branches')
     or not public.user_has_permission(actor, 'reports.dashboard')
     or (exists(select 1 from public.branches b where b.tenant_id=tenant and b.branch_type='store')
         and not public.user_has_permission(actor, 'pos_fnb.view_sales_summary')) then
    raise exception 'DASHBOARD_ALL_BRANCHES_DENIED' using errcode='42501';
  end if;
  if p_day is null or p_day > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'DASHBOARD_DAY_INVALID' using errcode='22007';
  end if;
  select coalesce(sum(i.total), 0) into sold from public.invoices i
   where i.tenant_id=tenant and i.deleted_at is null and i.status='completed' and i.source='internal'
     and i.ngay_chung_tu >= (p_day::timestamp at time zone 'Asia/Ho_Chi_Minh')
     and i.ngay_chung_tu < ((p_day+1)::timestamp at time zone 'Asia/Ho_Chi_Minh');
  select coalesce(sum(r.total), 0) into returned from public.sales_returns r
   join public.invoices i on i.id=r.invoice_id and i.branch_id=r.branch_id and i.tenant_id=r.tenant_id
   where r.tenant_id=tenant and r.status='completed' and i.status='completed' and i.deleted_at is null and i.source='internal'
     and r.created_at >= (p_day::timestamp at time zone 'Asia/Ho_Chi_Minh')
     and r.created_at < ((p_day+1)::timestamp at time zone 'Asia/Ho_Chi_Minh');
  return jsonb_build_object('internal_net', sold-returned);
end $$;
revoke all on function public.get_dashboard_internal_sales(date) from public, anon;
grant execute on function public.get_dashboard_internal_sales(date) to authenticated;

-- Read both totals under one statement snapshot.
create function public.get_dashboard_all_branch_day(p_day date)
returns jsonb language sql stable security invoker set search_path='' as $$
  select public.get_operational_sales_dashboard(null,p_day,p_day,'hour') || public.get_dashboard_internal_sales(p_day)
$$;
revoke all on function public.get_dashboard_all_branch_day(date) from public,anon;
grant execute on function public.get_dashboard_all_branch_day(date) to authenticated;

commit;
