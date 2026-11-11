-- Inventory check mutations: resolve the branch from the persisted check,
-- or the explicit branch of the new check. Never use a client session header.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $migration$
declare item record; source text; patched text; target regprocedure; pattern text;
begin
 for item in select * from (values
  ('public._apply_inventory_check_auth_impl_00249(uuid,uuid,uuid)','inventory.check',
   '(select staff_check_scope.branch_id from public.inventory_checks staff_check_scope where staff_check_scope.id=p_check_id and staff_check_scope.tenant_id=public.get_user_tenant_id())'),
  ('public.create_and_apply_inventory_check_atomic(uuid,text,jsonb)','inventory.check','p_branch_id'),
  ('public.cancel_inventory_check_atomic(uuid)','inventory.cancel_check',
   '(select staff_check_scope.branch_id from public.inventory_checks staff_check_scope where staff_check_scope.id=p_check_id and staff_check_scope.tenant_id=public.get_user_tenant_id())'),
  ('public.get_inventory_check_change_source(uuid)','inventory.edit_check',
   '(select staff_check_scope.branch_id from public.inventory_checks staff_check_scope where staff_check_scope.id=p_check_id and staff_check_scope.tenant_id=public.get_user_tenant_id())'),
  ('public.get_inventory_check_change_source(uuid)','inventory.cancel_check',
   '(select staff_check_scope.branch_id from public.inventory_checks staff_check_scope where staff_check_scope.id=p_check_id and staff_check_scope.tenant_id=public.get_user_tenant_id())')
 ) as entries(signature,code,branch_expression) loop
  target:=to_regprocedure(item.signature);
  if target is null then raise exception 'STAFF_INVENTORY_CONSUMER_MISSING: %',item.signature; end if;
  source:=pg_get_functiondef(target);
  pattern:='user_has_permission\(([^,]+),\s*'''||replace(item.code,'.','\.')||'''\)';
  patched:=regexp_replace(source,pattern,'user_has_permission_at_branch(\1,'''||item.code||''','||item.branch_expression||')','g');
  if patched=source then raise exception 'STAFF_INVENTORY_CONSUMER_CHANGED: %',item.signature; end if;
  execute patched;
 end loop;

 -- These two dispatchers select their permission dynamically. Keep unrelated
 -- stock operations on their existing authorization path.
 target:='public.create_stock_operation_with_uom(text,uuid,jsonb,uuid,uuid,text,text)'::regprocedure;
 source:=pg_get_functiondef(target);
 patched:=replace(source,'user_has_permission(actor,permission)',
  '(case when permission=''inventory.check'' then public.user_has_permission_at_branch(actor,permission,p_branch_id) else public.user_has_permission(actor,permission) end)');
 if patched=source then raise exception 'STAFF_INVENTORY_UOM_CONSUMER_CHANGED'; end if;
 execute patched;

 target:='public._change_inventory_check(uuid,text,jsonb,text,text,text,uuid,text,boolean)'::regprocedure;
 source:=pg_get_functiondef(target);
 pattern:='user_has_permission\(actor,\s*case when p_action=''edit'' then ''inventory.edit_check'' else ''inventory.cancel_check'' end\)';
 patched:=regexp_replace(source,pattern,
  'user_has_permission_at_branch(actor,case when p_action=''edit'' then ''inventory.edit_check'' else ''inventory.cancel_check'' end,(select ic.branch_id from public.inventory_checks ic where ic.id=p_check_id and ic.tenant_id=public.get_user_tenant_id()))','g');
 if patched=source then raise exception 'STAFF_INVENTORY_CHANGE_CONSUMER_CHANGED'; end if;
 execute patched;
end $migration$;

insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('inventory.check',1),('inventory.edit_check',1),('inventory.cancel_check',1);
commit;
