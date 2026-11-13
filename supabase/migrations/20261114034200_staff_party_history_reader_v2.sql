-- Versioned history reader keeps activity branch visibility and debt-field
-- visibility independent, including for mixed-branch results.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$
declare source text; patched text; sig constant text:='public.get_party_history_scoped(text,uuid,uuid,integer,integer)';
begin
 if to_regprocedure('public._staff_party_directory_scope_v2_private(text,uuid,boolean)') is null
   or to_regprocedure(sig) is null or not exists(select 1 from pg_proc where oid=to_regprocedure(sig)
     and prosecdef and md5(replace(prosrc,chr(13),''))='67a489348a197761a6197c5f8103fbab') then
  raise exception 'PARTY_HISTORY_V2_BASELINE_CHANGED';
 end if;
 if to_regprocedure('public.get_party_history_scoped_v2(text,uuid,uuid,integer,integer)') is not null then
  raise exception 'PARTY_HISTORY_V2_ALREADY_EXISTS';
 end if;
 source:=pg_get_functiondef(to_regprocedure(sig));
 if position('declare s jsonb; tenant uuid; ids uuid[]; can_debt boolean; defaults jsonb; result jsonb;' in source)=0
  or position('s:=public._party_directory_scope_private(p_mode,p_branch_id,false);' in source)=0
  or position('ids:=array(select jsonb_array_elements_text(s->''branchIds'')::uuid);' in source)=0
  or position('can_debt:=(s->>''canViewDebt'')::boolean;' in source)=0
  or position('case when s->>''scope''=''company'' then l.balance_after end' in source)=0
  or position('(s->>''scope''=''company'' and coalesce(l.reference_type,'''') not in' in source)=0 then
  raise exception 'PARTY_HISTORY_V2_ANCHOR_CHANGED';
 end if;
 patched:=replace(source,'public.get_party_history_scoped(','public.get_party_history_scoped_v2(');
 patched:=replace(patched,'declare s jsonb; tenant uuid; ids uuid[]; can_debt boolean; defaults jsonb; result jsonb;',
   'declare s jsonb; tenant uuid; ids uuid[]; debt_ids uuid[]; can_debt boolean; defaults jsonb; result jsonb;');
 patched:=replace(patched,'s:=public._party_directory_scope_private(p_mode,p_branch_id,false);',
   's:=public._staff_party_directory_scope_v2_private(p_mode,p_branch_id,false);');
 patched:=replace(patched,'ids:=array(select jsonb_array_elements_text(s->''branchIds'')::uuid);',
   'ids:=array(select jsonb_array_elements_text(s->''activityBranchIds'')::uuid); debt_ids:=array(select jsonb_array_elements_text(s->''debtBranchIds'')::uuid);');
 patched:=replace(patched,'can_debt:=(s->>''canViewDebt'')::boolean;',
   'can_debt:=cardinality(debt_ids)>0;');
 patched:=replace(patched,'case when can_debt then coalesce(i.paid,0) end',
   'case when i.branch_id=any(debt_ids) then coalesce(i.paid,0) end');
 patched:=replace(patched,'case when can_debt then coalesce(i.debt,0) end',
   'case when i.branch_id=any(debt_ids) then coalesce(i.debt,0) end');
 patched:=replace(patched,'case when can_debt then coalesce(p.paid,0) end',
   'case when p.branch_id=any(debt_ids) then coalesce(p.paid,0) end');
 patched:=replace(patched,'case when can_debt then case when p.status=''cancelled''',
   'case when p.branch_id=any(debt_ids) then case when p.status=''cancelled''');
 patched:=replace(patched,'case when s->>''scope''=''company'' then l.balance_after end',
   'case when s->>''scope''=''company'' and cardinality(ids)=jsonb_array_length(s->''branchIds'') then l.balance_after end');
 patched:=replace(patched,'(s->>''scope''=''company'' and coalesce(l.reference_type,'''') not in',
   '(s->>''scope''=''company'' and cardinality(ids)=jsonb_array_length(s->''branchIds'') and coalesce(l.reference_type,'''') not in');
 patched:=replace(patched,'''branchId'',p_branch_id,''canViewDebt'',can_debt,',
   '''branchId'',p_branch_id,''canViewDebt'',can_debt,''scope'',s->>''scope'',''branchIds'',s->''branchIds'',''activityBranchIds'',s->''activityBranchIds'',''debtBranchIds'',s->''debtBranchIds'',');
 if patched=source or position('case when can_debt then coalesce(i.paid,0) end' in patched)>0
   or position('case when can_debt then coalesce(i.debt,0) end' in patched)>0
   or position('case when can_debt then coalesce(p.paid,0) end' in patched)>0
   or position('case when can_debt then case when p.status=''cancelled''' in patched)>0
   or position('''activityBranchIds'',s->''activityBranchIds''' in patched)=0 then
  raise exception 'PARTY_HISTORY_V2_REWRITE_FAILED';
 end if;
 execute patched;
end$$;
revoke all on function public.get_party_history_scoped_v2(text,uuid,uuid,integer,integer) from public,anon;
grant execute on function public.get_party_history_scoped_v2(text,uuid,uuid,integer,integer) to authenticated,service_role;
commit;
