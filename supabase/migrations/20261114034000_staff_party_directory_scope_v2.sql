-- Additive private scope calculation for customer/supplier directory v2.
-- Not exposed to clients until the corresponding versioned readers, legacy
-- cutover and UI scope labels are implemented and tested together.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $$declare source text; begin
 if to_regprocedure('public._party_directory_scope_private(text,uuid,boolean)') is null
   or not exists(select 1 from pg_proc where oid='public._party_directory_scope_private(text,uuid,boolean)'::regprocedure
     and prosecdef and md5(replace(prosrc,chr(13),''))='96cc3a850d4326e32db540795c87b120')
   or to_regprocedure('public._staff_permission_at_scope(uuid,text,uuid)') is null then
  raise exception 'PARTY_DIRECTORY_SCOPE_BASELINE_CHANGED';
 end if;
 if to_regprocedure('public._staff_party_directory_scope_v2_private(text,uuid,boolean)') is not null then
  raise exception 'PARTY_DIRECTORY_SCOPE_V2_ALREADY_EXISTS';
 end if;
 if to_regprocedure('public._staff_party_directory_scope_base_private(text,uuid,boolean)') is not null then
  raise exception 'PARTY_DIRECTORY_SCOPE_BASE_ALREADY_EXISTS';
 end if;
 source:=pg_get_functiondef('public._party_directory_scope_private(text,uuid,boolean)'::regprocedure);
 if position('public._party_directory_scope_private(' in source)=0 then raise exception 'PARTY_DIRECTORY_SCOPE_NAME_CHANGED';end if;
 execute replace(source,'public._party_directory_scope_private(','public._staff_party_directory_scope_base_private(');
end$$;
revoke all on function public._staff_party_directory_scope_base_private(text,uuid,boolean)
 from public,anon,authenticated,service_role;

create function public._staff_party_directory_scope_v2_private(p_mode text,p_branch uuid,p_export boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; actor uuid:=auth.uid(); ids uuid[]; activity_ids uuid[]; debt_ids uuid[]; prefix text;
begin
 -- The existing private gate validates the active actor, tenant, party view,
 -- export right and requested branch before producing the permitted scope.
 base:=public._staff_party_directory_scope_base_private(p_mode,p_branch,p_export);
 ids:=array(select jsonb_array_elements_text(base->'branchIds')::uuid);
 prefix:=case p_mode when 'customer' then 'customers' else 'suppliers' end;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into activity_ids
 from unnest(ids) id where public._staff_permission_at_scope(actor,
   prefix||case p_mode when 'customer' then '.view_sales' else '.view_purchases' end,id);
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into debt_ids
 from unnest(ids) id where public._staff_permission_at_scope(actor,prefix||'.view_debt',id);
 return base||jsonb_build_object('activityBranchIds',to_jsonb(activity_ids),
   'debtBranchIds',to_jsonb(debt_ids),'canViewActivity',cardinality(activity_ids)>0,
   'canViewDebt',cardinality(debt_ids)>0);
end$$;
revoke all on function public._staff_party_directory_scope_v2_private(text,uuid,boolean)
 from public,anon,authenticated,service_role;
commit;
