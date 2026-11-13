-- Enable branch-specific F&B order viewing only once view policies, payment
-- and independent print permissions have been installed. No user is modified.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare missing text; payment oid:=to_regprocedure('public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)');
 printer oid:=to_regprocedure('public.fnb_print_enqueue_v1(uuid,uuid,text,text,text,text)');
begin
 if to_regprocedure('public._staff_fnb_order_direct_read(uuid,uuid)') is null
  or to_regprocedure('public._staff_my_fnb_order_view(uuid)') is null
  or payment is null or printer is null
  or position('or public._staff_permission_at_scope(v_actor,''pos_fnb.checkout''' in lower(pg_get_functiondef(payment)))=0
  or position('pos_fnb.checkout' in pg_get_functiondef(printer))=0
  or position('pos_fnb.send_kitchen' in pg_get_functiondef(printer))=0 then
  raise exception 'STAFF_FNB_VIEW_READERS_OR_OPERATIONS_MISSING';
 end if;
 select string_agg(x.tbl||'.'||x.pol,', ' order by x.tbl,x.pol) into missing
 from (values ('invoices','staff_invoice_header_view_scope'),
  ('invoice_items','staff_invoice_item_view_scope'),
  ('kitchen_orders','staff_fnb_order_view_read'),
  ('kitchen_order_items','staff_fnb_order_item_view_read')) x(tbl,pol)
 where not exists(select 1 from pg_policies p where p.schemaname='public'
  and p.tablename=x.tbl and p.policyname=x.pol and p.cmd='SELECT');
 if missing is not null then raise exception 'STAFF_FNB_VIEW_POLICIES_MISSING: %',missing;end if;
end
$migration$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('pos_fnb.view_orders',1);
commit;
