-- Scope recipe writes while preserving independent company-wide product rights.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_bom_write_allowed(p_tenant uuid,p_branch uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or p_tenant is distinct from public.get_user_tenant_id()
  or not exists(select 1 from public.profiles p where p.id=actor and p.tenant_id=p_tenant and p.is_active)
  or (p_branch is not null and not exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=p_tenant)) then return false;end if;
 -- Product creation/edit/import are existing company-wide entry points to the
 -- BOM editor; their independent rights must not be silently removed.
 if public.user_has_permission(actor,'products.create') or public.user_has_permission(actor,'products.edit')
  or public.user_has_permission(actor,'products.import') then return true;end if;
 if p_branch is null then return coalesce(public.user_has_permission(actor,'production.manage_bom'),false);end if;
 return coalesce(public._staff_permission_at_scope(actor,'production.manage_bom',p_branch),false);
end$$;
revoke all on function public._staff_bom_write_allowed(uuid,uuid) from public,anon;
grant execute on function public._staff_bom_write_allowed(uuid,uuid) to authenticated;
create function public._staff_bom_child_write_allowed(p_tenant uuid,p_bom uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.bom b where b.id=p_bom and b.tenant_id=p_tenant
  and public._staff_bom_write_allowed(b.tenant_id,b.branch_id))
$$;
revoke all on function public._staff_bom_child_write_allowed(uuid,uuid) from public,anon;
grant execute on function public._staff_bom_child_write_allowed(uuid,uuid) to authenticated;
create policy staff_bom_insert_scope on public.bom as restrictive for insert to authenticated
 with check (public._staff_bom_write_allowed(tenant_id,branch_id));
create policy staff_bom_update_scope on public.bom as restrictive for update to authenticated
 using (public._staff_bom_write_allowed(tenant_id,branch_id)) with check (public._staff_bom_write_allowed(tenant_id,branch_id));
create policy staff_bom_delete_scope on public.bom as restrictive for delete to authenticated
 using (public._staff_bom_write_allowed(tenant_id,branch_id));
create policy staff_bom_items_insert_scope on public.bom_items as restrictive for insert to authenticated
 with check (public._staff_bom_child_write_allowed(public.get_user_tenant_id(),bom_id));
create policy staff_bom_items_update_scope on public.bom_items as restrictive for update to authenticated
 using (public._staff_bom_child_write_allowed(public.get_user_tenant_id(),bom_id))
 with check (public._staff_bom_child_write_allowed(public.get_user_tenant_id(),bom_id));
create policy staff_bom_items_delete_scope on public.bom_items as restrictive for delete to authenticated
 using (public._staff_bom_child_write_allowed(public.get_user_tenant_id(),bom_id));
create policy staff_bom_option_insert_scope on public.bom_modifier_option_quantities as restrictive for insert to authenticated
 with check (public._staff_bom_child_write_allowed(tenant_id,bom_id));
create policy staff_bom_option_update_scope on public.bom_modifier_option_quantities as restrictive for update to authenticated
 using (public._staff_bom_child_write_allowed(tenant_id,bom_id)) with check (public._staff_bom_child_write_allowed(tenant_id,bom_id));
create policy staff_bom_option_delete_scope on public.bom_modifier_option_quantities as restrictive for delete to authenticated
 using (public._staff_bom_child_write_allowed(tenant_id,bom_id));
do $$declare body text; patched text; anchor text; item record;begin
 for item in select * from (values
  ('public.save_bom_modifier_option_quantities(uuid,jsonb)','157f6951d81ab20c4abb912ab52582b2'),
  ('public.clone_bom_for_branch_atomic(uuid,uuid)','3dd104b4dea4e8d8056337beb33bd829')
 ) as expected(signature,source_hash) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature) and p.prosecdef
    and md5(replace(p.prosrc,chr(13),''))=item.source_hash) then raise exception 'BOM_WRITE_BASELINE_CHANGED: %',item.signature;end if;
 end loop;
 select replace(pg_get_functiondef('public.save_bom_modifier_option_quantities(uuid,jsonb)'::regprocedure),chr(13),'') into body;
 anchor:='if p_rows is null or jsonb_typeof(p_rows) <> ''array'' then';
 patched:=replace(body,anchor,'if not public._staff_bom_child_write_allowed(v_tenant,p_bom_id) then raise exception using errcode = ''42501'', message = ''BOM_WRITE_PERMISSION_DENIED''; end if;' || chr(10) || '  ' || anchor);
 if patched=body then raise exception 'BOM_SAVE_SCOPE_PATCH_MISSING';end if;execute patched;
 select replace(pg_get_functiondef('public.clone_bom_for_branch_atomic(uuid,uuid)'::regprocedure),chr(13),'') into body;
 anchor:='public.user_has_permission(v_actor, ''production.manage_bom'')';
 patched:=replace(body,anchor,'public._staff_permission_at_scope(v_actor, ''production.manage_bom'', p_target_branch_id)');
 if patched=body then raise exception 'BOM_CLONE_SCOPE_PATCH_MISSING';end if;execute patched;
end$$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('production.manage_bom',1);
commit;
