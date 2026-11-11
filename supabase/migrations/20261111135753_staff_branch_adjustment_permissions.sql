begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; target regprocedure; source text; patched text;
begin
 for item in select * from (values
  ('public.adjust_stock_to_value_atomic(uuid,uuid,uuid,numeric,numeric,text)','p_branch_id'),
  ('public.get_inventory_opening_warehouse_prices(uuid,uuid[])','p_branch_id'),
  ('public.preview_inventory_opening_00442(jsonb)',
   '(select b.id from public.branches b where b.tenant_id=public.get_user_tenant_id() and b.code=p_rows->0->>''branchCode'')'),
  ('public._expiry_opening_base_00527(uuid,jsonb,jsonb,text,timestamp with time zone,text,text)',
   'coalesce((select b.branch_id from public.inventory_opening_batches b where b.id=p_batch_id and b.tenant_id=public.get_user_tenant_id()),(select b.id from public.branches b where b.tenant_id=public.get_user_tenant_id() and b.code=p_rows->0->>''branchCode''))'),
  ('public._revert_received_po_global_wac_impl_00403(uuid,uuid,boolean)',
   '(select p.branch_id from public.purchase_orders p where p.id=p_order_id and p.tenant_id=public.get_user_tenant_id())'),
  ('public.receive_internal_sale_actual(uuid,jsonb,uuid,text,uuid,integer)',
   '(select s.to_branch_id from public.internal_sales s where s.id=p_sale_id and s.tenant_id=public.get_user_tenant_id())'),
  ('public.receive_internal_sale_with_uom(uuid,jsonb,uuid,text,uuid,integer)',
   '(select s.to_branch_id from public.internal_sales s where s.id=p_sale_id and s.tenant_id=public.get_user_tenant_id())'),
  ('public.reclassify_internal_receipt_to_stock_20261021(uuid,uuid,integer,uuid,text)',
   '(select s.to_branch_id from public.internal_sale_receipts r join public.internal_sales s on s.id=r.internal_sale_id and s.tenant_id=r.tenant_id where r.id=p_receipt_id and r.tenant_id=public.get_user_tenant_id())'),
  ('public.set_input_invoice_state_atomic(uuid,text,text)',
   '(select i.branch_id from public.input_invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())')
 ) entries(signature,branch_expression) loop
  target:=to_regprocedure(item.signature);
  if target is null then raise exception 'STAFF_ADJUSTMENT_CONSUMER_MISSING: %',item.signature; end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''inventory\.adjust''\)',
   '_staff_permission_at_scope(\1,''inventory.adjust'','||item.branch_expression||')','g');
  if patched=source then raise exception 'STAFF_ADJUSTMENT_CONSUMER_CHANGED: %',item.signature; end if;
  execute patched;
 end loop;
 target:='public._apply_manual_stock_movement_auth_impl_00246(uuid,uuid,uuid,jsonb)'::regprocedure;
 source:=pg_get_functiondef(target);
 patched:=replace(source,'v_permission in (''inventory.dispose'',''inventory.internal_export'')',
  'v_permission in (''inventory.dispose'',''inventory.internal_export'',''inventory.adjust'')');
 if patched=source then raise exception 'STAFF_ADJUSTMENT_MANUAL_CONSUMER_CHANGED'; end if;
 execute patched;
end $migration$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values('inventory.adjust',1);
commit;
