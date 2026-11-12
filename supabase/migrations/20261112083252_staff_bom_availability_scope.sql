-- The legacy availability function is SECURITY DEFINER; its tenant argument
-- must not let an authenticated caller inspect another company's branch.
-- Keep the existing set-based availability calculation unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_bom_availability_guard(p_tenant uuid,p_branch uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); member boolean; exception_exists boolean; allowed boolean;
begin
 if p_tenant is null or p_branch is null or not exists(
  select 1 from public.branches b where b.id=p_branch and b.tenant_id=p_tenant
 ) then raise exception 'BOM_AVAILABILITY_BRANCH_DENIED' using errcode='42501';end if;
 if actor is null and coalesce(auth.role(),'')='service_role' then return true;end if;
 if actor is null or not exists(select 1 from public.profiles p where p.id=actor and p.tenant_id=p_tenant and p.is_active) then
  raise exception 'BOM_AVAILABILITY_AUTH_DENIED' using errcode='42501';end if;
 member:=coalesce(public.user_has_branch_access(actor,p_branch),false);
 if not member and not coalesce(public.user_has_permission(actor,'reports.view_all_branches'),false) then
  raise exception 'BOM_AVAILABILITY_BRANCH_DENIED' using errcode='42501';end if;
 select exists(select 1 from public.user_branch_permission_overrides o where o.tenant_id=p_tenant
  and o.user_id=actor and o.permission_code='inventory.view') into exception_exists;
 if exception_exists then
  allowed:=public._staff_permission_at_scope(actor,'inventory.view',p_branch)
   or (member and (public._staff_permission_at_scope(actor,'pos_retail.checkout',p_branch)
    or public._staff_permission_at_scope(actor,'pos_fnb.send_kitchen',p_branch)
    or public._staff_permission_at_scope(actor,'pos_fnb.checkout',p_branch)));
  if not coalesce(allowed,false) then raise exception 'BOM_AVAILABILITY_PERMISSION_DENIED' using errcode='42501';end if;
 end if;
 return true;
end $$;
revoke all on function public._staff_bom_availability_guard(uuid,uuid) from public,anon,authenticated;
do $migration$
declare source text; patched text;
 anchor text:='where public.should_cascade_bom_at_branch(s.sku, p_branch_id)';
 replacement text:='where public._staff_bom_availability_guard(p_tenant_id,p_branch_id) and exists(select 1 from public.products staff_sku where staff_sku.id=s.sku and staff_sku.tenant_id=p_tenant_id) and public.should_cascade_bom_at_branch(s.sku, p_branch_id)';
begin
 source:=pg_get_functiondef('public.get_bom_availability_batch(uuid,uuid,uuid[])'::regprocedure);
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then raise exception 'STAFF_BOM_AVAILABILITY_CONSUMER_CHANGED';end if;
 patched:=replace(source,anchor,replacement);
 execute patched;
end $migration$;
commit;
