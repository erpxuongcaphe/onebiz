-- The operational-alert report needs a small expiry projection even when a
-- staff member's inventory-list access is restricted. Do not broaden direct
-- SELECT access to complete lot rows or to other inventory documents.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.get_financial_alert_lots(p_branch uuid default null)
returns table(id uuid,lot_number text,product_id uuid,expiry_date date,current_qty numeric,product_name text)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; allowed uuid[];
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,true);
 if tenant is null then raise exception 'ALERT_LOTS_AUTH_REQUIRED' using errcode='42501';end if;
 select coalesce(array_agg(b.id),'{}'::uuid[]) into allowed from public.branches b
  where b.tenant_id=tenant and (p_branch is null or b.id=p_branch)
   and (public.user_has_branch_access(actor,b.id) or public.user_has_permission(actor,'reports.view_all_branches'))
   and (public._staff_permission_at_scope(actor,'reports.dashboard',b.id) or public._staff_permission_at_scope(actor,'reports.analytics',b.id));
 if cardinality(allowed)=0 then raise exception 'ALERT_LOTS_SCOPE_DENIED' using errcode='42501';end if;
 return query select l.id,l.lot_number,l.product_id,l.expiry_date,l.current_qty,p.name
  from public.product_lots l left join public.products p on p.id=l.product_id and p.tenant_id=tenant
  where l.tenant_id=tenant and l.branch_id=any(allowed) and l.current_qty>0
   and l.status in ('active','expired') and l.expiry_date is not null
  order by l.expiry_date asc,l.id asc limit 20;
end $$;
revoke all on function public.get_financial_alert_lots(uuid) from public,anon;
grant execute on function public.get_financial_alert_lots(uuid) to authenticated;
commit;
