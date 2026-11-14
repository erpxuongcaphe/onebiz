-- Add versioned directory readers. Old readers and their ACLs remain unchanged;
-- cutover guards and UI labels must be ready before branch overrides are enabled.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $$
declare item record; source text; patched text; result_oid regprocedure;
begin
 if to_regprocedure('public._staff_party_directory_scope_v2_private(text,uuid,boolean)') is null then
  raise exception 'PARTY_DIRECTORY_SCOPE_V2_MISSING';
 end if;
 for item in select * from (values
  ('customer','get_customer_list_workspace_scoped',
   'public.get_customer_list_workspace_scoped(integer,integer,text,text,uuid[],text,text,text,text,text,text,integer,text[],timestamptz,timestamptz,text,uuid,boolean,text,boolean)',
   'ca248f13be0e805d76520513d7fcb798'),
  ('supplier','get_supplier_list_workspace_scoped',
   'public.get_supplier_list_workspace_scoped(integer,integer,text,text,text[],timestamptz,timestamptz,text,numeric,numeric,numeric,numeric,uuid,boolean,text,boolean)',
   'b59c7abf0c693e528b567aa940e7cd8a')
 ) v(mode,name,signature,expected_hash) loop
  if to_regprocedure(item.signature) is null or not exists(select 1 from pg_proc
      where oid=to_regprocedure(item.signature) and prosecdef and md5(replace(prosrc,chr(13),''))=item.expected_hash) then
   raise exception 'PARTY_DIRECTORY_READER_BASELINE_CHANGED: %',item.mode;
  end if;
  if to_regprocedure(replace(item.signature,item.name,item.name||'_v2')) is not null then
   raise exception 'PARTY_DIRECTORY_READER_V2_ALREADY_EXISTS: %',item.mode;
  end if;
  source:=pg_get_functiondef(to_regprocedure(item.signature));
  if position(format('public.%s(',item.name) in source)=0
    or position(format('public._party_directory_scope_private(%L,p_branch_id,p_for_export)',item.mode) in source)=0
    or position('v_branches:=array(select jsonb_array_elements_text(v_scope->''branchIds'')::uuid);' in source)=0
    or position('public._party_directory_balances_private(v_tenant,v_branches)' in source)=0 then
   raise exception 'PARTY_DIRECTORY_READER_ANCHOR_CHANGED: %',item.mode;
  end if;
  patched:=replace(source,format('public.%s(',item.name),format('public.%s_v2(',item.name));
  patched:=replace(patched,format('public._party_directory_scope_private(%L,p_branch_id,p_for_export)',item.mode),
    format('public._staff_party_directory_scope_v2_private(%L,p_branch_id,p_for_export)',item.mode));
  patched:=replace(patched,'v_branches:=array(select jsonb_array_elements_text(v_scope->''branchIds'')::uuid);',
    'v_branches:=array(select jsonb_array_elements_text(v_scope->''activityBranchIds'')::uuid);');
  patched:=replace(patched,'public._party_directory_balances_private(v_tenant,v_branches)',
    'public._party_directory_balances_private(v_tenant,array(select jsonb_array_elements_text(v_scope->''debtBranchIds'')::uuid))');
  execute patched;
  select p.oid::regprocedure into result_oid from pg_proc p where p.pronamespace='public'::regnamespace
    and p.proname=item.name||'_v2';
  if result_oid is null then raise exception 'PARTY_DIRECTORY_V2_CREATE_FAILED: %',item.mode; end if;
  execute format('revoke all on function %s from public,anon',result_oid);
  execute format('grant execute on function %s to authenticated,service_role',result_oid);
 end loop;
end$$;
commit;
