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
insert into public.role_permissions(role_id,permission_code) values
 ('44000000-0000-0000-0000-000000000001','reports.analytics'),
 ('44000000-0000-0000-0000-000000000001','reports.view_detail'),
 ('44000000-0000-0000-0000-000000000001','reports.view_all_branches'),
 ('44000000-0000-0000-0000-000000000001','finance.view_cash_book');
do $$declare r jsonb; begin
 r:=public.get_customer_report_balances_v1('33000000-0000-0000-0000-000000000001',false);
 if not (r->>'can_view_debt')::boolean then raise exception 'SELECTED_BRANCH_GRANT_IGNORED %',r;end if;
 r:=public.get_customer_report_balances_v1('33000000-0000-0000-0000-000000000002',false);
 if (r->>'can_view_debt')::boolean or r->'total_receivable'<>'null'::jsonb then raise exception 'UNAUTHORIZED_BRANCH_EXPOSED %',r;end if;
 r:=public.get_customer_report_balances_v1(null,false);
 if (r->>'can_view_debt')::boolean or r->'total_receivable'<>'null'::jsonb then raise exception 'MIXED_SCOPE_COMPANY_TOTAL_EXPOSED %',r;end if;
 begin perform public.get_party_debt_movements('customer','55000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','2026-01-01','2026-12-31');raise exception 'UNAUTHORIZED_DEBT_MOVEMENTS';exception when insufficient_privilege then null;end;
 perform public.get_party_debt_movements('customer','55000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','2026-01-01','2026-12-31');
end$$;
delete from public.role_permissions where role_id='44000000-0000-0000-0000-000000000001' and permission_code='finance.view_cash_book';
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','suppliers.view_debt','grant','22000000-0000-0000-0000-000000000001');
do $$begin
 perform public.get_document_payment_history_scoped('purchase_order','88000000-0000-0000-0000-000000000001',0,100);
 begin perform public.get_document_payment_history_scoped('purchase_order','88000000-0000-0000-0000-000000000002',0,100);raise exception 'UNAUTHORIZED_PAYMENT_HISTORY';exception when insufficient_privilege then null;end;
end$$;
-- An independent cash-book permission must retain its existing access.
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','finance.view_cash_book');
do $$begin perform public.get_document_payment_history_scoped('purchase_order','88000000-0000-0000-0000-000000000002',0,100);end$$;
delete from public.user_branch_permission_overrides where user_id='22000000-0000-0000-0000-000000000001' and permission_code='customers.view_debt';
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','customers.view_debt');
do $$declare r jsonb;begin
 r:=public.get_customer_report_balances_v1(null,false);
 if not (r->>'can_view_debt')::boolean then raise exception 'LEGACY_GLOBAL_ACCESS_CHANGED %',r;end if;
end$$;
rollback;
