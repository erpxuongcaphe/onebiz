\set ON_ERROR_STOP on
do $$begin
 if current_database()<>'onebiz_hub_scope_v8_20261114' or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE';end if;
end$$;
begin;
revoke select on public.audit_log from authenticated;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into public.tenants(id,name,slug) values ('10000000-0000-0000-0000-000000000001','A tenant','audit-safe-test'),('10000000-0000-0000-0000-000000000002','B tenant','audit-safe-test-other');
insert into auth.users(id) values ('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','A','warehouse'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','B','warehouse'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Other tenant','warehouse'),
 ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','C','warehouse');
insert into public.roles(id,tenant_id,name) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Staff');
insert into public.role_permissions(role_id,permission_code) values ('40000000-0000-0000-0000-000000000001','finance.view_cash_book');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Owner','owner',null),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Staff','staff','40000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
insert into public.cash_transactions(id,tenant_id,branch_id,code,type,category,amount,created_by) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','TEST-A','receipt','test',10,'20000000-0000-0000-0000-000000000002'),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','TEST-B','receipt','test',20,'20000000-0000-0000-0000-000000000001');
insert into public.products(id,tenant_id,code,name,is_fnb_stock_item,product_type,channel,allow_sale) values
 ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','TEST-P','Synthetic product',true,'sku','retail',false),
 ('70000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','TEST-P-OTHER','Other tenant product',false,'nvl',null,true);
insert into public.invoices(id,tenant_id,branch_id,code,created_by,source) values
 ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','TEST-INV-A','20000000-0000-0000-0000-000000000002','pos'),
 ('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','TEST-INV-B','20000000-0000-0000-0000-000000000001','pos');
insert into public.customers(id,tenant_id,code,name) values ('90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','KL-VL','Khách lẻ');
insert into public.categories(id,tenant_id,name,code,scope) values ('90000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Synthetic group','TE','supplier');
insert into public.suppliers(id,tenant_id,code,name,group_id) values ('90000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','TEST','Synthetic supplier','90000000-0000-0000-0000-000000000002');
insert into public.bom(id,tenant_id,product_id,code,name) values ('90000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','TEST-BOM','Synthetic BOM');
insert into public.production_orders(id,tenant_id,code,branch_id,bom_id,product_id,planned_qty) values ('90000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','TEST-PROD','30000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000004','70000000-0000-0000-0000-000000000001',1);
insert into public.product_lots(id,tenant_id,branch_id,product_id,lot_number,initial_qty,current_qty) values ('90000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','TEST-LOT',1,1);
insert into public.sales_orders(id,tenant_id,branch_id,code,created_by) values ('90000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','TEST-ORDER','20000000-0000-0000-0000-000000000002');
insert into public.sales_returns(id,tenant_id,branch_id,code,invoice_id,created_by) values ('90000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','TEST-RET','80000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
insert into public.shipping_orders(id,tenant_id,invoice_id,code,receiver_name,receiver_phone,receiver_address) values ('90000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001','TEST-SHIP','Synthetic','000','Synthetic');
insert into public.purchase_orders(id,tenant_id,branch_id,code,supplier_id,supplier_name,created_by) values ('90000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','TEST-PO','90000000-0000-0000-0000-000000000003','Synthetic supplier','20000000-0000-0000-0000-000000000002');
insert into public.supplier_returns(id,tenant_id,branch_id,code,created_by) values ('90000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','TEST-PRET','20000000-0000-0000-0000-000000000002');
insert into public.input_invoices(id,tenant_id,branch_id,code,created_by) values ('90000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','TEST-INPUT','20000000-0000-0000-0000-000000000002');
insert into public.inventory_checks(id,tenant_id,branch_id,code,created_by) values ('90000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','TEST-CHECK','20000000-0000-0000-0000-000000000002');
insert into public.disposal_exports(id,tenant_id,branch_id,code,created_by) values ('90000000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','TEST-DISPOSE','20000000-0000-0000-0000-000000000002');
insert into public.internal_exports(id,tenant_id,branch_id,code,created_by) values ('90000000-0000-0000-0000-000000000015','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','TEST-USE','20000000-0000-0000-0000-000000000002');
insert into public.stock_transfers(id,tenant_id,code,from_branch_id,to_branch_id) values ('90000000-0000-0000-0000-000000000016','10000000-0000-0000-0000-000000000001','TEST-TRANSFER','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002');
insert into public.internal_sales(id,tenant_id,code,from_branch_id,to_branch_id,created_by) values ('90000000-0000-0000-0000-000000000017','10000000-0000-0000-0000-000000000001','TEST-INTERNAL','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002');
insert into public.bom(id,tenant_id,branch_id,product_id,code,name) values ('91000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000001','TEST-BOM-B','B BOM');
insert into public.production_orders(id,tenant_id,code,branch_id,bom_id,product_id,planned_qty) values ('91000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','TEST-PROD-B','30000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000004','70000000-0000-0000-0000-000000000001',1);
insert into public.product_lots(id,tenant_id,branch_id,product_id,lot_number,initial_qty,current_qty) values ('91000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000001','TEST-LOT-B',1,1);
insert into public.sales_orders(id,tenant_id,branch_id,code,created_by) values ('91000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','TEST-ORDER-B','20000000-0000-0000-0000-000000000001');
insert into public.sales_returns(id,tenant_id,branch_id,code,invoice_id,created_by) values ('91000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','TEST-RET-B','80000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
insert into public.shipping_orders(id,tenant_id,invoice_id,code,receiver_name,receiver_phone,receiver_address) values ('91000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002','TEST-SHIP-B','Synthetic','000','Synthetic');
insert into public.purchase_orders(id,tenant_id,branch_id,code,supplier_id,supplier_name,created_by) values ('91000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','TEST-PO-B','90000000-0000-0000-0000-000000000003','Synthetic supplier','20000000-0000-0000-0000-000000000001');
insert into public.supplier_returns(id,tenant_id,branch_id,code,created_by) values ('91000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','TEST-PRET-B','20000000-0000-0000-0000-000000000001');
insert into public.input_invoices(id,tenant_id,branch_id,code,created_by) values ('91000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','TEST-INPUT-B','20000000-0000-0000-0000-000000000001');
insert into public.inventory_checks(id,tenant_id,branch_id,code,created_by) values ('91000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','TEST-CHECK-B','20000000-0000-0000-0000-000000000001');
insert into public.disposal_exports(id,tenant_id,branch_id,code,created_by) values ('91000000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','TEST-DISPOSE-B','20000000-0000-0000-0000-000000000001');
insert into public.internal_exports(id,tenant_id,branch_id,code,created_by) values ('91000000-0000-0000-0000-000000000015','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','TEST-USE-B','20000000-0000-0000-0000-000000000001');
insert into public.stock_transfers(id,tenant_id,code,from_branch_id,to_branch_id) values ('91000000-0000-0000-0000-000000000016','10000000-0000-0000-0000-000000000001','TEST-TRANSFER-B','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000004');
insert into public.internal_sales(id,tenant_id,code,from_branch_id,to_branch_id,created_by) values ('91000000-0000-0000-0000-000000000017','10000000-0000-0000-0000-000000000001','TEST-INTERNAL-B','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001');
insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 select '10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','update',x.kind,x.id::uuid,
  case when x.kind in ('disposal_export','internal_export') then '{"name":"Synthetic","total_amount":999,"items":[{"unit_price":88,"amount":99}]}'::jsonb else '{"name":"Synthetic"}'::jsonb end from (values
  ('customer','90000000-0000-0000-0000-000000000001'),('supplier','90000000-0000-0000-0000-000000000003'),('bom','90000000-0000-0000-0000-000000000004'),('production_order','90000000-0000-0000-0000-000000000005'),('product_lot','90000000-0000-0000-0000-000000000006'),('sales_order','90000000-0000-0000-0000-000000000007'),('sales_return','90000000-0000-0000-0000-000000000008'),('shipping_order','90000000-0000-0000-0000-000000000009'),('purchase_order','90000000-0000-0000-0000-000000000010'),('purchase_return','90000000-0000-0000-0000-000000000011'),('input_invoice','90000000-0000-0000-0000-000000000012'),('inventory_check','90000000-0000-0000-0000-000000000013'),('disposal_export','90000000-0000-0000-0000-000000000014'),('internal_export','90000000-0000-0000-0000-000000000015'),('stock_transfer','90000000-0000-0000-0000-000000000016'),('internal_sale','90000000-0000-0000-0000-000000000017')) x(kind,id);
insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data,ip_address) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','update','cash_transaction','50000000-0000-0000-0000-000000000001','{"amount":10,"unit_cost":5,"debt":555,"nested":{"token":"secret","profit":4}}','127.0.0.1'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','update','cash_transaction','50000000-0000-0000-0000-000000000002','{"amount":20} ',null),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','update','product','70000000-0000-0000-0000-000000000001','{"name":"Synthetic","cost_price":44}',null),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','update','invoice','80000000-0000-0000-0000-000000000001','{"code":"TEST-INV-A","cost_price":44}',null),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','update','invoice','80000000-0000-0000-0000-000000000002','{"code":"TEST-INV-B"}',null);
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$declare blocked boolean:=false;begin
 begin perform id from public.audit_log limit 1;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'RAW_AUDIT_READ_NOT_BLOCKED';end if;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','test_insert','product','70000000-0000-0000-0000-000000000001');
end$$;
do $$declare row record; denied boolean; kind text;begin
 select * into row from public.staff_audit_entity_history('cash_transaction','50000000-0000-0000-0000-000000000001',50);
 if row.id is null or row.new_data->>'amount'<>'10' or row.new_data ? 'unit_cost' or row.new_data ? 'debt' or row.new_data->'nested' ? 'token' or row.new_data->'nested' ? 'profit' or row.ip_address is not null then raise exception 'AUDIT_MASK_OR_HISTORY_FAILED %',row.new_data;end if;
 denied:=false;begin perform * from public.staff_audit_entity_history('cash_transaction','50000000-0000-0000-0000-000000000002',50);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'CROSS_BRANCH_HISTORY_ALLOWED';end if;
 select * into row from public.staff_audit_entity_history('invoice','80000000-0000-0000-0000-000000000001',50);
 if row.id is null or row.new_data ? 'cost_price' then raise exception 'INVOICE_HISTORY_OR_MASK_FAILED';end if;
 denied:=false;begin perform * from public.staff_audit_entity_history('invoice','80000000-0000-0000-0000-000000000002',50);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'CROSS_BRANCH_INVOICE_HISTORY_ALLOWED';end if;
 select * into row from public.staff_audit_entity_history('product','70000000-0000-0000-0000-000000000001',50);
 if row.id is null or row.new_data ? 'cost_price' then raise exception 'PRODUCT_COST_VISIBLE';end if;
 denied:=false;begin perform * from public.staff_audit_entity_history('product','70000000-0000-0000-0000-000000000002',50);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'CROSS_TENANT_HISTORY_ALLOWED';end if;
 foreach kind in array array['invoice','shipping_order','sales_order','sales_return','purchase_order','purchase_return','input_invoice','inventory_check','disposal_export','internal_export','stock_transfer','internal_sale','product_lot','production_order','bom','product','customer','supplier','profile'] loop
  denied:=false;begin perform * from public.staff_audit_entity_history(kind,'99999999-9999-9999-9999-999999999999',50);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'UNKNOWN_ENTITY_ALLOWED %',kind;end if;
 end loop;
end$$;
reset role;
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','invoices.view','revoke','20000000-0000-0000-0000-000000000001');
delete from public.role_permissions where role_id='40000000-0000-0000-0000-000000000001' and permission_code='finance.view_cash_book';
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform * from public.staff_audit_entity_history('invoice','80000000-0000-0000-0000-000000000001',50);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'INVOICE_REVOKE_IGNORED';end if;
end$$;
reset role;
delete from public.user_branch_permission_overrides where user_id='20000000-0000-0000-0000-000000000002' and permission_code='invoices.view';
insert into public.role_permissions(role_id,permission_code)
 select '40000000-0000-0000-0000-000000000001',code from unnest(array['inventory.view','inventory.create_po','inventory.check','inventory.transfer','inventory.dispose','inventory.internal_export','production.view','orders.view','invoices.view','customers.view','suppliers.view']) code;
set local role authenticated;
do $$declare item record; n integer; denied boolean;begin
 for item in select * from (values
  ('customer','90000000-0000-0000-0000-000000000001'),('supplier','90000000-0000-0000-0000-000000000003'),('bom','90000000-0000-0000-0000-000000000004'),('production_order','90000000-0000-0000-0000-000000000005'),('product_lot','90000000-0000-0000-0000-000000000006'),('sales_order','90000000-0000-0000-0000-000000000007'),('sales_return','90000000-0000-0000-0000-000000000008'),('shipping_order','90000000-0000-0000-0000-000000000009'),('purchase_order','90000000-0000-0000-0000-000000000010'),('purchase_return','90000000-0000-0000-0000-000000000011'),('input_invoice','90000000-0000-0000-0000-000000000012'),('inventory_check','90000000-0000-0000-0000-000000000013'),('disposal_export','90000000-0000-0000-0000-000000000014'),('internal_export','90000000-0000-0000-0000-000000000015'),('stock_transfer','90000000-0000-0000-0000-000000000016'),('internal_sale','90000000-0000-0000-0000-000000000017')) v(kind,id) loop
  select count(*) into n from public.staff_audit_entity_history(item.kind,item.id::uuid,50);
  if n<>1 then raise exception 'ENTITY_HISTORY_MISSING %',item.kind;end if;
 end loop;
 for item in select * from (values
  ('bom','91000000-0000-0000-0000-000000000004'),('production_order','91000000-0000-0000-0000-000000000005'),('product_lot','91000000-0000-0000-0000-000000000006'),('sales_order','91000000-0000-0000-0000-000000000007'),('sales_return','91000000-0000-0000-0000-000000000008'),('shipping_order','91000000-0000-0000-0000-000000000009'),('purchase_order','91000000-0000-0000-0000-000000000010'),('purchase_return','91000000-0000-0000-0000-000000000011'),('input_invoice','91000000-0000-0000-0000-000000000012'),('inventory_check','91000000-0000-0000-0000-000000000013'),('disposal_export','91000000-0000-0000-0000-000000000014'),('internal_export','91000000-0000-0000-0000-000000000015'),('stock_transfer','91000000-0000-0000-0000-000000000016'),('internal_sale','91000000-0000-0000-0000-000000000017')) v(kind,id) loop
  denied:=false;begin perform * from public.staff_audit_entity_history(item.kind,item.id::uuid,50);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'CROSS_BRANCH_ENTITY_ALLOWED %',item.kind;end if;
 end loop;
end$$;
reset role;
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','inventory.view','revoke','20000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$declare row record;begin
 select * into row from public.staff_audit_entity_history('inventory_check','90000000-0000-0000-0000-000000000013',50);
 if row.id is null then raise exception 'STOCKTAKE_ACTION_ACCESS_LOST';end if;
 select * into row from public.staff_audit_entity_history('stock_transfer','90000000-0000-0000-0000-000000000016',50);
 if row.id is null then raise exception 'TRANSFER_ACTION_ACCESS_LOST';end if;
 select * into row from public.staff_audit_entity_history('disposal_export','90000000-0000-0000-0000-000000000014',50);
 if row.id is null or row.new_data ? 'total_amount' or (row.new_data->'items'->0) ? 'unit_price' or (row.new_data->'items'->0) ? 'amount' then raise exception 'DISPOSAL_ACTION_ACCESS_OR_COST_MASK_FAILED';end if;
 select * into row from public.staff_audit_entity_history('internal_export','90000000-0000-0000-0000-000000000015',50);
 if row.id is null or row.new_data ? 'total_amount' then raise exception 'INTERNAL_ACTION_ACCESS_OR_COST_MASK_FAILED';end if;
end$$;
reset role;
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','inventory.dispose','revoke','20000000-0000-0000-0000-000000000001');
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform * from public.staff_audit_entity_history('disposal_export','90000000-0000-0000-0000-000000000014',50);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'DISPOSAL_DENY_IGNORED';end if;
 perform * from public.staff_audit_entity_history('internal_export','90000000-0000-0000-0000-000000000015',50);
end$$;
reset role;
insert into public.role_permissions(role_id,permission_code) values ('40000000-0000-0000-0000-000000000001','products.view_cost');
set local role authenticated;
do $$declare row record;begin
 select * into row from public.staff_audit_entity_history('product','70000000-0000-0000-0000-000000000001',50);
 if row.new_data->>'cost_price'<>'44' then raise exception 'AUTHORIZED_COST_HIDDEN';end if;
end$$;
reset role;
update public.profiles set is_active=false where id='20000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform * from public.staff_audit_entity_history('product','70000000-0000-0000-0000-000000000001',50);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'INACTIVE_HISTORY_ALLOWED';end if;
end$$;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
do $$begin perform public.get_operation_history_00453();end$$;
do $$declare row record;begin
 select * into row from public.staff_audit_entity_history('cash_transaction','50000000-0000-0000-0000-000000000001',50);
 if row.new_data->>'debt'<>'555' then raise exception 'OWNER_DEBT_HIDDEN';end if;
end$$;
rollback;
