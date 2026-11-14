\set ON_ERROR_STOP on
do $$begin if current_database() not in ('onebiz_hub_scope_20261114','onebiz_hub_scope_v2_20261114','onebiz_hub_scope_v3_20261114') or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE'; end if; end$$;
begin;
insert into public.tenants(id,name,slug) values ('11000000-0000-0000-0000-000000000001','Synthetic','hub-scope-test');
insert into auth.users(id) values ('22000000-0000-0000-0000-000000000002');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic A','store'),
 ('33000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','Synthetic B','store');
insert into public.roles(id,tenant_id,name) values ('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic staff');
insert into public.role_permissions(role_id,permission_code) values
 ('44000000-0000-0000-0000-000000000001','ops.view'),('44000000-0000-0000-0000-000000000001','ops.work');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values
 ('22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic staff','staff','44000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values ('22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002');
insert into public.ops_members(tenant_id,branch_id,user_id,member_role,capabilities,active) values
 ('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','manager',array['close_period'],true),
 ('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000002','manager',array['close_period'],true);
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values ('ops.view',1),('ops.close_period',1),('ops.verify',1);
select set_config('request.jwt.claim.sub','22000000-0000-0000-0000-000000000002',true);
create function pg_temp.ops_can_baseline(p_branch uuid,p_cap text) returns boolean language sql stable as $$
 select exists(select 1 from public.profiles p join public.branches b on b.tenant_id=p.tenant_id
 where p.id=auth.uid() and p.is_active and b.id=p_branch and b.is_active
 and public.ops_has_permission('ops.view') and public.ops_has_permission(case p_cap
  when 'view' then 'ops.view' when 'work' then 'ops.work' when 'verify' then 'ops.verify'
  when 'approve_policy' then 'ops.configure' when 'close_period' then 'ops.close_period'
  when 'cancel_todo' then 'ops.cancel_todo' when 'manage_members' then 'ops.manage_members' else null end)
 and (public.ops_ceo() or exists(select 1 from public.ops_members m where m.tenant_id=p.tenant_id and m.branch_id=b.id and m.user_id=p.id and m.active
  and ((p_cap='view' and m.member_role in ('manager','reviewer')) or p_cap=any(m.capabilities) or (p_cap='work' and m.member_role='manager')))
  or p_cap='view' and exists(select 1 from public.ops_q_grants g where g.tenant_id=p.tenant_id and g.branch_id=b.id and g.user_id=p.id and g.active
   and ((g.can_audit or g.can_correct) and public.ops_has_permission('ops.verify') or g.can_accounting and public.ops_has_permission('ops.work')))));
$$;
do $$begin
 if exists(select 1 from unnest(array['view','work','verify','approve_policy','close_period','cancel_todo','manage_members','unknown']) cap
  cross join unnest(array['33000000-0000-0000-0000-000000000001'::uuid,'33000000-0000-0000-0000-000000000002'::uuid]) branch
  where public.ops_can(branch,cap) is distinct from pg_temp.ops_can_baseline(branch,cap)) then raise exception 'LEGACY_MATRIX_CHANGED';end if;
 if not public.ops_can('33000000-0000-0000-0000-000000000001','view') or not public.ops_can('33000000-0000-0000-0000-000000000002','view') then raise exception 'LEGACY_SCOPE_CHANGED'; end if;
 if public.ops_can('33000000-0000-0000-0000-000000000001','close_period') then raise exception 'UNGRANTED_ALLOWED'; end if;
end$$;
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000001','ops.close_period','grant','22000000-0000-0000-0000-000000000002'),
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','ops.view','revoke','22000000-0000-0000-0000-000000000002');
do $$begin
 if not public.ops_can('33000000-0000-0000-0000-000000000001','close_period') then raise exception 'BRANCH_GRANT_NOT_APPLIED'; end if;
 if public.ops_can('33000000-0000-0000-0000-000000000002','close_period') or public.ops_can('33000000-0000-0000-0000-000000000002','view') then raise exception 'BRANCH_DENY_BYPASSED'; end if;
 if public.ops_manager('33000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000002') then raise exception 'MANAGER_DENY_BYPASSED'; end if;
 if not public.ops_person_eligible('33000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','membership')
  or public.ops_person_eligible('33000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000002','membership') then raise exception 'ELIGIBLE_PERSON_SCOPE_FAILED';end if;
end$$;
insert into public.ops_todos(id,tenant_id,branch_id,title,category,priority,assignee_id,collaborators,due_at,original_due_at,created_by) values
 ('55000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic A','other','normal','22000000-0000-0000-0000-000000000002',array['22000000-0000-0000-0000-000000000002'::uuid],now(),now(),'22000000-0000-0000-0000-000000000002'),
 ('55000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','Synthetic B','other','normal','22000000-0000-0000-0000-000000000002',array['22000000-0000-0000-0000-000000000002'::uuid],now(),now(),'22000000-0000-0000-0000-000000000002');
do $$declare page jsonb; workspace jsonb; filtered jsonb;begin
 if not public.ops_todo_visible('55000000-0000-0000-0000-000000000001') or public.ops_todo_visible('55000000-0000-0000-0000-000000000002') then raise exception 'COLLABORATOR_SCOPE_FAILED';end if;
 page:=public.ops_todo_page(null,'',false,null,null,null);
 if jsonb_array_length(page->'rows')<>1 or page->'rows'->0->>'title'<>'Synthetic A' then raise exception 'COLLABORATOR_PAGE_LEAK';end if;
 filtered:=public.ops_filtered_page('todo',null,'',false,'{}',null,null);
 if jsonb_array_length(filtered->'rows')<>1 or filtered->'rows'->0->>'title'<>'Synthetic A' then raise exception 'COLLABORATOR_FILTERED_PAGE_LEAK';end if;
 workspace:=public.ops_workspace(null,to_char(now() at time zone 'Asia/Ho_Chi_Minh','YYYY-MM'));
 if jsonb_array_length(workspace->'todos')<>1 or workspace->'todos'->0->>'title'<>'Synthetic A' then raise exception 'COLLABORATOR_WORKSPACE_LEAK';end if;
 perform public.ops_evidence_reserve_before_lifecycle('todo','55000000-0000-0000-0000-000000000001','test.png','image/png',32);
 begin
  perform public.ops_evidence_reserve_before_lifecycle('todo','55000000-0000-0000-0000-000000000002','test.png','image/png',32);
  raise exception 'EVIDENCE_SCOPE_BYPASSED';
 exception when raise_exception then if sqlerrm<>'OPS_FORBIDDEN' then raise;end if; end;
end$$;
update public.ops_members set member_role='reviewer' where branch_id='33000000-0000-0000-0000-000000000002';
insert into public.ops_q_grants(tenant_id,branch_id,user_id,can_audit,can_correct,can_accounting,active) values
 ('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000002',true,false,false,true);
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','ops.verify','grant','22000000-0000-0000-0000-000000000002');
do $$begin if public.ops_q_can('33000000-0000-0000-0000-000000000002','qc') then raise exception 'QC_VIEW_DENY_BYPASSED'; end if; end$$;
delete from public.user_branch_permission_overrides where branch_id='33000000-0000-0000-0000-000000000002' and permission_code='ops.view';
do $$begin
 if not public.ops_q_can('33000000-0000-0000-0000-000000000002','qc') then raise exception 'QC_BRANCH_GRANT_NOT_APPLIED'; end if;
 begin
  perform public.ops_quality_execute_core('qc_create',jsonb_build_object('branchId','33000000-0000-0000-0000-000000000002','period','bad'),gen_random_uuid());
  raise exception 'QC_INVALID_PERIOD_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'OPS_INVALID_RANGE' then raise;end if; end;
 begin
  perform public.ops_quality_execute_core('qc_create',jsonb_build_object('branchId','33000000-0000-0000-0000-000000000001','period','bad'),gen_random_uuid());
  raise exception 'QC_CROSS_BRANCH_ALLOWED';
 exception when raise_exception then if sqlerrm<>'OPS_FORBIDDEN' then raise;end if; end;
end$$;
insert into public.user_permission_overrides(tenant_id,user_id,permission_code,override_type) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','ops.verify','revoke');
do $$begin if public.ops_q_can('33000000-0000-0000-0000-000000000002','qc') then raise exception 'GLOBAL_DENY_BYPASSED'; end if; end$$;
delete from public.role_permissions where role_id='44000000-0000-0000-0000-000000000001' and permission_code='ops.view';
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000001','ops.view','grant','22000000-0000-0000-0000-000000000002');
do $$declare page jsonb;begin
 if coalesce((public.ops_access_context()->>'allowed')::boolean,false)=false then raise exception 'BRANCH_ONLY_HUB_ENTRY_DENIED';end if;
 page:=public.ops_todo_page(null,'',false,null,null,null);
 if jsonb_array_length(page->'rows')<>1 or page->'rows'->0->>'title'<>'Synthetic A' then raise exception 'BRANCH_ONLY_PAGE_SCOPE_FAILED';end if;
 perform public.ops_execute_core('comment',jsonb_build_object('branchId','33000000-0000-0000-0000-000000000001','id','55000000-0000-0000-0000-000000000001','note','Synthetic note'),gen_random_uuid());
 begin
  perform public.ops_execute_core('comment',jsonb_build_object('branchId','33000000-0000-0000-0000-000000000002','id','55000000-0000-0000-0000-000000000002','note','Synthetic note'),gen_random_uuid());
  raise exception 'COMMENT_CROSS_BRANCH_ALLOWED';
 exception when insufficient_privilege then if sqlerrm<>'OPS_FORBIDDEN' then raise;end if;end;
end$$;
insert into auth.users(id) values ('22000000-0000-0000-0000-000000000003');
insert into public.profiles(id,tenant_id,branch_id,full_name,role) values ('22000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic branch-only worker','staff');
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values ('ops.work',1);
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000003','33000000-0000-0000-0000-000000000001','ops.view','grant','22000000-0000-0000-0000-000000000002'),
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000003','33000000-0000-0000-0000-000000000001','ops.work','grant','22000000-0000-0000-0000-000000000002');
insert into public.ops_q_issues(id,tenant_id,branch_id,todo_id) values ('66000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001');
do $$declare v integer;begin
 select version into v from public.ops_todos where id='55000000-0000-0000-0000-000000000001';
 perform public.ops_quality_execute_core('issue_assign',jsonb_build_object('branchId','33000000-0000-0000-0000-000000000001','id','66000000-0000-0000-0000-000000000001','version',v,'note','Synthetic assignment','departmentId',null,'operatorId','22000000-0000-0000-0000-000000000003','collaborators',jsonb_build_array('22000000-0000-0000-0000-000000000003')),gen_random_uuid());
 if not exists(select 1 from public.ops_q_issues where id='66000000-0000-0000-0000-000000000001' and operator_id='22000000-0000-0000-0000-000000000003') then raise exception 'QC_BRANCH_ONLY_ASSIGNMENT_FAILED';end if;
end$$;
rollback;
