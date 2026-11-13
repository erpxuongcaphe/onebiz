-- Shipping locks its own row before the invoice. Other paths lock in the
-- opposite order, so a restricted user's invoice lock must never wait.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare source text; changed text; anchor text;
begin
 source:=pg_get_functiondef('public._staff_order_target_visible(uuid)'::regprocedure);
 if (length(source)-length(replace(source,'for update','')))/length('for update')<>1
    or position('public._staff_order_target_visible(' in source)=0 then
  raise exception 'STAFF_SHIPPING_OWNER_HELPER_CHANGED';
 end if;
 changed:=replace(replace(source,'public._staff_order_target_visible(','public._staff_order_target_visible_nowait('),'for update','for update nowait');
 execute changed;
 revoke all on function public._staff_order_target_visible_nowait(uuid) from public,anon,authenticated;
 source:=pg_get_functiondef('public.update_shipping_order_status_atomic(uuid,text,text)'::regprocedure);
 anchor:='update public.shipping_orders so';
 if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1
    or position('SHIPPING_STATUS_PERMISSION_REQUIRED' in source)=0
    or position('for update of so' in lower(source))=0 then
  raise exception 'STAFF_SHIPPING_OWNER_CONSUMER_CHANGED';
 end if;
 execute replace(source,anchor,
  'if not public._staff_order_target_visible_nowait(v_order.invoice_id) then raise exception ''STAFF_OWN_ORDER_ACTION_DENIED'' using errcode=''42501''; end if; '||anchor);
end $patch$;
commit;
