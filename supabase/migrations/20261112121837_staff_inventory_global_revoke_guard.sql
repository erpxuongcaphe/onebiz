-- A global explicit revoke is also an exception; otherwise the legacy fast
-- path would bypass it when no per-branch exception has been saved.
-- Independently scoped stocktake, production, POS and report rights retain
-- their existing access through their own branch predicates.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create or replace function public._staff_stock_has_no_view_exception()
returns boolean language sql stable security definer set search_path='' as $$
 select public.user_has_permission(auth.uid(),'inventory.view') and not exists(select 1 from public.user_branch_permission_overrides o
  where o.tenant_id=public.get_user_tenant_id() and o.user_id=auth.uid() and o.permission_code='inventory.view')
 and not exists(select 1 from public.user_permission_overrides o
  where o.tenant_id=public.get_user_tenant_id() and o.user_id=auth.uid()
   and o.permission_code='inventory.view' and o.override_type='revoke')
$$;
create or replace function public._staff_lot_has_no_view_exception()
returns boolean language sql stable security definer set search_path='' as $$
 select public.user_has_permission(auth.uid(),'inventory.view') and not exists(select 1 from public.user_branch_permission_overrides o
  where o.user_id=auth.uid() and o.permission_code='inventory.view')
 and not exists(select 1 from public.user_permission_overrides o
  where o.tenant_id=public.get_user_tenant_id() and o.user_id=auth.uid()
   and o.permission_code='inventory.view' and o.override_type='revoke')
$$;
create or replace function public._staff_inventory_row_visible(p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (select public._staff_lot_has_no_view_exception())
  or (p_branch is not null and public._staff_permission_at_scope(auth.uid(),'inventory.view',p_branch))
$$;
commit;
