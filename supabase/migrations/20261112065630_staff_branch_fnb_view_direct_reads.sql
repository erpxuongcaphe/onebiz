-- The old tenant-only SELECT policies are permissive and OR together. When a
-- branch-specific F&B view exception exists, add a restrictive row boundary.
-- Other independently authorised POS/report/document workflows still need the
-- same records; the guard preserves those alternatives at their own scope.
-- No F&B view exception can be configured until its catalog gate is enabled.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_fnb_order_direct_read(p_tenant uuid,p_branch uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); member boolean; report_scope boolean; code text;
begin
 if actor is null or p_tenant is distinct from public.get_user_tenant_id() then return false;end if;
 if not exists(select 1 from public.user_branch_permission_overrides o
   where o.tenant_id=p_tenant and o.user_id=actor and o.permission_code='pos_fnb.view_orders') then
  return true;
 end if;
 if not exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=p_tenant) then return false;end if;
 member:=coalesce(public.user_has_branch_access(actor,p_branch),false);
 if member then
  foreach code in array array['pos_fnb.view_orders','pos_fnb.send_kitchen','pos_fnb.checkout',
   'pos_fnb.void','pos_fnb.cancel_unpaid_order','pos_fnb.void_paid_bill','pos_fnb.edit_sent_order',
   'pos_fnb.discount','pos_fnb.manage_tables','pos_fnb.merge_bills','pos_fnb.split_bill',
   'pos_fnb.transfer_table','pos_fnb.edit_price','orders.view','invoices.view','inventory.view'] loop
   if public._staff_permission_at_scope(actor,code,p_branch) then return true;end if;
  end loop;
 end if;
 report_scope:=member or coalesce(public.user_has_permission(actor,'reports.view_all_branches'),false);
 if report_scope then
  foreach code in array array['reports.analytics','reports.fnb','reports.dashboard','pos_fnb.view_sales_summary'] loop
   if public._staff_permission_at_scope(actor,code,p_branch) then return true;end if;
  end loop;
 end if;
 return false;
end $$;
revoke all on function public._staff_fnb_order_direct_read(uuid,uuid) from public,anon;
grant execute on function public._staff_fnb_order_direct_read(uuid,uuid) to authenticated;
create policy staff_fnb_order_view_read on public.kitchen_orders as restrictive for select to authenticated
 using (public._staff_fnb_order_direct_read(tenant_id,branch_id));
create policy staff_fnb_order_item_view_read on public.kitchen_order_items as restrictive for select to authenticated
 using (exists(select 1 from public.kitchen_orders ko where ko.id=kitchen_order_items.kitchen_order_id
  and public._staff_fnb_order_direct_read(ko.tenant_id,ko.branch_id)));
commit;
