-- A transfer mutates both warehouses. Both persisted branches must authorize it.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_transfer_permission(p_user uuid,p_from uuid,p_to uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public._staff_permission_at_scope(p_user,'inventory.transfer',p_from)
  and public._staff_permission_at_scope(p_user,'inventory.transfer',p_to),false)
$$;
revoke all on function public._staff_transfer_permission(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public._staff_transfer_permission(uuid,uuid,uuid) to service_role;
do $migration$
declare item record; target regprocedure; source text; patched text;
begin
 for item in select * from (values
  ('public.create_stock_transfer_atomic(uuid,uuid,text,jsonb)','p_from_branch_id','p_to_branch_id'),
  ('public.set_stock_transfer_state_atomic(uuid,text)',
   '(select st.from_branch_id from public.stock_transfers st where st.id=p_transfer_id and st.tenant_id=public.get_user_tenant_id())',
   '(select st.to_branch_id from public.stock_transfers st where st.id=p_transfer_id and st.tenant_id=public.get_user_tenant_id())'),
  ('public._complete_stock_transfer_auth_impl_00249(uuid,uuid,uuid)',
   '(select st.from_branch_id from public.stock_transfers st where st.id=p_transfer_id and st.tenant_id=public.get_user_tenant_id())',
   '(select st.to_branch_id from public.stock_transfers st where st.id=p_transfer_id and st.tenant_id=public.get_user_tenant_id())')
 ) entries(signature,from_expression,to_expression) loop
  target:=to_regprocedure(item.signature);
  if target is null then raise exception 'STAFF_TRANSFER_CONSUMER_MISSING: %',item.signature; end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''inventory\.transfer''\)',
   '_staff_transfer_permission(\1,'||item.from_expression||','||item.to_expression||')','g');
  if patched=source then raise exception 'STAFF_TRANSFER_CONSUMER_CHANGED: %',item.signature; end if;
  execute patched;
 end loop;
 target:='public.create_stock_operation_with_uom(text,uuid,jsonb,uuid,uuid,text,text)'::regprocedure;
 source:=pg_get_functiondef(target);
 patched:=replace(source,'else public.user_has_permission(actor,permission) end)',
  'when permission=''inventory.transfer'' then public._staff_transfer_permission(actor,p_branch_id,p_to_branch_id) else public.user_has_permission(actor,permission) end)');
 if patched=source then raise exception 'STAFF_TRANSFER_UOM_CONSUMER_CHANGED'; end if;
 execute patched;
end $migration$;
-- Clients with a local exception must use the authorized atomic RPCs. This
-- prevents rewriting document branch IDs or item quantities outside those RPCs.
create function public._staff_direct_transfer_write_allowed()
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.user_branch_permission_overrides o
  where o.user_id=auth.uid() and o.permission_code='inventory.transfer')
$$;
revoke all on function public._staff_direct_transfer_write_allowed() from public,anon;
grant execute on function public._staff_direct_transfer_write_allowed() to authenticated;
do $policies$
declare table_name text;
begin
 foreach table_name in array array['stock_transfers','stock_transfer_items'] loop
  execute format('create policy staff_transfer_insert on public.%I as restrictive for insert to authenticated with check ((select public._staff_direct_transfer_write_allowed()))',table_name);
  execute format('create policy staff_transfer_update on public.%I as restrictive for update to authenticated using ((select public._staff_direct_transfer_write_allowed())) with check ((select public._staff_direct_transfer_write_allowed()))',table_name);
  execute format('create policy staff_transfer_delete on public.%I as restrictive for delete to authenticated using ((select public._staff_direct_transfer_write_allowed()))',table_name);
 end loop;
end $policies$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values('inventory.transfer',1);
commit;
