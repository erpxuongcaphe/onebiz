CREATE OR REPLACE FUNCTION public._party_directory_scope_private(p_mode text, p_branch uuid, p_export boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); tenant uuid; ids uuid[]; prefix text; all_branches boolean;
begin
 if p_mode is null or p_mode not in ('customer','supplier') then raise exception 'PARTY_MODE_INVALID' using errcode='22023'; end if;
 select tenant_id into tenant from public.profiles where id=actor and coalesce(is_active,true);
 if tenant is null then raise exception 'PARTY_ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 prefix:=case p_mode when 'customer' then 'customers' else 'suppliers' end;
 if not public.user_has_permission(actor,prefix||'.view') then raise exception 'PARTY_CONTACT_DENIED' using errcode='42501'; end if;
 if p_export and not public.user_has_permission(actor,prefix||'.export') then raise exception 'PARTY_EXPORT_DENIED' using errcode='42501'; end if;
 all_branches:=public.user_has_permission(actor,'reports.view_all_branches');
 if p_branch is not null then
  if not exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=tenant)
   or not (all_branches or public.user_has_branch_access(actor,p_branch)) then
   raise exception 'PARTY_BRANCH_DENIED' using errcode='42501'; end if;
  ids:=array[p_branch];
 else
  select coalesce(array_agg(b.id order by b.id),'{}'::uuid[]) into ids from public.branches b
  where b.tenant_id=tenant and (all_branches or public.user_has_branch_access(actor,b.id));
 end if;
 return jsonb_build_object('tenant',tenant,'branchIds',to_jsonb(ids),'scope',
  case when p_branch is not null then 'branch' when all_branches then 'company' else 'assigned' end,
  'canViewActivity',cardinality(ids)>0 and public.user_has_permission(actor,prefix||case p_mode when 'customer' then '.view_sales' else '.view_purchases' end),
  'canViewDebt',cardinality(ids)>0 and public.user_has_permission(actor,prefix||'.view_debt'));
end $function$
