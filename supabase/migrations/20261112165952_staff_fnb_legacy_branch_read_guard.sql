-- A global F&B view grant does not itself authorize every branch. Preserve
-- explicitly assigned branches and the independent all-branch report scope.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create or replace function public._staff_fnb_order_direct_read(p_tenant uuid,p_branch uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); member boolean; report_scope boolean; code text;
begin
 if actor is null or p_tenant is distinct from public.get_user_tenant_id() then return false; end if;
 if not exists(select 1 from public.profiles p where p.id=actor and p.tenant_id=p_tenant and coalesce(p.is_active,false)) then return false; end if;
 if not exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=p_tenant) then return false; end if;
 member:=coalesce(public.user_has_branch_access(actor,p_branch),false);
 report_scope:=member or coalesce(public.user_has_permission(actor,'reports.view_all_branches'),false);
 if public._staff_fnb_order_has_no_view_exception() then return report_scope; end if;
 if member then
  foreach code in array array['pos_fnb.view_orders','pos_fnb.send_kitchen','pos_fnb.checkout',
   'pos_fnb.void','pos_fnb.cancel_unpaid_order','pos_fnb.void_paid_bill','pos_fnb.edit_sent_order',
   'pos_fnb.discount','pos_fnb.manage_tables','pos_fnb.merge_bills','pos_fnb.split_bill',
   'pos_fnb.transfer_table','pos_fnb.edit_price','orders.view','invoices.view','inventory.view'] loop
   if public._staff_permission_at_scope(actor,code,p_branch) then return true; end if;
  end loop;
 end if;
 if report_scope then
  foreach code in array array['reports.analytics','reports.fnb','reports.dashboard'] loop
   if public._staff_permission_at_scope(actor,code,p_branch) then return true; end if;
  end loop;
 end if;
 return false;
end $$;
-- Resolve the permitted branch list once per statement, including for legacy
-- users without an exception. The old boolean fast path bypassed membership.
alter policy staff_fnb_order_view_read on public.kitchen_orders
 using (coalesce(branch_id=any((select public._staff_fnb_order_readable_branches())::uuid[]),false));
commit;
