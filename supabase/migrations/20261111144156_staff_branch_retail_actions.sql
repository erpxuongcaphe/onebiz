begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; target regprocedure; source text; patched text;
begin
 for item in select * from (values
 ('public.adopt_pos_draft_session_atomic(uuid,text)','pos_retail.save_draft','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())'),
 ('public.adopt_pos_draft_session_atomic_v2(uuid,text,bigint)','pos_retail.save_draft','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())'),
 ('public.soft_delete_pos_draft_atomic(uuid,boolean)','pos_retail.save_draft','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())'),
 ('public.save_pos_draft_atomic(uuid,uuid,jsonb,text,numeric,numeric,numeric,numeric,text,text,boolean)','pos_retail.save_draft','p_branch_id'),
 ('public.save_pos_draft_atomic_v3(uuid,uuid,jsonb,text,numeric,numeric,numeric,text,text,boolean,uuid,bigint)','pos_retail.save_draft','coalesce((select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id()),p_branch_id)'),
 ('public.pos_prepare_retail_checkout(uuid,uuid,uuid,uuid,jsonb,text,numeric,uuid,text,integer,uuid,numeric,numeric)','pos_retail.edit_price','p_branch_id'),
 ('public._void_completed_invoice_atomic_v2_impl_00250(uuid,text,text,uuid)','pos_retail.void','(select i.branch_id from public.invoices i where i.id=p_invoice_id and i.tenant_id=public.get_user_tenant_id())'),
 ('public.cancel_internal_sale_atomic(uuid,text)','pos_retail.void','(select s.from_branch_id from public.internal_sales s where s.id=p_internal_sale_id and s.tenant_id=public.get_user_tenant_id())'),
 ('public.get_document_payment_history_scoped(text,uuid,integer,integer)','pos_retail.void','v_branch')
 ) entries(signature,permission_code,branch_expression) loop
  target:=to_regprocedure(item.signature);
  if target is null then raise exception 'STAFF_RETAIL_ACTION_CONSUMER_MISSING: %',item.signature; end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*'''||replace(item.permission_code,'.','\.')||'''\)',
   '_staff_permission_at_scope(\1,'''||item.permission_code||''','||item.branch_expression||')','g');
  if patched=source then raise exception 'STAFF_RETAIL_ACTION_CONSUMER_CHANGED: %',item.signature; end if;
  execute patched;
 end loop;
end $migration$;
-- Require the existing invariant-preserving RPCs for actors with local Retail
-- exceptions; do not let changing an invoice source/status bypass the guard.
create function public._staff_direct_retail_write_allowed()
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.user_branch_permission_overrides o
  where o.user_id=auth.uid() and o.permission_code in ('pos_retail.save_draft','pos_retail.edit_price','pos_retail.void'))
$$;
revoke all on function public._staff_direct_retail_write_allowed() from public,anon;
grant execute on function public._staff_direct_retail_write_allowed() to authenticated;
do $policies$
declare table_name text;
begin
 foreach table_name in array array['invoices','invoice_items'] loop
  execute format('create policy staff_retail_insert on public.%I as restrictive for insert to authenticated with check ((select public._staff_direct_retail_write_allowed()))',table_name);
  execute format('create policy staff_retail_update on public.%I as restrictive for update to authenticated using ((select public._staff_direct_retail_write_allowed())) with check ((select public._staff_direct_retail_write_allowed()))',table_name);
  execute format('create policy staff_retail_delete on public.%I as restrictive for delete to authenticated using ((select public._staff_direct_retail_write_allowed()))',table_name);
 end loop;
end $policies$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values
 ('pos_retail.save_draft',1),('pos_retail.edit_price',1),('pos_retail.void',1);
commit;
