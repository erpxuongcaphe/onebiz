\set ON_ERROR_STOP on
do $$begin
 if current_database()<>'onebiz_hub_scope_v6_20261114' or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE'; end if;
end$$;
begin;
insert into public.tenants(id,name,slug) values ('11000000-0000-0000-0000-000000000001','Synthetic','export-scope-test');
insert into auth.users(id) values ('22000000-0000-0000-0000-000000000002');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','A','store'),
 ('33000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','B','store');
insert into public.roles(id,tenant_id,name) values ('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values ('22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic','staff','44000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values ('22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002');
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000001','orders.export','grant','22000000-0000-0000-0000-000000000002'),
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','invoices.export','grant','22000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','22000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$begin
 if not public._staff_invoice_item_read('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','order')
  or public._staff_invoice_item_read('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','pos')
  or not public._staff_invoice_item_read('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','pos') then
  raise exception 'DOCUMENT_EXPORT_SCOPE_FAILED';
 end if;
end$$;
reset role;
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','invoices.export');
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000001','invoices.export','revoke','22000000-0000-0000-0000-000000000002');
set local role authenticated;
do $$begin
 if public._staff_invoice_item_read('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','pos')
  or not public._staff_invoice_item_read('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','pos') then
  raise exception 'DOCUMENT_EXPORT_REVOKE_FAILED';
 end if;
end$$;
rollback;
