-- The assigned-branch stock total is distinct from the independent rights to
-- read inventory, sell, or view reports; preserve those rights unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_assigned_stock_total_allowed(p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.branches b on b.tenant_id=p.tenant_id
  where p.id=auth.uid() and coalesce(p.is_active,true) and b.id=p_branch
   and public.user_has_branch_access(p.id,b.id)
   and public._staff_permission_at_scope(p.id,'inventory.view_assigned_totals',b.id))
$$;
revoke all on function public._staff_assigned_stock_total_allowed(uuid) from public,anon;
grant execute on function public._staff_assigned_stock_total_allowed(uuid) to authenticated;
do $$declare source text; patched text; old_acl text; old_owner oid; old_options text[];
 anchor constant text := 'user_has_permission(auth.uid(), ''inventory.view_assigned_totals''::text)';
 first_pos integer; second_pos integer;
begin
 select pg_get_viewdef(c.oid,true),c.relacl::text,c.relowner,c.reloptions into strict source,old_acl,old_owner,old_options
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='products_scoped' and c.relkind='v';
 if not coalesce('security_barrier=true'=any(old_options),false)
  or (length(source)-length(replace(source,anchor,'')))/length(anchor)<>2
  or position('visible_branch.id' in source)=0 or position('bs.branch_id' in source)=0 then
  raise exception 'ASSIGNED_STOCK_VIEW_BASELINE_CHANGED';end if;
 first_pos:=position(anchor in source);
 patched:=overlay(source placing 'public._staff_assigned_stock_total_allowed(visible_branch.id)' from first_pos for length(anchor));
 second_pos:=position(anchor in patched);
 patched:=overlay(patched placing 'public._staff_assigned_stock_total_allowed(bs.branch_id)' from second_pos for length(anchor));
 execute format('create or replace view public.products_scoped with (%s) as %s',array_to_string(old_options,','),patched);
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='products_scoped'
   and (c.relacl::text is distinct from old_acl or c.relowner<>old_owner or c.reloptions is distinct from old_options)) then
  raise exception 'ASSIGNED_STOCK_VIEW_METADATA_CHANGED';end if;
end$$;
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version)
values ('inventory.view_assigned_totals',1);
commit;
