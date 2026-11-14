\set ON_ERROR_STOP on
do $$begin if current_database()<>'onebiz_ops_rehearsal_v1' or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE'; end if; end$$;
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
do $$begin
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
end$$;
update public.ops_members set member_role='reviewer' where branch_id='33000000-0000-0000-0000-000000000002';
insert into public.ops_q_grants(tenant_id,branch_id,user_id,can_audit,can_correct,can_accounting,active) values
 ('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000002',true,false,false,true);
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','ops.verify','grant','22000000-0000-0000-0000-000000000002');
do $$begin if public.ops_q_can('33000000-0000-0000-0000-000000000002','qc') then raise exception 'QC_VIEW_DENY_BYPASSED'; end if; end$$;
delete from public.user_branch_permission_overrides where branch_id='33000000-0000-0000-0000-000000000002' and permission_code='ops.view';
do $$begin if not public.ops_q_can('33000000-0000-0000-0000-000000000002','qc') then raise exception 'QC_BRANCH_GRANT_NOT_APPLIED'; end if; end$$;
insert into public.user_permission_overrides(tenant_id,user_id,permission_code,override_type) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','ops.verify','revoke');
do $$begin if public.ops_q_can('33000000-0000-0000-0000-000000000002','qc') then raise exception 'GLOBAL_DENY_BYPASSED'; end if; end$$;
rollback;
