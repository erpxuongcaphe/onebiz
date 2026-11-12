-- Resolve cancellation permissions against the persisted order/invoice branch.
-- Catalog activation is deliberately separate until direct DML is audited.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; source text; patched text; anchor text;
begin
 for item in select * from (values
   ('public.cancel_draft_invoice_atomic(uuid,text)',
    '(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=v_tenant_id)'),
   ('public.cancel_legacy_sales_order_atomic(uuid,text)',
    '(select so.branch_id from public.sales_orders so where so.id=p_order_id and so.tenant_id=v_tenant_id)')
 ) as t(signature,branch_expression) loop
   source:=pg_get_functiondef(item.signature::regprocedure);
   patched:=regexp_replace(source,'user_has_permission\(v_actor,\s*''orders\.cancel''\)',
     '_staff_permission_at_scope(v_actor,''orders.cancel'','||item.branch_expression||')','g');
   if patched=source then raise exception 'STAFF_ORDER_CANCEL_CONSUMER_CHANGED: %',item.signature;end if;
   execute patched;
 end loop;
 source:=pg_get_functiondef('public.update_shipping_order_status_atomic(uuid,text,text)'::regprocedure);
 anchor:='public.user_has_permission(v_actor, v_required_permission)';
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
   raise exception 'STAFF_SHIPPING_CANCEL_CONSUMER_CHANGED';end if;
 execute replace(source,anchor,
   '(case when v_required_permission=''orders.cancel'' then public._staff_permission_at_scope(v_actor,v_required_permission,v_order.branch_id) else public.user_has_permission(v_actor,v_required_permission) end)');
end $migration$;
commit;
