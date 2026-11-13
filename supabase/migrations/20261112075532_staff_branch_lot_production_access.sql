-- The production dashboard reads lot rows independently of the stock-list
-- workspace. Preserve that existing access when stock-view exceptions exist,
-- without changing inventory-document or inventory RPC authorization.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_inventory_lot_row_visible(p_tenant uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_tenant=public.get_user_tenant_id() and (
  public._staff_inventory_row_visible(p_branch)
  or (exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=p_tenant)
   and (public.user_has_branch_access(auth.uid(),p_branch)
     or public.user_has_permission(auth.uid(),'reports.view_all_branches'))
   and public._staff_permission_at_scope(auth.uid(),'production.view',p_branch))
 )
$$;
revoke all on function public._staff_inventory_lot_row_visible(uuid,uuid) from public,anon;
grant execute on function public._staff_inventory_lot_row_visible(uuid,uuid) to authenticated;
alter policy staff_inventory_lot_scope on public.product_lots
 using (public._staff_inventory_lot_row_visible(tenant_id,branch_id));
commit;
