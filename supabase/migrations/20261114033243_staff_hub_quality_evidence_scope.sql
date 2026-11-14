-- Branch-aware permission checks for QC operations, eligible people and
-- evidence. Kept separate from releasing the branch permission catalogue.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare x record; begin
 for x in select * from (values
  ('public.ops_quality_execute_core(text,jsonb,uuid)','1633744f34fa3ada80990aa704371719'),
  ('public.ops_evidence_reserve_before_lifecycle(text,uuid,text,text,bigint)','5cdd919c031086db7726b2e5a6c48ace'),
  ('public.ops_person_eligible(uuid,uuid,text)','5a89d168e8826cf151616e1d12cfe794'),
  ('public.ops_q_new_issue(uuid,jsonb,uuid)','473e7a9603dccaea1d6890c573a8a6be'),
  ('public.ops_quality_execute_before_lifecycle(text,jsonb,uuid)','9c4902111487596ed1b7d298db464076')
 ) as v(signature,expected) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(x.signature) and p.prosecdef and md5(replace(p.prosrc,chr(13),''))=x.expected) then
   raise exception 'HUB_QUALITY_BRANCH_BASELINE_CHANGED: %',x.signature;
  end if;
 end loop;
end$$;
do $$declare body text; patched text; sig text; begin
 sig:='public.ops_quality_execute_core(text,jsonb,uuid)';
 select replace(pg_get_functiondef(to_regprocedure(sig)),chr(13),'') into body;
 if position('public.ops_has_permission(''ops.view'')' in body)=0
  or position('public.ops_has_permission(''ops.work'')' in body)=0
  or position('public.user_has_permission(id,''ops.view'')' in body)=0
  or position('public.user_has_permission(id,''ops.work'')' in body)=0 then raise exception 'HUB_QUALITY_PATCH_MISSING';end if;
 patched:=replace(body,'public.ops_has_permission(''ops.view'')','public._staff_permission_at_scope(p.id,''ops.view'',b)');
 patched:=replace(patched,'public.ops_has_permission(''ops.work'')','public._staff_permission_at_scope(p.id,''ops.work'',b)');
 patched:=replace(patched,'public.user_has_permission(id,''ops.view'')','public._staff_permission_at_scope(id,''ops.view'',b)');
 patched:=replace(patched,'public.user_has_permission(id,''ops.work'')','public._staff_permission_at_scope(id,''ops.work'',b)');
 if position('public.user_has_permission(pr.id,''ops.view'')' in patched)=0 or position('public.user_has_permission(pr.id,''ops.work'')' in patched)=0 then raise exception 'HUB_QUALITY_COLLABORATOR_PATCH_MISSING';end if;
 patched:=replace(patched,'public.user_has_permission(pr.id,''ops.view'')','public._staff_permission_at_scope(pr.id,''ops.view'',b)');
 patched:=replace(patched,'public.user_has_permission(pr.id,''ops.work'')','public._staff_permission_at_scope(pr.id,''ops.work'',b)');
 execute patched;

 sig:='public.ops_evidence_reserve_before_lifecycle(text,uuid,text,text,bigint)';
 select replace(pg_get_functiondef(to_regprocedure(sig)),chr(13),'') into body;
 if position('public.ops_has_permission(''ops.view'')' in body)=0 or position('public.ops_has_permission(''ops.work'')' in body)=0 then raise exception 'HUB_EVIDENCE_PATCH_MISSING';end if;
 patched:=replace(body,'public.ops_has_permission(''ops.view'')','public._staff_hub_any_view(p.id)');
 patched:=replace(patched,'public.ops_has_permission(''ops.work'')','public._staff_permission_at_scope(p.id,''ops.work'',t.branch_id)');
 execute patched;

 sig:='public.ops_person_eligible(uuid,uuid,text)';
 select replace(pg_get_functiondef(to_regprocedure(sig)),chr(13),'') into body;
 if position('public.user_has_permission(u,''ops.view'')' in body)=0 or position('public.user_has_permission(u,''ops.work'')' in body)=0 or position('public.user_has_permission(u,''ops.verify'')' in body)=0 then raise exception 'HUB_ELIGIBLE_PATCH_MISSING';end if;
 patched:=replace(body,'public.user_has_permission(u,''ops.view'')','public._staff_permission_at_scope(u,''ops.view'',b)');
 patched:=replace(patched,'public.user_has_permission(u,''ops.work'')','public._staff_permission_at_scope(u,''ops.work'',b)');
 patched:=replace(patched,'public.user_has_permission(u,''ops.verify'')','public._staff_permission_at_scope(u,''ops.verify'',b)');
 execute patched;

 sig:='public.ops_q_new_issue(uuid,jsonb,uuid)';
 select replace(pg_get_functiondef(to_regprocedure(sig)),chr(13),'') into body;
 if position('public.user_has_permission(id,''ops.view'')' in body)=0 or position('public.user_has_permission(id,''ops.work'')' in body)=0 then raise exception 'HUB_NEW_ISSUE_PATCH_MISSING';end if;
 patched:=replace(body,'public.user_has_permission(id,''ops.view'')','public._staff_permission_at_scope(id,''ops.view'',p_branch)');
 patched:=replace(patched,'public.user_has_permission(id,''ops.work'')','public._staff_permission_at_scope(id,''ops.work'',p_branch)');
 execute patched;

 sig:='public.ops_quality_execute_before_lifecycle(text,jsonb,uuid)';
 select replace(pg_get_functiondef(to_regprocedure(sig)),chr(13),'') into body;
 if position('public.user_has_permission(u,''ops.view'')' in body)=0 or position('public.user_has_permission(u,''ops.work'')' in body)=0 then raise exception 'HUB_QUALITY_DEPARTMENT_PATCH_MISSING';end if;
 patched:=replace(body,'public.user_has_permission(u,''ops.view'')','public._staff_permission_at_scope(u,''ops.view'',b)');
 patched:=replace(patched,'public.user_has_permission(u,''ops.work'')','public._staff_permission_at_scope(u,''ops.work'',b)');
 execute patched;
end$$;
commit;
