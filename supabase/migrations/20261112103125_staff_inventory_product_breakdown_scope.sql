-- List only visible branches before filling absent stock rows with zero.
-- This avoids presenting a branch hidden by inventory permissions as empty.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.get_inventory_product_breakdown_scoped(p_product uuid)
returns table(branch_id uuid,branch_name text,branch_code text,quantity numeric,reserved numeric,updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; has_exception boolean; all_branches boolean;
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and p.is_active;
 if tenant is null then raise exception 'STOCK_BREAKDOWN_DENIED' using errcode='42501';end if;
 if p_product is null or not exists(select 1 from public.products p where p.id=p_product and p.tenant_id=tenant) then
  raise exception 'STOCK_BREAKDOWN_PRODUCT_INVALID' using errcode='22023';end if;
 select exists(select 1 from public.user_branch_permission_overrides o where o.tenant_id=tenant
  and o.user_id=actor and o.permission_code='inventory.view') into has_exception;
 all_branches:=coalesce(public.user_has_permission(actor,'reports.view_all_branches'),false);
 return query select b.id,b.name,b.code,coalesce(sum(s.quantity),0)::numeric,
  coalesce(sum(s.reserved),0)::numeric,max(s.updated_at)
 from public.branches b left join public.branch_stock s on s.tenant_id=tenant
  and s.branch_id=b.id and s.product_id=p_product
 where b.tenant_id=tenant and b.is_active and (not has_exception or (
  (all_branches or public.user_has_branch_access(actor,b.id))
  and public._staff_permission_at_scope(actor,'inventory.view',b.id)))
 group by b.id,b.name,b.code;
end $$;
revoke all on function public.get_inventory_product_breakdown_scoped(uuid) from public,anon;
grant execute on function public.get_inventory_product_breakdown_scoped(uuid) to authenticated;
commit;
