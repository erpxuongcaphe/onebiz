begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $gate$
declare name text; source text; n integer;
begin
 foreach name in array array[
   'attach_invoice_shipment_atomic','close_sales_order_processing',
   'close_sales_orders_processing','complete_legacy_sales_order_atomic',
   'create_child_sale_from_order','duplicate_invoice_to_order_atomic',
   'mark_order_processed','reopen_sales_order_processing','save_sales_order_atomic',
   'update_draft_invoice_atomic','update_shipping_order_status_atomic'
 ] loop
   select count(*),min(pg_get_functiondef(p.oid)) into n,source
     from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=name;
   if n<>1 or position('_staff_permission_at_scope' in source)=0 or position('orders.create' in source)=0 then
     raise exception 'STAFF_ORDER_CREATE_SCOPE_MISSING: %',name;
   end if;
 end loop;
 select count(*) into n from pg_policies where schemaname='public'
   and tablename=any(array['invoices','invoice_items','sales_orders','sales_order_items','shipping_orders'])
   and policyname=any(array['staff_order_insert','staff_order_update','staff_order_delete'])
   and permissive='RESTRICTIVE';
 if n<>15 then raise exception 'STAFF_ORDER_DIRECT_WRITE_GUARDS_MISSING'; end if;
end $gate$;
insert into public.staff_branch_permission_catalog values('orders.create',1);
commit;
