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
 ('44000000-0000-0000-0000-000000000001','finance.create_transaction'),
 ('44000000-0000-0000-0000-000000000001','finance.view_cash_book'),
 ('44000000-0000-0000-0000-000000000001','finance.void_transaction');
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','suppliers.view_debt','grant','22000000-0000-0000-0000-000000000001');
insert into public.money_accounts(id,tenant_id,branch_id,code,name,kind,created_by) values
 ('aa000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','SYN-CASH','Synthetic cash','cash','22000000-0000-0000-0000-000000000001');
select public.record_supplier_advance('66000000-0000-0000-0000-000000000001',100,'cash','Synthetic advance','33000000-0000-0000-0000-000000000001',null);
select public.record_supplier_advance('66000000-0000-0000-0000-000000000001',200,'cash','Synthetic advance B','33000000-0000-0000-0000-000000000002',null);
set local role authenticated;
do $$declare n integer;begin
 select count(*) into n from public.supplier_advances;
 if n<>1 then raise exception 'DIRECT_SUPPLIER_ADVANCE_SCOPE_FAILED %',n;end if;
end$$;
reset role;
do $$declare ledger jsonb; detail jsonb; a jsonb;b jsonb;begin
 ledger:=public.get_party_advance_ledger('supplier','66000000-0000-0000-0000-000000000001',null);
 if jsonb_array_length(ledger)<>1 or ledger->0->>'branchId'<>'33000000-0000-0000-0000-000000000001' then raise exception 'ADVANCE_LEDGER_SCOPE_FAILED %',ledger;end if;
 detail:=public.get_party_cash_history_detail('supplier','66000000-0000-0000-0000-000000000001',null,0,25,'{}');
 select value into a from jsonb_array_elements(detail->'items') where value->>'branch_id'='33000000-0000-0000-0000-000000000001';
 select value into b from jsonb_array_elements(detail->'items') where value->>'branch_id'='33000000-0000-0000-0000-000000000002';
 if (a->>'advance_remaining')::numeric<>100 or b->'advance_remaining'<>'null'::jsonb then raise exception 'ADVANCE_DETAIL_SCOPE_FAILED %',detail;end if;
end$$;
update public.purchase_orders set debt=70 where id='88000000-0000-0000-0000-000000000001';
do $$declare payload jsonb; r jsonb; req uuid:='bb000000-0000-0000-0000-000000000002';begin
 payload:=jsonb_build_object('mode','supplier','source','advance','partyId','66000000-0000-0000-0000-000000000001',
  'branchId','33000000-0000-0000-0000-000000000001','note','Synthetic settlement',
  'lines',jsonb_build_array(jsonb_build_object('id','88000000-0000-0000-0000-000000000001','amount',20)));
 r:=public.settle_party_documents_atomic(req,payload);
 if (select debt from public.purchase_orders where id='88000000-0000-0000-0000-000000000001')<>50 then raise exception 'SETTLEMENT_POST_FAILED %',r;end if;
 r:=public.settle_party_documents_atomic(req,payload);
 if not (r->>'idempotent')::boolean or (select debt from public.purchase_orders where id='88000000-0000-0000-0000-000000000001')<>50 then raise exception 'SETTLEMENT_RETRY_FAILED %',r;end if;
 begin perform public.settle_party_documents_atomic(gen_random_uuid(),payload||jsonb_build_object('branchId','33000000-0000-0000-0000-000000000002'));raise exception 'DENIED_SETTLEMENT_ACCEPTED';exception when insufficient_privilege then null;end;
end$$;
do $$declare advance_id uuid; result jsonb; request uuid:='bb000000-0000-0000-0000-000000000001'; payload jsonb; cash_id uuid;begin
 select id into advance_id from public.supplier_advances where tenant_id='11000000-0000-0000-0000-000000000001' and branch_id='33000000-0000-0000-0000-000000000001';
 payload:=jsonb_build_object('mode','supplier','partyId','66000000-0000-0000-0000-000000000001','branchId','33000000-0000-0000-0000-000000000001',
   'advanceId',advance_id,'amount',40,'paymentMethod','cash','moneyAccountId','aa000000-0000-0000-0000-000000000001','occurredAt',now(),'transactionDate',current_date,'note','Synthetic refund');
 result:=public.refund_party_advance(request,payload);cash_id:=(result->>'cash_id')::uuid;
 if (result->>'remaining')::numeric<>40 then raise exception 'REFUND_AMOUNT_FAILED %',result;end if;
 result:=public.refund_party_advance(request,payload);
 if not (result->>'idempotent')::boolean then raise exception 'REFUND_RETRY_FAILED %',result;end if;
 result:=public.cancel_party_advance_refund(cash_id,'Synthetic cancellation');
 if (select remaining_amount from public.supplier_advances where id=advance_id)<>80 then raise exception 'REFUND_CANCEL_FAILED';end if;
 begin perform public.refund_party_advance(gen_random_uuid(),payload||jsonb_build_object('branchId','33000000-0000-0000-0000-000000000002'));raise exception 'DENIED_REFUND_ACCEPTED';exception when insufficient_privilege then null;end;
end$$;
rollback;
