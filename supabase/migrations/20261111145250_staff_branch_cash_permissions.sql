begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Resolve document operations from persisted documents. Caller-supplied branch
-- is used only for operations creating a new independent cash transaction.
create function public._staff_cash_payload_branch(p_operation text,p_payload jsonb)
returns uuid language sql stable security definer set search_path='' as $$
 select case p_operation
  when 'invoice' then (select __staff_i.branch_id from public.invoices __staff_i where __staff_i.id=(p_payload->>'referenceId')::uuid and __staff_i.tenant_id=public.get_user_tenant_id())
  when 'purchase_order' then (select __staff_p.branch_id from public.purchase_orders __staff_p where __staff_p.id=(p_payload->>'referenceId')::uuid and __staff_p.tenant_id=public.get_user_tenant_id())
  when 'manual' then (p_payload->>'branchId')::uuid
  when 'customer_advance' then (p_payload->>'branchId')::uuid
  when 'supplier_advance' then (p_payload->>'branchId')::uuid end
$$;
revoke all on function public._staff_cash_payload_branch(text,jsonb) from public,anon,authenticated;
create function public._staff_cash_catalog_permission(p_user uuid,p_code text,p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select case when p_branch is null then public._staff_permission_any_branch(p_user,p_code)
 else public._staff_permission_at_scope(p_user,p_code,p_branch) end
$$;
revoke all on function public._staff_cash_catalog_permission(uuid,text,uuid) from public,anon,authenticated;
do $migration$
declare item record; target oid; n integer; source text; patched text;
begin
 for item in select * from (values
 ('amend_party_cash','(select __staff_c.branch_id from public.cash_transactions __staff_c where __staff_c.id=p_cash_id and __staff_c.tenant_id=public.get_user_tenant_id())'),
 ('cancel_cash_transaction','(select __staff_c.branch_id from public.cash_transactions __staff_c where __staff_c.id=p_cash_id and __staff_c.tenant_id=public.get_user_tenant_id())'),
 ('cancel_party_advance_refund','(select __staff_c.branch_id from public.cash_transactions __staff_c where __staff_c.id=p_cash_id and __staff_c.tenant_id=public.get_user_tenant_id())'),
 ('apply_customer_advance_to_invoice','(select __staff_i.branch_id from public.invoices __staff_i where __staff_i.id=p_invoice_id and __staff_i.tenant_id=public.get_user_tenant_id())'),
 ('apply_supplier_advance_to_purchase_order','(select __staff_p.branch_id from public.purchase_orders __staff_p where __staff_p.id=p_purchase_order_id and __staff_p.tenant_id=public.get_user_tenant_id())'),
 ('create_manual_cash_transaction_atomic','p_branch_id'),
 ('get_cash_journal_operation_templates_v1','p_branch_id'),
 ('get_cash_performers','p_branch_id'),
 ('get_internal_return_finance','r.to_branch_id'),
 ('post_cash_journal_request','p_branch_id'),
 ('record_cash_transaction_context','public._staff_cash_payload_branch(p_operation,p_payload)'),
 ('record_cash_transaction_timed','v_row.branch_id'),
 ('record_cash_with_account','public._staff_cash_payload_branch(p_operation,p_payload)'),
 ('record_customer_advance','p_branch_id'),
 ('record_supplier_advance','p_branch_id'),
 ('record_invoice_payment','(select __staff_i.branch_id from public.invoices __staff_i where __staff_i.id=p_invoice_id and __staff_i.tenant_id=public.get_user_tenant_id())'),
 ('record_purchase_payment','(select __staff_p.branch_id from public.purchase_orders __staff_p where __staff_p.id=p_purchase_order_id and __staff_p.tenant_id=public.get_user_tenant_id())'),
 ('refund_party_advance','b'),
 ('settle_cod_scoped_v1','p_branch_id'),
 ('settle_internal_return_credit','r.to_branch_id'),
 ('settle_party_documents_atomic','b')
 ) entries(name,branch_expression) loop
  select count(*),min(__staff_p.oid::bigint)::oid into n,target from pg_proc __staff_p where __staff_p.pronamespace='public'::regnamespace and __staff_p.proname=item.name;
  if n<>1 then raise exception 'STAFF_CASH_CONSUMER_AMBIGUOUS: %',item.name;end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''(finance\.(?:create_transaction|void_transaction))''\)',
   '_staff_permission_at_scope(\1,''\2'','||item.branch_expression||')','g');
  if patched=source then raise exception 'STAFF_CASH_CONSUMER_CHANGED: %',item.name;end if;execute patched;
 end loop;
 source:=pg_get_functiondef('public.get_cash_journal_catalog_v1(uuid)'::regprocedure);
 patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''finance\.create_transaction''\)',
  '_staff_cash_catalog_permission(\1,''finance.create_transaction'',p_branch_id)','g');
 if patched=source then raise exception 'STAFF_CASH_CATALOG_CHANGED';end if;execute patched;
 source:=pg_get_functiondef('public.settle_cod_atomic(uuid,jsonb,text,text,uuid)'::regprocedure);
 patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''finance\.create_transaction''\)',
  '_staff_permission_any_branch(\1,''finance.create_transaction'')','g');
 if patched=source or position('if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then' in source)=0 then raise exception 'STAFF_COD_SCOPE_CHANGED';end if;
 patched:=replace(patched,'if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then',
  'if not public._staff_permission_at_scope(v_actor,''finance.create_transaction'',v_invoice.branch_id) or not public.user_has_branch_access(v_actor, v_invoice.branch_id) then');
 execute patched;
end $migration$;
-- save_money_account/delete_money_account remain account-wide configuration
-- operations. A branch-only grant must never authorize changing shared accounts.
create function public._staff_direct_cash_write_allowed()
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.user_branch_permission_overrides o where o.user_id=auth.uid()
 and o.permission_code in ('finance.create_transaction','finance.void_transaction'))
$$;
revoke all on function public._staff_direct_cash_write_allowed() from public,anon;
grant execute on function public._staff_direct_cash_write_allowed() to authenticated;
create policy staff_cash_insert on public.cash_transactions as restrictive for insert to authenticated with check ((select public._staff_direct_cash_write_allowed()));
create policy staff_cash_update on public.cash_transactions as restrictive for update to authenticated using ((select public._staff_direct_cash_write_allowed())) with check ((select public._staff_direct_cash_write_allowed()));
create policy staff_cash_delete on public.cash_transactions as restrictive for delete to authenticated using ((select public._staff_direct_cash_write_allowed()));
insert into public.staff_branch_permission_catalog values('finance.create_transaction',1),('finance.void_transaction',1);
commit;

