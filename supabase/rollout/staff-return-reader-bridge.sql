-- Phase 1 only: additive compatibility reader for existing ONEBIZ schemas.
-- This does not alter invoice policies, roles, sales, print jobs or tokens.
-- Apply only after verifying this file's hash and the ONEBIZ project target.
-- The later staff migration replaces the body with branch-override checks.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create or replace function public.staff_returnable_invoice_items(p_invoice_id uuid)
returns table(id uuid,product_id uuid,product_name text,unit text,quantity numeric,
 unit_price numeric,total numeric,returned_qty numeric)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; actor_role text; doc record; independent boolean;
begin
 select p.tenant_id,p.role into tenant,actor_role from public.profiles p
  where p.id=actor and coalesce(p.is_active,false);
 if tenant is null then raise exception 'RETURN_READ_DENIED' using errcode='42501'; end if;
 select i.branch_id,i.source,i.status,i.created_by into doc from public.invoices i
  where i.id=p_invoice_id and i.tenant_id=tenant;
 if not found or doc.branch_id is null or not coalesce(public.user_has_branch_access(actor,doc.branch_id),false)
  then raise exception 'RETURN_READ_DENIED' using errcode='42501'; end if;
 if doc.status<>'completed' or doc.status is null then raise exception 'INVOICE_NOT_COMPLETED' using errcode='22023'; end if;
 if doc.source='fnb' then
  if not coalesce(public.user_has_permission(actor,'pos_fnb.checkout'),false)
   then raise exception 'RETURN_READ_DENIED' using errcode='42501'; end if;
 elsif not coalesce(public.user_has_permission(actor,'pos_retail.checkout'),false)
   and not coalesce(public.user_has_permission(actor,'pos_fnb.view_orders'),false)
  then raise exception 'RETURN_READ_DENIED' using errcode='42501'; end if;
 if doc.source='order' and actor_role is distinct from 'owner'
  and coalesce(public.user_has_permission(actor,'orders.view_own_only'),true) and doc.created_by is distinct from actor then
  independent:=public.user_has_permission(actor,'invoices.view') or public.user_has_permission(actor,'inventory.view')
   or public.user_has_permission(actor,'pos_retail.checkout') or public.user_has_permission(actor,'pos_retail.void')
   or public.user_has_permission(actor,'finance.view_cash_book') or public.user_has_permission(actor,'reports.dashboard')
   or (public.user_has_permission(actor,'reports.analytics') and public.user_has_permission(actor,'reports.view_detail'));
  if not coalesce(independent,false) then raise exception 'RETURN_READ_DENIED' using errcode='42501'; end if;
 end if;
 return query select ii.id,ii.product_id,ii.product_name,ii.unit,ii.quantity,ii.unit_price,ii.total,ii.returned_qty
  from public.invoice_items ii where ii.invoice_id=p_invoice_id order by ii.id;
end $$;
revoke all on function public.staff_returnable_invoice_items(uuid) from public,anon;
grant execute on function public.staff_returnable_invoice_items(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
