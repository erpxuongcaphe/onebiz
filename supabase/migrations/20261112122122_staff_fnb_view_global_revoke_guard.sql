-- Do not use the legacy unrestricted read path when order-view access has an
-- explicit account-wide revoke. Other authorized POS/report operations retain
-- their own branch-scoped reads.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create or replace function public._staff_fnb_order_has_no_view_exception()
returns boolean language sql stable security definer set search_path='' as $$
 select public.user_has_permission(auth.uid(),'pos_fnb.view_orders') and not exists(select 1 from public.user_branch_permission_overrides o
  where o.tenant_id=public.get_user_tenant_id() and o.user_id=auth.uid() and o.permission_code='pos_fnb.view_orders')
 and not exists(select 1 from public.user_permission_overrides o
  where o.tenant_id=public.get_user_tenant_id() and o.user_id=auth.uid()
   and o.permission_code='pos_fnb.view_orders' and o.override_type='revoke')
$$;
create or replace function public._staff_fnb_order_direct_read(p_tenant uuid,p_branch uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();member boolean;report_scope boolean;code text;
begin
 if actor is null or p_tenant is distinct from public.get_user_tenant_id() then return false;end if;
 if public._staff_fnb_order_has_no_view_exception() then return true;end if;
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
  foreach code in array array['reports.analytics','reports.fnb','reports.dashboard'] loop
   if public._staff_permission_at_scope(actor,code,p_branch) then return true;end if;
  end loop;
 end if;
 return false;
end $$;
commit;
