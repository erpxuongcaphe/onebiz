\set ON_ERROR_STOP on
do $$begin
 if current_database()<>'onebiz_hub_scope_v8_20261114' or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE';end if;
end$$;
begin;
revoke select on public.audit_log from authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into public.tenants(id,name,slug) values ('11000000-0000-0000-0000-000000000001','Test','mkt-history-test'),('11000000-0000-0000-0000-000000000002','Other','mkt-history-other');
insert into auth.users(id) values ('22000000-0000-0000-0000-000000000001');
insert into public.branches(id,tenant_id,name,branch_type) values ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Test','store');
insert into public.roles(id,tenant_id,name) values ('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Staff');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values ('22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Staff','staff','44000000-0000-0000-0000-000000000001');
insert into public.mkt_campaigns(id,tenant_id,branch_id,name) values ('66000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Test'),('66000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000002',null,'Other tenant');
insert into public.mkt_channel_work_packages(id,tenant_id,campaign_id,channel_type,title) values ('77000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','other','Test'), ('77000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','other','Other'), ('77000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000002','66000000-0000-0000-0000-000000000002','other','Other tenant');
insert into public.mkt_channel_plans(id,tenant_id,work_package_id,campaign_id,owner_id) values
 ('aa000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001'),
 ('aa000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000002','66000000-0000-0000-0000-000000000001',null),
 ('aa000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000002','77000000-0000-0000-0000-000000000003','66000000-0000-0000-0000-000000000002',null);
insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','update','mkt_channel_plan','aa000000-0000-0000-0000-000000000001','{"status":"ready","token":"hidden"}');
select set_config('request.jwt.claim.sub','22000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$declare r record; denied boolean:=false;begin
 select * into r from public.staff_audit_entity_history('mkt_channel_plan','aa000000-0000-0000-0000-000000000001',80);
 if r.id is null or r.new_data->>'status'<>'ready' or r.new_data ? 'token' then raise exception 'OWNER_PLAN_HISTORY_FAILED';end if;
 begin perform * from public.staff_audit_entity_history('mkt_channel_plan','aa000000-0000-0000-0000-000000000002',80);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'UNAUTHORIZED_PLAN_HISTORY';end if;
end$$;
reset role;
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','mkt.manage_team');
set local role authenticated;
do $$declare denied boolean:=false;begin
 perform * from public.staff_audit_entity_history('mkt_channel_plan','aa000000-0000-0000-0000-000000000002',80);
 begin perform * from public.staff_audit_entity_history('mkt_channel_plan','aa000000-0000-0000-0000-000000000003',80);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'CROSS_TENANT_PLAN_HISTORY';end if;
end$$;
reset role;
update public.profiles set is_active=false where id='22000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform * from public.staff_audit_entity_history('mkt_channel_plan','aa000000-0000-0000-0000-000000000001',80);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'INACTIVE_PLAN_HISTORY';end if;
end$$;
rollback;
