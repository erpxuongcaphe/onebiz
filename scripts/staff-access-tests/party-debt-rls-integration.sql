\set ON_ERROR_STOP on
do $$begin
 if current_database()<>'onebiz_floor_rehearsal_v2' or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE'; end if;
 if has_function_privilege('authenticated','public._staff_party_directory_scope_v2_private(text,uuid,boolean)','EXECUTE') or has_function_privilege('anon','public._staff_party_directory_scope_v2_private(text,uuid,boolean)','EXECUTE') then raise exception 'PRIVATE_HELPER_EXPOSED';end if;
end$$;
begin;
insert into public.tenants(id,name,slug) values ('11000000-0000-0000-0000-000000000001','Synthetic','party-synthetic');
insert into auth.users(id) values ('22000000-0000-0000-0000-000000000001');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic A','store'),
 ('33000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','Synthetic B','store'),
 ('33000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','Synthetic C','store');
insert into public.roles(id,tenant_id,name) values ('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic staff');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values ('22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic staff','staff','44000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values ('22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002');
insert into public.role_permissions(role_id,permission_code) values
 ('44000000-0000-0000-0000-000000000001','customers.view'),
 ('44000000-0000-0000-0000-000000000001','customers.view_sales'),
 ('44000000-0000-0000-0000-000000000001','suppliers.view'),
 ('44000000-0000-0000-0000-000000000001','suppliers.view_purchases');
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values ('customers.view_sales',1),('customers.view_debt',1),('suppliers.view_purchases',1),('suppliers.view_debt',1) on conflict do nothing;
select set_config('request.jwt.claim.sub','22000000-0000-0000-0000-000000000001',true);
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','customers.view_sales','revoke','22000000-0000-0000-0000-000000000001'),
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','customers.view_debt','grant','22000000-0000-0000-0000-000000000001'),
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','suppliers.view_purchases','revoke','22000000-0000-0000-0000-000000000001');
do $$declare s jsonb; begin
 s:=public._staff_party_directory_scope_v2_private('customer',null,false);
 if s->'branchIds'<>'["33000000-0000-0000-0000-000000000001","33000000-0000-0000-0000-000000000002"]'::jsonb or s->'activityBranchIds'<>'["33000000-0000-0000-0000-000000000002"]'::jsonb or s->'debtBranchIds'<>'["33000000-0000-0000-0000-000000000001"]'::jsonb then raise exception 'CUSTOMER_BRANCH_SCOPE_MISMATCH %',s; end if;
 s:=public._staff_party_directory_scope_v2_private('supplier',null,false);
 if s->'activityBranchIds'<>'["33000000-0000-0000-0000-000000000001"]'::jsonb or s->'debtBranchIds'<>'[]'::jsonb then raise exception 'SUPPLIER_BRANCH_SCOPE_MISMATCH %',s; end if;
 s:=public._staff_party_directory_scope_v2_private('customer','33000000-0000-0000-0000-000000000001',false);
 if (s->>'canViewActivity')::boolean or not (s->>'canViewDebt')::boolean then raise exception 'SELECTED_BRANCH_SCOPE_MISMATCH %',s; end if;
 begin perform public._staff_party_directory_scope_v2_private('customer','33000000-0000-0000-0000-000000000003',false); raise exception 'UNASSIGNED_BRANCH_ACCEPTED'; exception when insufficient_privilege then null; end;
 begin perform public._staff_party_directory_scope_v2_private('customer',null,true); raise exception 'EXPORT_WITHOUT_PERMISSION_ACCEPTED'; exception when insufficient_privilege then null; end;
end$$;
insert into public.customers(id,tenant_id,code,name) values ('55000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','KL-VL','Khách lẻ');
insert into public.suppliers(id,tenant_id,code,name) values ('66000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','SYN-S','Synthetic supplier');
insert into public.invoices(id,tenant_id,branch_id,code,created_by,customer_id,status,total) values
 ('77000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','SYN-A','22000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001','completed',100),
 ('77000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','SYN-B','22000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001','completed',250);
insert into public.purchase_orders(id,tenant_id,branch_id,code,created_by,supplier_id,supplier_name,status,total) values
 ('88000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','SYN-PA','22000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','Synthetic supplier','completed',70),
 ('88000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','SYN-PB','22000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','Synthetic supplier','completed',300);
insert into public.debt_opening_balances(tenant_id,branch_id,party_type,customer_id,amount,opening_date) values
 ('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','customer','55000000-0000-0000-0000-000000000001',70,'2026-01-01'),
 ('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','customer','55000000-0000-0000-0000-000000000001',300,'2026-01-01');
set local role authenticated;
do $$declare n integer;begin
 if not public.staff_my_party_debt_view('33000000-0000-0000-0000-000000000001','customer') then raise exception 'GRANT_DENIED';end if;
 if public.staff_my_party_debt_view('33000000-0000-0000-0000-000000000002','customer') then raise exception 'UNAUTHORIZED_BRANCH_GRANTED';end if;
 select count(*) into n from public.debt_opening_balances;
 if n<>1 then raise exception 'RLS_SCOPE_FAILED %',n;end if;
end$$;
reset role;
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','customers.import');
set local role authenticated;
do $$declare n integer;begin select count(*) into n from public.debt_opening_balances;
 if n<>2 then raise exception 'INDEPENDENT_IMPORT_ACCESS_CHANGED %',n;end if;end$$;
reset role;
rollback;