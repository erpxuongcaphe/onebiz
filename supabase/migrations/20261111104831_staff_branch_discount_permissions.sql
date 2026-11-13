begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Keep OTP target/amount/item checks and the payment implementation intact.
-- Resolve scope from persisted documents, never from a caller-selected branch.
do $patch$
declare item record; target oid; n integer; source text; patched text;
begin
 for item in select * from (values
  ('_fnb_complete_payment_impl_00343','v_order.branch_id'),
  ('fnb_complete_payment_atomic','(select staff_discount_scope.branch_id from public.kitchen_orders staff_discount_scope where staff_discount_scope.id=p_kitchen_order_id and staff_discount_scope.tenant_id=v_tenant_id)'),
  ('record_discount_audit','(select staff_discount_scope.branch_id from public.invoices staff_discount_scope where staff_discount_scope.id=p_invoice_id and staff_discount_scope.tenant_id=v_caller_tenant)')
 ) as entries(name,branch_expression) loop
  select count(*),min(p.oid::bigint)::oid into n,target from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if n<>1 then raise exception 'STAFF_DISCOUNT_CONSUMER_AMBIGUOUS: %',item.name;end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''pos_fnb\.discount''\)',
   '_staff_permission_at_scope(\1,''pos_fnb.discount'','||item.branch_expression||')','g');
  if patched=source then raise exception 'STAFF_DISCOUNT_CONSUMER_CHANGED: %',item.name;end if;execute patched;
 end loop;
end $patch$;
-- Dynamic manager-approval and OTP consumers were scoped in earlier migrations.
insert into public.staff_branch_permission_catalog values('pos_fnb.discount',1);
commit;
