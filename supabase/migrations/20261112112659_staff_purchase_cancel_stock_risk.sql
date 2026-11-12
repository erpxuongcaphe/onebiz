-- Return only document-specific shortage indicators, not company-wide balances.
-- The existing revert implementation checks products.stock for each received
-- line, so repeated product lines must be summed to predict its final guard.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.get_purchase_cancel_stock_risks(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; target_branch uuid; target_status text; risks jsonb;
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,true);
 if tenant is null then raise exception 'PURCHASE_CANCEL_AUTH_REQUIRED' using errcode='42501'; end if;
 select po.branch_id,po.status into target_branch,target_status from public.purchase_orders po
  where po.id=p_order_id and po.tenant_id=tenant;
 if not found or target_branch is null
  or not coalesce(public.user_has_branch_access(actor,target_branch),false)
  or not coalesce(public._staff_permission_at_scope(actor,'inventory.create_po',target_branch),false) then
  raise exception 'PURCHASE_CANCEL_SCOPE_DENIED' using errcode='42501';
 end if;
 if target_status not in ('partial','completed') then
  raise exception 'PURCHASE_CANCEL_STATUS_INVALID' using errcode='22023';
 end if;
 if exists(select 1 from public.purchase_order_items i left join public.products p
   on p.id=i.product_id and p.tenant_id=tenant
   where i.purchase_order_id=p_order_id and coalesce(i.received_quantity,0)>0
    and (p.id is null or p.stock is null)) then
  raise exception 'PURCHASE_CANCEL_STOCK_UNKNOWN' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into risks from (
  select min(i.product_name) product_name, min(i.unit) unit, sum(i.received_quantity)::numeric needed
   from public.purchase_order_items i join public.products p on p.id=i.product_id and p.tenant_id=tenant
   where i.purchase_order_id=p_order_id and coalesce(i.received_quantity,0)>0
   group by i.product_id,p.stock having p.stock < sum(i.received_quantity)
 ) x;
 return risks;
end $$;
revoke all on function public.get_purchase_cancel_stock_risks(uuid) from public,anon;
grant execute on function public.get_purchase_cancel_stock_risks(uuid) to authenticated;
commit;
