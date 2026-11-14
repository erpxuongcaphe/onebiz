\set ON_ERROR_STOP on
do $$begin
 if current_database()<>'onebiz_floor_rehearsal_v2' or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE'; end if;
end$$;
begin;
insert into public.tenants(id,name,slug) values ('11000000-0000-0000-0000-000000000001','Synthetic','receipt-synthetic');
insert into auth.users(id) values ('22000000-0000-0000-0000-000000000001');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic A','store'),
 ('33000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','Synthetic B','store'),
 ('33000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','Synthetic C','store');
insert into public.roles(id,tenant_id,name) values ('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic staff');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values ('22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic staff','staff','44000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values ('22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002');
insert into public.role_permissions(role_id,permission_code) values
 ('44000000-0000-0000-0000-000000000001','reports.analytics'),
 ('44000000-0000-0000-0000-000000000001','reports.view_detail'),
 ('44000000-0000-0000-0000-000000000001','reports.view_all_branches'),
 ('44000000-0000-0000-0000-000000000001','suppliers.view_purchases');
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values ('suppliers.view_purchases',1) on conflict do nothing;
select set_config('request.jwt.claim.sub','22000000-0000-0000-0000-000000000001',true);
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','suppliers.view_purchases','revoke','22000000-0000-0000-0000-000000000001');
insert into public.suppliers(id,tenant_id,code,name) values ('66000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','SYN-S','Synthetic supplier');
insert into public.products(id,tenant_id,code,name) values ('99000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','SYN-P','Synthetic product');
insert into public.purchase_orders(id,tenant_id,branch_id,code,created_by,supplier_id,supplier_name,status,total) values
 ('88000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','SYN-PA','22000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','Synthetic supplier','completed',70),
 ('88000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','SYN-PB','22000000-0000-0000-0000-000000000001','66000000-0000-0000-0000-000000000001','Synthetic supplier','completed',300);
insert into public.stock_movements(tenant_id,branch_id,product_id,type,quantity,unit_price,reference_type,reference_id,created_by,created_at) values
 ('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000001','in',1,70,'purchase_order','88000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','2026-10-01T00:00:00Z'),
 ('11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000001','in',1,300,'purchase_order','88000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000001','2026-10-01T00:00:00Z');
do $$declare r jsonb;begin
 r:=public.get_supplier_receipt_workspace_v2(null,'2026-01-01','2026-12-31');
 if r->'authorizedBranchIds'<>'["33000000-0000-0000-0000-000000000001"]'::jsonb or (r->>'scopeComplete')::boolean or (r->'summary'->>'netAmount')::numeric<>70 or (r->>'total')::integer<>1 then raise exception 'PARTIAL_SCOPE_FAILED %',r;end if;
 r:=public.get_supplier_receipt_workspace_v2('33000000-0000-0000-0000-000000000001','2026-01-01','2026-12-31');
 if (r->'summary'->>'netAmount')::numeric<>70 then raise exception 'SINGLE_BRANCH_FAILED %',r;end if;
 begin perform public.get_supplier_receipt_workspace_v2('33000000-0000-0000-0000-000000000002','2026-01-01','2026-12-31');raise exception 'REVOKED_BRANCH_ACCEPTED'; exception when insufficient_privilege then null;end;
 begin perform public.get_supplier_receipt_workspace_v2('33000000-0000-0000-0000-000000000003','2026-01-01','2026-12-31');raise exception 'UNASSIGNED_BRANCH_ACCEPTED'; exception when insufficient_privilege then null;end;
end$$;
delete from public.user_branch_permission_overrides where user_id='22000000-0000-0000-0000-000000000001';
do $$declare r jsonb;begin
 r:=public.get_supplier_receipt_workspace_v2(null,'2026-01-01','2026-12-31');
 if (r->'summary'->>'netAmount')::numeric<>370 or (r->>'total')::integer<>2 then raise exception 'ASSIGNED_BRANCH_TOTAL_FAILED %',r;end if;
end$$;
insert into public.user_permission_overrides(tenant_id,user_id,permission_code,override_type) values ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','suppliers.view_purchases','revoke');
do $$begin
 begin perform public.get_supplier_receipt_workspace_v2(null,'2026-01-01','2026-12-31');raise exception 'GLOBAL_REVOKE_ACCEPTED'; exception when insufficient_privilege then null;end;
end$$;
rollback;
