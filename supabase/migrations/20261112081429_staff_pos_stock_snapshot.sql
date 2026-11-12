-- Narrow stock projection used by the POS/product availability snapshot.
-- The existing table contains stock used by inventory and reporting too.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.get_pos_stock_snapshot_scoped(p_branch uuid,p_product_ids uuid[])
returns table(product_id uuid,quantity numeric)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();tenant uuid;has_exception boolean; member boolean; allowed boolean;
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and p.is_active;
 if tenant is null then raise exception 'POS_STOCK_AUTH_REQUIRED' using errcode='42501';end if;
 if p_branch is null or p_product_ids is null or cardinality(p_product_ids)>200
    or array_position(p_product_ids,null) is not null then raise exception 'POS_STOCK_INVALID_REQUEST' using errcode='22023';end if;
 if not exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=tenant) then
  raise exception 'POS_STOCK_BRANCH_DENIED' using errcode='42501';end if;
 member:=coalesce(public.user_has_branch_access(actor,p_branch),false);
 if not member and not coalesce(public.user_has_permission(actor,'reports.view_all_branches'),false) then
  raise exception 'POS_STOCK_BRANCH_DENIED' using errcode='42501';end if;
 select exists(select 1 from public.user_branch_permission_overrides o where o.tenant_id=tenant
  and o.user_id=actor and o.permission_code='inventory.view') into has_exception;
 if has_exception then
  allowed:=public._staff_permission_at_scope(actor,'inventory.view',p_branch)
   or (member and (public._staff_permission_at_scope(actor,'pos_retail.checkout',p_branch)
   or public._staff_permission_at_scope(actor,'pos_fnb.send_kitchen',p_branch)
   or public._staff_permission_at_scope(actor,'pos_fnb.checkout',p_branch)));
  if not coalesce(allowed,false) then raise exception 'POS_STOCK_PERMISSION_DENIED' using errcode='42501';end if;
 end if;
 return query select s.product_id,s.quantity::numeric from public.branch_stock s
  where s.tenant_id=tenant and s.branch_id=p_branch and s.variant_id is null and s.product_id=any(p_product_ids);
end $$;
revoke all on function public.get_pos_stock_snapshot_scoped(uuid,uuid[]) from public,anon;
grant execute on function public.get_pos_stock_snapshot_scoped(uuid,uuid[]) to authenticated;
commit;
