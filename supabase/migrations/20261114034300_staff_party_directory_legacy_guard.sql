-- V1 cannot represent different metric scopes. Mask only the metric with a
-- branch exception, leaving unrelated finance workflows and other metrics intact.
-- V2 uses the separately captured private base gate and returns exact scopes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$
declare source text; patched text;
 activity_anchor constant text:='''canViewActivity'',cardinality(ids)>0 and public.user_has_permission(actor,prefix||case p_mode when ''customer'' then ''.view_sales'' else ''.view_purchases'' end)';
 debt_anchor constant text:='''canViewDebt'',cardinality(ids)>0 and public.user_has_permission(actor,prefix||''.view_debt'')';
begin
 if to_regprocedure('public._staff_party_directory_scope_base_private(text,uuid,boolean)') is null
   or to_regprocedure('public._staff_party_directory_scope_v2_private(text,uuid,boolean)') is null
   or not exists(select 1 from pg_proc where oid='public._party_directory_scope_private(text,uuid,boolean)'::regprocedure
     and prosecdef and md5(replace(prosrc,chr(13),''))='96cc3a850d4326e32db540795c87b120') then
  raise exception 'PARTY_LEGACY_SCOPE_BASELINE_CHANGED';
 end if;
 source:=pg_get_functiondef('public._party_directory_scope_private(text,uuid,boolean)'::regprocedure);
 if position(activity_anchor in source)=0 or position(debt_anchor in source)=0
  or (length(source)-length(replace(source,activity_anchor,'')))/length(activity_anchor)<>1
  or (length(source)-length(replace(source,debt_anchor,'')))/length(debt_anchor)<>1 then
  raise exception 'PARTY_LEGACY_SCOPE_ANCHOR_CHANGED';
 end if;
 patched:=replace(source,activity_anchor,activity_anchor||$guard$ and not exists(
  select 1 from public.user_branch_permission_overrides o where o.tenant_id=tenant and o.user_id=actor
   and o.permission_code=prefix||case p_mode when 'customer' then '.view_sales' else '.view_purchases' end)$guard$);
 patched:=replace(patched,debt_anchor,debt_anchor||$guard$ and not exists(
  select 1 from public.user_branch_permission_overrides o where o.tenant_id=tenant and o.user_id=actor
   and o.permission_code=prefix||'.view_debt')$guard$);
 execute patched;
end$$;
commit;
