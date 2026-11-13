-- Lot traceability is an independent analytics report. Keep its branch-scoped
-- lot access without widening inventory document or inventory list access.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create or replace function public._staff_inventory_lot_row_visible(p_tenant uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_tenant=public.get_user_tenant_id() and (
  public._staff_inventory_row_visible(p_branch)
  or (exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=p_tenant)
   and (public.user_has_branch_access(auth.uid(),p_branch)
     or public.user_has_permission(auth.uid(),'reports.view_all_branches'))
   and (public._staff_permission_at_scope(auth.uid(),'production.view',p_branch)
     or public._staff_permission_at_scope(auth.uid(),'reports.analytics',p_branch)))
 )
$$;
create function public._staff_lot_has_no_view_exception()
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.user_branch_permission_overrides o
  where o.user_id=auth.uid() and o.permission_code='inventory.view')
$$;
create function public._staff_lot_readable_branches()
returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(b.id),'{}'::uuid[]) from public.branches b
  where b.tenant_id=public.get_user_tenant_id() and public._staff_inventory_lot_row_visible(b.tenant_id,b.id)
$$;
revoke all on function public._staff_lot_has_no_view_exception(),public._staff_lot_readable_branches() from public,anon;
grant execute on function public._staff_lot_has_no_view_exception(),public._staff_lot_readable_branches() to authenticated;
alter policy staff_inventory_lot_scope on public.product_lots using (
 tenant_id=(select public.get_user_tenant_id()) and ((select public._staff_lot_has_no_view_exception())
  or coalesce(branch_id=any((select public._staff_lot_readable_branches())::uuid[]),false))
);
commit;
