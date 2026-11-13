begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; target oid; n integer; source text; patched text;
begin
 for item in select * from (values
 ('_create_sales_return_auth_impl_00244','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())'),
 ('_create_sales_return_auth_impl_00244_pre_00381','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())'),
 ('_pos_balance_before_identity_20261027','p_branch_id'),
 ('attach_invoice_shipment_atomic','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())'),
 ('complete_draft_atomic_v3','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())'),
 ('complete_draft_atomic_v4','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())'),
 ('complete_draft_atomic_v5','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())'),
 ('complete_legacy_sales_order_atomic','(select s.branch_id from public.sales_orders s where s.id=p_order_id and s.tenant_id=public.get_user_tenant_id())'),
 ('create_child_sale_from_order','(select i.branch_id from public.invoices i where i.id=p_order_id and i.tenant_id=public.get_user_tenant_id())'),
 ('get_document_payment_history_scoped','v_branch'),
 ('get_open_shift_status_scoped','p_branch_id'),
 ('get_pos_customer_contacts_scoped','p_branch_id'),
 ('get_pos_retail_customer_contacts_identity','p_branch_id'),
 ('get_shift_context_scoped','v_shift.branch_id'),
 ('get_shift_records_scoped','p_branch_id'),
 ('open_shift_atomic','p_branch_id'),
 ('open_shift_operational','p_branch_id'),
 ('pos_complete_checkout_atomic_v2','p_branch_id'),
 ('pos_complete_checkout_atomic_v3','p_branch_id'),
 ('_staff_checkout_write_allowed','p_branch')
 ) entries(name,branch_expression) loop
  select count(*),min(p.oid::bigint)::oid into n,target from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if n<>1 then raise exception 'STAFF_RETAIL_CHECKOUT_CONSUMER_AMBIGUOUS: %',item.name;end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''pos_retail\.checkout''\)',
   '_staff_permission_at_scope(\1,''pos_retail.checkout'','||item.branch_expression||')','g');
  if patched=source then raise exception 'STAFF_RETAIL_CHECKOUT_CONSUMER_CHANGED: %',item.name;end if;
  execute patched;
 end loop;
 -- A shared walk-in identity does not authorize checkout; the actual payment
 -- still checks its branch. Permit local-only cashiers to obtain that identity.
 source:=pg_get_functiondef('public.get_or_create_walk_in_customer()'::regprocedure);
 patched:=replace(source,'public.user_has_permission(auth.uid(),''pos_retail.checkout'')','public._staff_permission_any_branch(auth.uid(),''pos_retail.checkout'')');
 if patched=source then raise exception 'STAFF_RETAIL_WALK_IN_CHANGED';end if;execute patched;
 -- Cleanup is a multi-branch mutation: check each persisted row, not only the
 -- preliminary permission. Preserve the existing branch-document restriction.
 source:=pg_get_functiondef('public.cleanup_expired_auto_drafts(uuid,integer)'::regprocedure);
 patched:=replace(source,'public.user_has_permission(auth.uid(),''pos_retail.checkout'')','public._staff_permission_any_branch(auth.uid(),''pos_retail.checkout'')');
 if patched=source or position('and public.can_write_branch_document_00567(i.tenant_id,i.branch_id)' in source)=0 then raise exception 'STAFF_RETAIL_CLEANUP_CHANGED';end if;
 patched:=replace(patched,'and public.can_write_branch_document_00567(i.tenant_id,i.branch_id)',
  'and public.can_write_branch_document_00567(i.tenant_id,i.branch_id) and public._staff_permission_at_scope(auth.uid(),''pos_retail.checkout'',i.branch_id)');
 execute patched;
 -- The approval request was already changed to preliminary-any/final-branch
 -- checks by the kitchen migration. Require those guards rather than repatch.
 source:=pg_get_functiondef('public.request_manager_approval_00566(text,jsonb,text)'::regprocedure);
 if position('_staff_permission_at_scope(a,view_perm,b)' in source)=0 or position('_staff_permission_at_scope(a,required,b)' in source)=0 then raise exception 'STAFF_RETAIL_APPROVAL_SCOPE_MISSING';end if;
 source:=pg_get_functiondef('public._staff_direct_retail_write_allowed()'::regprocedure);
 patched:=replace(source,'''pos_retail.void''','''pos_retail.void'',''pos_retail.checkout''');
 if patched=source then raise exception 'STAFF_RETAIL_DIRECT_GUARD_CHANGED';end if;execute patched;
end $migration$;
-- Invoice-linked cash and shift writes must use checked business RPCs too.
do $policies$
declare item record; cmd text;
begin
 for item in select * from (values
 ('cash_transactions','reference_type is distinct from ''invoice'' or (select public._staff_direct_retail_write_allowed())'),
 ('shifts','(select public._staff_direct_retail_write_allowed())')
 ) entries(table_name,predicate) loop
  foreach cmd in array array['INSERT','UPDATE','DELETE'] loop
   execute format('create policy %I on public.%I as restrictive for %s to authenticated %s','staff_retail_'||lower(cmd),item.table_name,cmd,
    case cmd when 'INSERT' then 'with check ('||item.predicate||')' when 'UPDATE' then 'using ('||item.predicate||') with check ('||item.predicate||')' else 'using ('||item.predicate||')' end);
  end loop;
 end loop;
end $policies$;
insert into public.staff_branch_permission_catalog values('pos_retail.checkout',1);
commit;
