\set ON_ERROR_STOP on
do $$begin
 if current_database()<>'onebiz_hub_scope_v7_20261114' or inet_server_addr()<>'127.0.0.1'::inet or inet_server_port()<>55487 or exists(select 1 from public.tenants) then raise exception 'WRONG_TEST_DATABASE'; end if;
end$$;
begin;
insert into public.tenants(id,name,slug) values ('11000000-0000-0000-0000-000000000001','Synthetic','bom-write-scope');
insert into auth.users(id) values ('22000000-0000-0000-0000-000000000002');
insert into public.branches(id,tenant_id,name,branch_type) values
 ('33000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','A','store'),
 ('33000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','B','store');
insert into public.roles(id,tenant_id,name) values ('44000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','Synthetic');
insert into public.profiles(id,tenant_id,branch_id,full_name,role,role_id) values ('22000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','Synthetic','staff','44000000-0000-0000-0000-000000000001');
insert into public.user_branches(user_id,branch_id) values ('22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002');
insert into public.role_permissions(role_id,permission_code) values
 ('44000000-0000-0000-0000-000000000001','production.manage_bom'),
 ('44000000-0000-0000-0000-000000000001','inventory.view');
insert into public.products(id,tenant_id,code,name,product_type,stock) values
 ('55000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','SYN-RAW','Synthetic raw','nvl',10);
insert into public.bom(id,tenant_id,branch_id,code,name) values
 ('66000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001','SYN-A','A'),
 ('66000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000002','SYN-B','B'),
 ('66000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001',null,'SYN-G','Shared');
insert into public.bom_items(bom_id,material_id,quantity,unit,sort_order) values
 ('66000000-0000-0000-0000-000000000001','55000000-0000-0000-0000-000000000001',1,'Cái',1),
 ('66000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000001',1,'Cái',1),
 ('66000000-0000-0000-0000-000000000003','55000000-0000-0000-0000-000000000001',1,'Cái',1);
insert into public.staff_branch_permission_catalog values ('production.manage_bom',1) on conflict do nothing;
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000002','production.manage_bom','revoke','22000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','22000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$declare changed integer;begin
 update public.bom set note='Synthetic' where id='66000000-0000-0000-0000-000000000001';
 get diagnostics changed=row_count; if changed<>1 then raise exception 'BOM_ALLOWED_BRANCH_DENIED'; end if;
 update public.bom set note='Synthetic' where id='66000000-0000-0000-0000-000000000002';
 get diagnostics changed=row_count; if changed<>0 then raise exception 'BOM_REVOKED_BRANCH_WRITE_ALLOWED'; end if;
 update public.bom_items set quantity=2 where bom_id='66000000-0000-0000-0000-000000000001';
 get diagnostics changed=row_count; if changed<>1 then raise exception 'BOM_ITEM_ALLOWED_BRANCH_DENIED'; end if;
 update public.bom_items set quantity=2 where bom_id='66000000-0000-0000-0000-000000000002';
 get diagnostics changed=row_count; if changed<>0 then raise exception 'BOM_ITEM_REVOKED_BRANCH_WRITE_ALLOWED'; end if;
 delete from public.bom_items where bom_id='66000000-0000-0000-0000-000000000002';
 get diagnostics changed=row_count; if changed<>0 then raise exception 'BOM_ITEM_REVOKED_DELETE_ALLOWED'; end if;
 begin insert into public.bom_items(bom_id,material_id,quantity,unit,sort_order)
  values ('66000000-0000-0000-0000-000000000002','55000000-0000-0000-0000-000000000001',1,'Cái',2);
  raise exception 'BOM_ITEM_REVOKED_INSERT_ALLOWED'; exception when insufficient_privilege then null;end;
 begin update public.bom set branch_id='33000000-0000-0000-0000-000000000002' where id='66000000-0000-0000-0000-000000000001';
  raise exception 'BOM_MOVE_TO_REVOKED_ALLOWED'; exception when insufficient_privilege then null;end;
 perform public.save_bom_modifier_option_quantities('66000000-0000-0000-0000-000000000001','[]'::jsonb);
 begin perform public.save_bom_modifier_option_quantities('66000000-0000-0000-0000-000000000002','[]'::jsonb); raise exception 'BOM_OPTION_REVOKE_BYPASSED';
 exception when insufficient_privilege then if sqlerrm<>'BOM_WRITE_PERMISSION_DENIED' then raise;end if;end;
 begin perform public.clone_bom_for_branch_atomic('66000000-0000-0000-0000-000000000003','33000000-0000-0000-0000-000000000002');
  raise exception 'BOM_CLONE_REVOKE_BYPASSED'; exception when insufficient_privilege then if sqlerrm<>'BOM_CLONE_PERMISSION_DENIED' then raise;end if;end;
 perform public.clone_bom_for_branch_atomic('66000000-0000-0000-0000-000000000003','33000000-0000-0000-0000-000000000001');
end$$;
reset role;
delete from public.role_permissions where role_id='44000000-0000-0000-0000-000000000001' and permission_code='production.manage_bom';
insert into public.user_branch_permission_overrides(tenant_id,user_id,branch_id,permission_code,override_type,updated_by) values
 ('11000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','33000000-0000-0000-0000-000000000001','production.manage_bom','grant','22000000-0000-0000-0000-000000000002');
set local role authenticated;
do $$declare changed integer;begin
 update public.bom set note='Branch grant' where id='66000000-0000-0000-0000-000000000001';
 get diagnostics changed=row_count;if changed<>1 then raise exception 'BOM_BRANCH_GRANT_DENIED';end if;
 update public.bom set note='Shared denial' where id='66000000-0000-0000-0000-000000000003';
 get diagnostics changed=row_count;if changed<>0 then raise exception 'BOM_SHARED_BRANCH_GRANT_ALLOWED';end if;
end$$;
reset role;
insert into public.role_permissions(role_id,permission_code) values ('44000000-0000-0000-0000-000000000001','products.edit');
set local role authenticated;
do $$declare changed integer;begin
 update public.bom set note='Shared product editor' where id='66000000-0000-0000-0000-000000000002';
 get diagnostics changed=row_count; if changed<>1 then raise exception 'PRODUCT_EDIT_GLOBAL_RIGHT_LOST'; end if;
 perform public.save_bom_modifier_option_quantities('66000000-0000-0000-0000-000000000002','[]'::jsonb);
end$$;
rollback;
