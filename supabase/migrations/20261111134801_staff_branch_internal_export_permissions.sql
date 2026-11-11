-- Internal supply is authorized at its source warehouse. Preserve the existing
-- warehouse-to-store destination exception and all downstream cost/cash rules.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; target regprocedure; source text; patched text;
begin
 for item in select * from (values
  ('public._create_internal_sale_auth_impl_00243(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)','p_from_branch_id'),
  ('public.checkout_internal_pos_atomic(uuid,uuid,jsonb,text,numeric,uuid,uuid,integer,uuid,text)','p_from_branch_id'),
  ('public.checkout_internal_pos_v2(jsonb)','branch'),
  ('public._checkout_internal_pos_before_fnb_bridge_20261023(jsonb)','v_branch'),
  ('public.cancel_internal_sale_atomic(uuid,text)',
   '(select s.from_branch_id from public.internal_sales s where s.id=p_internal_sale_id and s.tenant_id=public.get_user_tenant_id())'),
  ('public._cancel_internal_sale_draft_00471(uuid,text)',
   '(select s.from_branch_id from public.internal_sales s where s.id=p_internal_sale_id and s.tenant_id=public.get_user_tenant_id())'),
  ('public._create_and_apply_stock_export_00268(text,uuid,text,text,jsonb)','p_branch_id'),
  ('public._cancel_stock_export_00269(text,uuid,text)',
   '(select e.branch_id from public.internal_exports e where e.id=p_document_id and e.tenant_id=public.get_user_tenant_id())'),
  ('public._void_internal_export_auth_impl_00246(uuid,uuid,text)',
   '(select e.branch_id from public.internal_exports e where e.id=p_export_id and e.tenant_id=public.get_user_tenant_id())'),
  ('public.apply_internal_export_atomic(uuid,uuid)',
   '(select e.branch_id from public.internal_exports e where e.id=p_export_id and e.tenant_id=public.get_user_tenant_id())')
 ) entries(signature,branch_expression) loop
  target:=to_regprocedure(item.signature);
  if target is null then raise exception 'STAFF_INTERNAL_EXPORT_CONSUMER_MISSING: %',item.signature; end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''inventory\.internal_export''\)',
   '_staff_permission_at_scope(\1,''inventory.internal_export'','||item.branch_expression||')','g');
  if patched=source then raise exception 'STAFF_INTERNAL_EXPORT_CONSUMER_CHANGED: %',item.signature; end if;
  execute patched;
 end loop;
 target:='public._apply_manual_stock_movement_auth_impl_00246(uuid,uuid,uuid,jsonb)'::regprocedure;
 source:=pg_get_functiondef(target);
 patched:=replace(source,'v_permission=''inventory.dispose''','v_permission in (''inventory.dispose'',''inventory.internal_export'')');
 if patched=source then raise exception 'STAFF_INTERNAL_EXPORT_MANUAL_CONSUMER_CHANGED'; end if;
 execute patched;
 target:='public.create_stock_operation_with_uom(text,uuid,jsonb,uuid,uuid,text,text)'::regprocedure;
 source:=pg_get_functiondef(target);
 patched:=replace(source,'when permission=''inventory.dispose''','when permission in (''inventory.dispose'',''inventory.internal_export'')');
 if patched=source then raise exception 'STAFF_INTERNAL_EXPORT_UOM_CONSUMER_CHANGED'; end if;
 execute patched;
end $migration$;
create function public._staff_direct_internal_export_write_allowed()
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.user_branch_permission_overrides o
  where o.user_id=auth.uid() and o.permission_code='inventory.internal_export')
$$;
revoke all on function public._staff_direct_internal_export_write_allowed() from public,anon;
grant execute on function public._staff_direct_internal_export_write_allowed() to authenticated;
do $policies$
declare table_name text;
begin
 foreach table_name in array array['internal_exports','internal_export_items','internal_sales','internal_sale_items'] loop
  execute format('create policy staff_internal_export_insert on public.%I as restrictive for insert to authenticated with check ((select public._staff_direct_internal_export_write_allowed()))',table_name);
  execute format('create policy staff_internal_export_update on public.%I as restrictive for update to authenticated using ((select public._staff_direct_internal_export_write_allowed())) with check ((select public._staff_direct_internal_export_write_allowed()))',table_name);
  execute format('create policy staff_internal_export_delete on public.%I as restrictive for delete to authenticated using ((select public._staff_direct_internal_export_write_allowed()))',table_name);
 end loop;
end $policies$;
-- Linked sales invoices are also writable through the Data API. Preserve
-- ordinary Retail drafts while requiring atomic RPCs for internal documents.
create function public._staff_direct_internal_invoice_write_allowed(p_invoice uuid,p_source text)
returns boolean language sql stable security definer set search_path='' as $$
 select case when public._staff_direct_internal_export_write_allowed() then true
 else p_source is distinct from 'internal'
  and not exists(select 1 from public.invoices i where i.id=p_invoice
   and i.tenant_id=public.get_user_tenant_id() and i.source='internal')
  and not exists(select 1 from public.internal_sales s where s.invoice_id=p_invoice
   and s.tenant_id=public.get_user_tenant_id()) end
$$;
revoke all on function public._staff_direct_internal_invoice_write_allowed(uuid,text) from public,anon;
grant execute on function public._staff_direct_internal_invoice_write_allowed(uuid,text) to authenticated;
create policy staff_internal_invoice_insert on public.invoices as restrictive for insert to authenticated
 with check(public._staff_direct_internal_invoice_write_allowed(id,source));
create policy staff_internal_invoice_update on public.invoices as restrictive for update to authenticated
 using(public._staff_direct_internal_invoice_write_allowed(id,source)) with check(public._staff_direct_internal_invoice_write_allowed(id,source));
create policy staff_internal_invoice_delete on public.invoices as restrictive for delete to authenticated
 using(public._staff_direct_internal_invoice_write_allowed(id,source));
create policy staff_internal_invoice_item_insert on public.invoice_items as restrictive for insert to authenticated
 with check(public._staff_direct_internal_invoice_write_allowed(invoice_id,null));
create policy staff_internal_invoice_item_update on public.invoice_items as restrictive for update to authenticated
 using(public._staff_direct_internal_invoice_write_allowed(invoice_id,null)) with check(public._staff_direct_internal_invoice_write_allowed(invoice_id,null));
create policy staff_internal_invoice_item_delete on public.invoice_items as restrictive for delete to authenticated
 using(public._staff_direct_internal_invoice_write_allowed(invoice_id,null));
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values('inventory.internal_export',1);
commit;
