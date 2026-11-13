-- The legacy raw table has column-level SELECT grants as well as a masked
-- view. Apply the same branch exception to direct reads, while keeping all
-- existing tenant, branch and column-level protections in force.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public._staff_movement_direct_allowed_branches()
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; result uuid[];
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,false);
 if tenant is null then return '{}'::uuid[]; end if;
 if not exists(select 1 from public.user_branch_permission_overrides o
  where o.tenant_id=tenant and o.user_id=actor and o.permission_code='inventory.view')
  and not exists(select 1 from public.user_permission_overrides o
   where o.tenant_id=tenant and o.user_id=actor and o.permission_code='inventory.view' and o.override_type='revoke')
  then return null; end if;
 select coalesce(array_agg(b.id),'{}'::uuid[]) into result from public.branches b
  where b.tenant_id=tenant and public._staff_inventory_movement_visible(b.id);
 return result;
end $$;
revoke all on function public._staff_movement_direct_allowed_branches() from public,anon;
grant execute on function public._staff_movement_direct_allowed_branches() to authenticated;

create policy staff_movement_direct_scope on public.stock_movements as restrictive
 for select to authenticated using (
  (select public._staff_movement_direct_allowed_branches()) is null
  or coalesce(branch_id=any((select public._staff_movement_direct_allowed_branches())::uuid[]),false)
 );
commit;
