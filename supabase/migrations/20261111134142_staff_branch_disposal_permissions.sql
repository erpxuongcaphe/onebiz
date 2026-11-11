begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare item record; target regprocedure; source text; patched text;
begin
 for item in select * from (values
  ('public._create_and_apply_stock_export_00268(text,uuid,text,text,jsonb)','p_branch_id'),
  ('public._cancel_stock_export_00269(text,uuid,text)',
   '(select d.branch_id from public.disposal_exports d where d.id=p_document_id and d.tenant_id=public.get_user_tenant_id())'),
  ('public._void_disposal_export_auth_impl_00246(uuid,uuid,text)',
   '(select d.branch_id from public.disposal_exports d where d.id=p_disposal_id and d.tenant_id=public.get_user_tenant_id())'),
  ('public.apply_disposal_export_atomic(uuid,uuid)',
   '(select d.branch_id from public.disposal_exports d where d.id=p_disposal_id and d.tenant_id=public.get_user_tenant_id())')
 ) entries(signature,branch_expression) loop
  target:=to_regprocedure(item.signature);
  if target is null then raise exception 'STAFF_DISPOSAL_CONSUMER_MISSING: %',item.signature; end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''inventory\.dispose''\)',
   '_staff_permission_at_scope(\1,''inventory.dispose'','||item.branch_expression||')','g');
  if patched=source then raise exception 'STAFF_DISPOSAL_CONSUMER_CHANGED: %',item.signature; end if;
  execute patched;
 end loop;
 target:='public._apply_manual_stock_movement_auth_impl_00246(uuid,uuid,uuid,jsonb)'::regprocedure;
 source:=pg_get_functiondef(target);
 patched:=replace(source,'public.user_has_permission(v_actor, v_permission)',
  '(case when v_permission=''inventory.dispose'' then public._staff_permission_at_scope(v_actor,v_permission,p_branch_id) else public.user_has_permission(v_actor,v_permission) end)');
 if patched=source then raise exception 'STAFF_DISPOSAL_MANUAL_CONSUMER_CHANGED'; end if;
 execute patched;
 target:='public.create_stock_operation_with_uom(text,uuid,jsonb,uuid,uuid,text,text)'::regprocedure;
 source:=pg_get_functiondef(target);
 patched:=replace(source,'else public.user_has_permission(actor,permission) end)',
  'when permission=''inventory.dispose'' then public._staff_permission_at_scope(actor,permission,p_branch_id) else public.user_has_permission(actor,permission) end)');
 if patched=source then raise exception 'STAFF_DISPOSAL_UOM_CONSUMER_CHANGED'; end if;
 execute patched;
end $migration$;
create function public._staff_direct_disposal_write_allowed()
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.user_branch_permission_overrides o
  where o.user_id=auth.uid() and o.permission_code='inventory.dispose')
$$;
revoke all on function public._staff_direct_disposal_write_allowed() from public,anon;
grant execute on function public._staff_direct_disposal_write_allowed() to authenticated;
do $policies$
declare table_name text;
begin
 foreach table_name in array array['disposal_exports','disposal_export_items'] loop
  execute format('create policy staff_disposal_insert on public.%I as restrictive for insert to authenticated with check ((select public._staff_direct_disposal_write_allowed()))',table_name);
  execute format('create policy staff_disposal_update on public.%I as restrictive for update to authenticated using ((select public._staff_direct_disposal_write_allowed())) with check ((select public._staff_direct_disposal_write_allowed()))',table_name);
  execute format('create policy staff_disposal_delete on public.%I as restrictive for delete to authenticated using ((select public._staff_direct_disposal_write_allowed()))',table_name);
 end loop;
end $policies$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values('inventory.dispose',1);
commit;
