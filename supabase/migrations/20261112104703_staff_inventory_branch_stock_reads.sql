-- Existing tenant-only SELECT policies are permissive. Apply the additional
-- branch boundary only when an inventory-view exception has been configured.
-- Other stock-consuming operations retain their own independently scoped
-- capabilities; retail checkout also needs its branch rows for realtime stock
-- notifications, while availability uses a narrow security-definer projection.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_stock_has_no_view_exception()
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.user_branch_permission_overrides o
  where o.tenant_id=public.get_user_tenant_id() and o.user_id=auth.uid() and o.permission_code='inventory.view')
$$;
create function public._staff_stock_readable_branches()
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid:=public.get_user_tenant_id(); b record; member boolean; reporting boolean; code text; permitted boolean; result uuid[]:='{}'::uuid[];
begin
 if actor is null or tenant is null then return result;end if;
 for b in select id from public.branches where tenant_id=tenant loop
  member:=coalesce(public.user_has_branch_access(actor,b.id),false);
  reporting:=member or coalesce(public.user_has_permission(actor,'reports.view_all_branches'),false);
  permitted:=reporting and coalesce(public._staff_permission_at_scope(actor,'inventory.view',b.id),false);
  if reporting and not permitted then
   foreach code in array array['reports.analytics','reports.dashboard','reports.fnb'] loop
    if coalesce(public._staff_permission_at_scope(actor,code,b.id),false) then permitted:=true;exit;end if;
   end loop;
  end if;
  if member and not permitted then
   foreach code in array array['inventory.view_assigned_totals','inventory.check','inventory.edit_check','inventory.transfer',
    'inventory.adjust','inventory.dispose','inventory.internal_export','inventory.create_po',
    'inventory.internal_return_view','inventory.internal_return_send','inventory.internal_return_receive',
    'production.view','production.create_order','production.complete_order','production.cancel_order',
    'production.correct_order','products.view_cost','pos_retail.checkout'] loop
    if coalesce(public._staff_permission_at_scope(actor,code,b.id),false) then permitted:=true;exit;end if;
   end loop;
  end if;
  if permitted then result:=array_append(result,b.id);end if;
 end loop;
 return result;
end $$;
revoke all on function public._staff_stock_has_no_view_exception(),public._staff_stock_readable_branches() from public,anon;
grant execute on function public._staff_stock_has_no_view_exception(),public._staff_stock_readable_branches() to authenticated;
create policy staff_inventory_branch_stock_read on public.branch_stock as restrictive for select to authenticated
 using ((select public._staff_stock_has_no_view_exception())
  or coalesce(branch_id=any((select public._staff_stock_readable_branches())::uuid[]),false));
commit;
