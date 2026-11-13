\set ON_ERROR_STOP on
do $$begin
 if current_database() !~ '^onebiz_rehearsal_[0-9]+$' or inet_server_addr() <> '127.0.0.1'::inet or inet_server_port() <> 55487 then
  raise exception 'synthetic test requires dedicated local rehearsal database';
 end if;
 if exists(select 1 from public.tenants) then raise exception 'rehearsal database must contain no tenant data';end if;
end$$;
begin;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into public.tenants(id,name,slug) values
 ('10000000-0000-0000-0000-000000000001','Test tenant','test-scope'),
 ('10000000-0000-0000-0000-000000000002','Other tenant','test-other');
insert into auth.users(id) values
 ('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Branch A','warehouse'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Branch B','warehouse'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Other branch','warehouse');
insert into public.roles(id,tenant_id,name) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Test role');
insert into public.role_permissions(role_id,permission_code) values
 ('40000000-0000-0000-0000-000000000001','finance.view_cash_book'),
 ('40000000-0000-0000-0000-000000000001','reports.analytics'),
 ('40000000-0000-0000-0000-000000000001','pos_fnb.checkout'),
 ('40000000-0000-0000-0000-000000000001','pos_fnb.view_orders'),
 ('40000000-0000-0000-0000-000000000001','pos_fnb.send_kitchen');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Test owner','owner',null),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Test staff','staff','40000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values
 ('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002');
insert into public.fnb_print_points(id,tenant_id,branch_id,name,enabled,routes) values
 ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Synthetic point',true,
  '[{"key":"cashier","label":"Synthetic route","printer":"NO_DEVICE","paper":"80mm"},{"key":"kitchen","label":"Synthetic kitchen","printer":"NO_DEVICE","paper":"80mm"}]');
insert into public.customers(id,tenant_id,code,name) values ('80000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','KL-VL','Khách lẻ');
insert into public.shifts(id,tenant_id,branch_id,cashier_id,status) values ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','open');
insert into public.products(id,tenant_id,code,name,bom_code,has_bom,product_type,channel,stock) values
 ('80000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','SYN-MENU','Synthetic drink','SYN-BOM',true,'sku','fnb',0),
 ('80000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','SYN-RAW','Synthetic raw',null,false,'nvl',null,10);
insert into public.bom(id,tenant_id,product_id,code,name) values ('80000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000010','SYN-BOM','Synthetic BOM');
insert into public.bom_items(bom_id,material_id,unit,quantity,sort_order) values ('80000000-0000-0000-0000-000000000013','80000000-0000-0000-0000-000000000011','Cái',0.02,1);
insert into public.branch_stock(tenant_id,branch_id,product_id,quantity) values ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000011',10);
insert into public.product_lots(tenant_id,product_id,branch_id,lot_number,current_qty,initial_qty) values ('10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000011','30000000-0000-0000-0000-000000000001','SYN-LOT',10,10);
insert into public.kitchen_orders(id,tenant_id,branch_id,status,order_number,created_by) values ('80000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','pending','SYN-ORDER','20000000-0000-0000-0000-000000000002');
insert into public.kitchen_order_items(kitchen_order_id,product_id,product_name,variant_label,quantity,unit_price) values ('80000000-0000-0000-0000-000000000005','80000000-0000-0000-0000-000000000010','Synthetic drink','M',1,30000);
update public.products set product_type='sku',channel='retail',sell_price=30000,allow_sale=true where id='80000000-0000-0000-0000-000000000011';
insert into public.role_permissions(role_id,permission_code) values ('40000000-0000-0000-0000-000000000001','pos_retail.checkout');
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','pos_retail.checkout','revoke','20000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$begin begin
 perform public.pos_complete_checkout_atomic_v4(p_branch_id=>'30000000-0000-0000-0000-000000000001',p_issued_at=>null,p_issued_reason=>null,p_checkout_client_at=>now(),p_items=>'[{"productId":"80000000-0000-0000-0000-000000000011","quantity":1,"unitPrice":30000}]',p_payment_method=>'cash',p_paid=>30000,p_client_session_id=>'80000000-0000-0000-0000-000000000060');
 raise exception 'retail deny ignored';
 exception when others then if sqlerrm not like '%POS_CHECKOUT_DENIED%' then raise; end if; end;
end$$;
reset role;
do $$begin if (select count(*) from public.invoices)<>0 then raise exception 'denied retail sale created invoice'; end if; end$$;
delete from public.user_branch_permission_overrides where permission_code='pos_retail.checkout';
set local role authenticated;
do $$declare r jsonb; replay jsonb;begin
 r:=public.pos_complete_checkout_atomic_v4(p_branch_id=>'30000000-0000-0000-0000-000000000001',p_issued_at=>null,p_issued_reason=>null,p_checkout_client_at=>now(),p_items=>'[{"productId":"80000000-0000-0000-0000-000000000011","quantity":1,"unitPrice":30000}]',p_payment_method=>'cash',p_paid=>30000,p_client_session_id=>'80000000-0000-0000-0000-000000000060');
 if r->>'invoice_id' is null then raise exception 'retail invoice missing: %',r; end if; replay:=public.pos_complete_checkout_atomic_v4(p_branch_id=>'30000000-0000-0000-0000-000000000001',p_issued_at=>null,p_issued_reason=>null,p_checkout_client_at=>now(),p_items=>'[{"productId":"80000000-0000-0000-0000-000000000011","quantity":1,"unitPrice":30000}]',p_payment_method=>'cash',p_paid=>30000,p_client_session_id=>'80000000-0000-0000-0000-000000000060'); if replay->>'invoice_id' is distinct from r->>'invoice_id' then raise exception 'retail replay created duplicate'; end if;
end$$;
reset role;
do $$begin if (select count(*) from public.invoices)<>1 then raise exception 'retail invoice count wrong'; end if; end$$;
rollback;
\set ON_ERROR_STOP on
do $$begin
 if current_database() !~ '^onebiz_rehearsal_[0-9]+$' or inet_server_addr() <> '127.0.0.1'::inet or inet_server_port() <> 55487 then
  raise exception 'synthetic test requires dedicated local rehearsal database';
 end if;
 if exists(select 1 from public.tenants) then raise exception 'rehearsal database must contain no tenant data';end if;
end$$;
begin;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into public.tenants(id,name,slug) values
 ('10000000-0000-0000-0000-000000000001','Test tenant','test-scope'),
 ('10000000-0000-0000-0000-000000000002','Other tenant','test-other');
insert into auth.users(id) values
 ('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Branch A','warehouse'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Branch B','warehouse'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Other branch','warehouse');
insert into public.roles(id,tenant_id,name) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Test role');
insert into public.role_permissions(role_id,permission_code) values
 ('40000000-0000-0000-0000-000000000001','finance.view_cash_book'),
 ('40000000-0000-0000-0000-000000000001','reports.analytics'),
 ('40000000-0000-0000-0000-000000000001','pos_fnb.checkout'),
 ('40000000-0000-0000-0000-000000000001','pos_fnb.view_orders'),
 ('40000000-0000-0000-0000-000000000001','pos_fnb.send_kitchen');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Test owner','owner',null),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Test staff','staff','40000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values
 ('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002');
insert into public.fnb_print_points(id,tenant_id,branch_id,name,enabled,routes) values
 ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Synthetic point',true,
  '[{"key":"cashier","label":"Synthetic route","printer":"NO_DEVICE","paper":"80mm"},{"key":"kitchen","label":"Synthetic kitchen","printer":"NO_DEVICE","paper":"80mm"}]');
insert into public.customers(id,tenant_id,code,name) values ('80000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','KL-VL','Khách lẻ');
insert into public.shifts(id,tenant_id,branch_id,cashier_id,status) values ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','open');
insert into public.products(id,tenant_id,code,name,bom_code,has_bom,product_type,channel,stock) values
 ('80000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000001','SYN-MENU','Synthetic drink','SYN-BOM',true,'sku','fnb',0),
 ('80000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','SYN-RAW','Synthetic raw',null,false,'nvl',null,10);
insert into public.bom(id,tenant_id,product_id,code,name) values ('80000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000010','SYN-BOM','Synthetic BOM');
insert into public.bom_items(bom_id,material_id,unit,quantity,sort_order) values ('80000000-0000-0000-0000-000000000013','80000000-0000-0000-0000-000000000011','Cái',0.02,1);
insert into public.branch_stock(tenant_id,branch_id,product_id,quantity) values ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000011',10);
insert into public.product_lots(tenant_id,product_id,branch_id,lot_number,current_qty,initial_qty) values ('10000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000011','30000000-0000-0000-0000-000000000001','SYN-LOT',10,10);
insert into public.kitchen_orders(id,tenant_id,branch_id,status,order_number,created_by) values ('80000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','pending','SYN-ORDER','20000000-0000-0000-0000-000000000002');
insert into public.kitchen_order_items(kitchen_order_id,product_id,product_name,variant_label,quantity,unit_price) values ('80000000-0000-0000-0000-000000000005','80000000-0000-0000-0000-000000000010','Synthetic drink','M',1,30000);
update public.products set product_type='sku',channel='retail',sell_price=30000,allow_sale=true where id='80000000-0000-0000-0000-000000000011';
insert into public.role_permissions(role_id,permission_code) values ('40000000-0000-0000-0000-000000000001','pos_retail.checkout');
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','pos_retail.checkout','revoke','20000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$begin begin
 perform public.pos_complete_checkout_atomic_v3('30000000-0000-0000-0000-000000000001',null,'[{"productId":"80000000-0000-0000-0000-000000000011","quantity":1,"unitPrice":30000}]','cash',null,30000);
 raise exception 'retail deny ignored';
 exception when others then if sqlerrm not like '%POS_CHECKOUT_DENIED%' then raise; end if; end;
end$$;
reset role;
do $$begin if (select count(*) from public.invoices)<>0 then raise exception 'denied retail sale created invoice'; end if; end$$;
delete from public.user_branch_permission_overrides where permission_code='pos_retail.checkout';
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.pos_complete_checkout_atomic_v3('30000000-0000-0000-0000-000000000001',null,'[{"productId":"80000000-0000-0000-0000-000000000011","quantity":1,"unitPrice":30000}]','cash',null,30000);
 if r->>'invoice_id' is null then raise exception 'retail invoice missing: %',r; end if;
end$$;
reset role;
do $$begin if (select count(*) from public.invoices)<>1 then raise exception 'retail invoice count wrong'; end if; end$$;
rollback;