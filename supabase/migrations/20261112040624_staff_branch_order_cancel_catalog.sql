begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $gate$
declare signature text; n integer;
begin
 foreach signature in array array[
   'public.cancel_draft_invoice_atomic(uuid,text)',
   'public.cancel_legacy_sales_order_atomic(uuid,text)',
   'public.update_shipping_order_status_atomic(uuid,text,text)'
 ] loop
   if position('_staff_permission_at_scope' in pg_get_functiondef(signature::regprocedure))=0 then
     raise exception 'STAFF_ORDER_CANCEL_SCOPE_MISSING: %',signature;
   end if;
 end loop;
 select count(*) into n from pg_policies where schemaname='public'
   and tablename=any(array['invoices','invoice_items','sales_orders','sales_order_items','shipping_orders'])
   and policyname=any(array['staff_order_insert','staff_order_update','staff_order_delete'])
   and permissive='RESTRICTIVE';
 if n<>15 then raise exception 'STAFF_ORDER_DIRECT_WRITE_GUARDS_MISSING'; end if;
end $gate$;
insert into public.staff_branch_permission_catalog values('orders.cancel',1);
commit;
