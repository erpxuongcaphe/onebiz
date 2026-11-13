-- Report totals without disclosing the underlying bills or order lines.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.staff_fnb_menu_summary(
 p_branch_id uuid default null,p_from timestamptz default null,
 p_to timestamptz default null,p_limit integer default 15
) returns table(product_name text,quantity numeric,revenue numeric)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid:=public.get_user_tenant_id();
begin
 if actor is null or tenant is null or not exists(
  select 1 from public.profiles p where p.id=actor and p.tenant_id=tenant and coalesce(p.is_active,false)
 ) then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if not (public._staff_permission_any_branch(actor,'reports.fnb') or public._staff_permission_any_branch(actor,'reports.analytics')) then
  raise exception 'FNB_REPORT_PERMISSION_REQUIRED' using errcode='42501'; end if;
 if p_limit is null or p_limit<0 or p_limit>1000 or (p_from is not null and p_to is not null and p_from>=p_to) then
  raise exception 'FNB_REPORT_FILTER_INVALID' using errcode='22023'; end if;
 if p_branch_id is not null and not coalesce(public.can_read_branch_document_00567(tenant,p_branch_id),false) then
  raise exception 'BRANCH_ACCESS_DENIED' using errcode='42501'; end if;
 if p_branch_id is not null and not (
  public._staff_permission_at_scope(actor,'reports.fnb',p_branch_id)
  or public._staff_permission_at_scope(actor,'reports.analytics',p_branch_id)
 ) then raise exception 'FNB_REPORT_PERMISSION_REQUIRED' using errcode='42501'; end if;
 return query
 with allowed_branches as materialized (
  select b.id from public.branches b where b.tenant_id=tenant
   and (p_branch_id is null or b.id=p_branch_id)
   and public.can_read_branch_document_00567(tenant,b.id)
   and (public._staff_permission_at_scope(actor,'reports.fnb',b.id)
        or public._staff_permission_at_scope(actor,'reports.analytics',b.id))
 )
 select ki.product_name,sum(ki.quantity)::numeric,sum(ki.quantity*coalesce(ki.unit_price,0))::numeric
 from public.kitchen_orders ko
 join allowed_branches b on b.id=ko.branch_id
 join public.invoices i on i.id=ko.invoice_id and i.tenant_id=tenant and i.branch_id=ko.branch_id
 join public.kitchen_order_items ki on ki.kitchen_order_id=ko.id
 where ko.tenant_id=tenant and i.source='fnb' and i.status='completed'
  and (p_from is null or i.ngay_chung_tu>=p_from)
  and (p_to is null or i.ngay_chung_tu<p_to)
 group by ki.product_name order by sum(ki.quantity*coalesce(ki.unit_price,0)) desc,ki.product_name
 limit p_limit;
end $$;
revoke all on function public.staff_fnb_menu_summary(uuid,timestamptz,timestamptz,integer) from public,anon;
grant execute on function public.staff_fnb_menu_summary(uuid,timestamptz,timestamptz,integer) to authenticated;
notify pgrst,'reload schema';
commit;
