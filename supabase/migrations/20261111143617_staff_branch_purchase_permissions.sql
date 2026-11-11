begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; target regprocedure; source text; patched text;
begin
 for item in select * from (values
 ('public._expiry_po_v2_base_00527(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)','coalesce((select p.branch_id from public.purchase_orders p where p.id=p_purchase_order_id and p.tenant_id=public.get_user_tenant_id()),p_branch_id)'),
 ('public.save_purchase_order_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)','coalesce((select p.branch_id from public.purchase_orders p where p.id=p_purchase_order_id and p.tenant_id=public.get_user_tenant_id()),p_branch_id)'),
 ('public.change_fnb_warehouse_order(uuid,integer,uuid,text,jsonb,text,text)','(select p.branch_id from public.purchase_orders p where p.id=p_purchase_order_id and p.tenant_id=public.get_user_tenant_id())'),
 ('public.close_purchase_order_short(uuid,text,uuid)','(select p.branch_id from public.purchase_orders p where p.id=p_order_id and p.tenant_id=public.get_user_tenant_id())'),
 ('public.create_supplier_return_atomic(uuid,jsonb,text,text,text)','(select p.branch_id from public.purchase_orders p where p.id=p_purchase_order_id and p.tenant_id=public.get_user_tenant_id())'),
 ('public.get_fnb_warehouse_order_context(uuid,text)','p_branch_id'),
 ('public.receive_purchase_items_atomic(uuid,jsonb,uuid)','(select p.branch_id from public.purchase_orders p where p.id=p_order_id and p.tenant_id=public.get_user_tenant_id())'),
 ('public.receive_purchase_items_with_uom_atomic(uuid,jsonb,uuid)','(select p.branch_id from public.purchase_orders p where p.id=p_order_id and p.tenant_id=public.get_user_tenant_id())'),
 ('public.set_fnb_branch_opening_cost_00390(uuid,uuid,numeric,text)','p_branch_id'),
 ('public.set_purchase_order_state_atomic(uuid,text,text)','(select p.branch_id from public.purchase_orders p where p.id=p_purchase_order_id and p.tenant_id=public.get_user_tenant_id())'),
 ('public.update_purchase_order_prices(uuid,jsonb,uuid,text,text,numeric,numeric,numeric)','(select p.branch_id from public.purchase_orders p where p.id=p_order_id and p.tenant_id=public.get_user_tenant_id())'),
 ('public.update_purchase_order_prices_with_uom(uuid,jsonb,uuid,text,text,numeric,numeric,numeric)','(select p.branch_id from public.purchase_orders p where p.id=p_order_id and p.tenant_id=public.get_user_tenant_id())'),
 ('public.update_received_purchase_order_atomic(uuid,numeric,text,text)','(select p.branch_id from public.purchase_orders p where p.id=p_purchase_order_id and p.tenant_id=public.get_user_tenant_id())'),
 ('public._revert_received_po_global_wac_impl_00403(uuid,uuid,boolean)','(select p.branch_id from public.purchase_orders p where p.id=p_order_id and p.tenant_id=public.get_user_tenant_id())'),
 ('public.receive_internal_sale_actual(uuid,jsonb,uuid,text,uuid,integer)','(select s.to_branch_id from public.internal_sales s where s.id=p_sale_id and s.tenant_id=public.get_user_tenant_id())'),
 ('public.receive_internal_sale_with_uom(uuid,jsonb,uuid,text,uuid,integer)','(select s.to_branch_id from public.internal_sales s where s.id=p_sale_id and s.tenant_id=public.get_user_tenant_id())'),
 ('public.reclassify_internal_receipt_to_stock_20261021(uuid,uuid,integer,uuid,text)','(select s.to_branch_id from public.internal_sale_receipts r join public.internal_sales s on s.id=r.internal_sale_id and s.tenant_id=r.tenant_id where r.id=p_receipt_id and r.tenant_id=public.get_user_tenant_id())')
 ) entries(signature,branch_expression) loop
  target:=to_regprocedure(item.signature);
  if target is null then raise exception 'STAFF_PURCHASE_CONSUMER_MISSING: %',item.signature; end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''inventory\.create_po''\)',
   '_staff_permission_at_scope(\1,''inventory.create_po'','||item.branch_expression||')','g');
  if patched=source then raise exception 'STAFF_PURCHASE_CONSUMER_CHANGED: %',item.signature; end if;
  execute patched;
 end loop;
 target:='public._apply_manual_stock_movement_auth_impl_00246(uuid,uuid,uuid,jsonb)'::regprocedure;
 source:=pg_get_functiondef(target);
 patched:=replace(source,'v_permission in (''inventory.dispose'',''inventory.internal_export'',''inventory.adjust'')',
  'v_permission in (''inventory.dispose'',''inventory.internal_export'',''inventory.adjust'',''inventory.create_po'')');
 if patched=source then raise exception 'STAFF_PURCHASE_MANUAL_CONSUMER_CHANGED'; end if;
 execute patched;
end $migration$;
-- RPCs perform branch checks and preserve accounting invariants. Actors with
-- local exceptions must not bypass those checks via legacy direct table writes.
create function public._staff_direct_purchase_write_allowed()
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.user_branch_permission_overrides o
  where o.user_id=auth.uid() and o.permission_code='inventory.create_po')
$$;
revoke all on function public._staff_direct_purchase_write_allowed() from public,anon;
grant execute on function public._staff_direct_purchase_write_allowed() to authenticated;
do $policies$
declare table_name text;
begin
 foreach table_name in array array['purchase_orders','purchase_order_items','supplier_returns','supplier_return_items'] loop
  execute format('create policy staff_purchase_insert on public.%I as restrictive for insert to authenticated with check ((select public._staff_direct_purchase_write_allowed()))',table_name);
  execute format('create policy staff_purchase_update on public.%I as restrictive for update to authenticated using ((select public._staff_direct_purchase_write_allowed())) with check ((select public._staff_direct_purchase_write_allowed()))',table_name);
  execute format('create policy staff_purchase_delete on public.%I as restrictive for delete to authenticated using ((select public._staff_direct_purchase_write_allowed()))',table_name);
 end loop;
end $policies$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values('inventory.create_po',1);
commit;
