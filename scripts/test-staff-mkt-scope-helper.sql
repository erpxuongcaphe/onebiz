\set ON_ERROR_STOP on
do $$begin if current_database()<>'onebiz_hub_scope_20261114' or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE';end if;end$$;
begin;
insert into public.tenants(id,name,slug) values ('11000000-0000-0000-0000-000000000001','Synthetic','mkt-scope-a'),('11000000-0000-0000-0000-000000000002','Synthetic 2','mkt-scope-b');
insert into auth.users(id) values ('22000000-0000-0000-0000-000000000002');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic A','store'),
 ('33000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','Synthetic B','store');
insert into public.roles(id,tenant_id,name) values ('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic staff');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values ('22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic staff','staff','44000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values ('22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002');
insert into public.mkt_campaigns(id,tenant_id,branch_id,name) values
 ('66000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic A'),
 ('66000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','Synthetic B'),
 ('66000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001',null,'Synthetic shared'),
 ('66000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000002',null,'Synthetic other tenant');
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values ('mkt.view',1);
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000001','mkt.view','grant','22000000-0000-0000-0000-000000000002');
do $$declare u uuid:='22000000-0000-0000-0000-000000000002';begin
 if not public._staff_mkt_campaign_permission(u,'mkt.view','66000000-0000-0000-0000-000000000001')
  or public._staff_mkt_campaign_permission(u,'mkt.view','66000000-0000-0000-0000-000000000002')
  or public._staff_mkt_campaign_permission(u,'mkt.view','66000000-0000-0000-0000-000000000003')
  or public._staff_mkt_campaign_permission(u,'mkt.view','66000000-0000-0000-0000-000000000004') then raise exception 'MKT_BRANCH_SCOPE_FAILED';end if;
 if has_function_privilege('authenticated','public._staff_mkt_campaign_permission(uuid,text,uuid)','execute') or has_function_privilege('anon','public._staff_mkt_campaign_permission(uuid,text,uuid)','execute') then raise exception 'MKT_PRIVATE_HELPER_EXPOSED';end if;
end$$;
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','mkt.view');
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','mkt.view','revoke','22000000-0000-0000-0000-000000000002');
do $$declare u uuid:='22000000-0000-0000-0000-000000000002';begin
 if public._staff_mkt_campaign_permission(u,'mkt.view','66000000-0000-0000-0000-000000000002') or not public._staff_mkt_campaign_permission(u,'mkt.view','66000000-0000-0000-0000-000000000003') then raise exception 'MKT_SHARED_OR_DENY_FAILED';end if;
end$$;
insert into public.user_permission_overrides(tenant_id,user_id,permission_code,override_type) values ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','mkt.view','revoke');
do $$begin if public._staff_mkt_campaign_permission('22000000-0000-0000-0000-000000000002','mkt.view','66000000-0000-0000-0000-000000000001') then raise exception 'MKT_GLOBAL_DENY_BYPASSED';end if;end$$;
rollback;
