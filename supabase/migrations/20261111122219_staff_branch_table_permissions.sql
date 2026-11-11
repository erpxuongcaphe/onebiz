begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Shared settings cannot be edited through a grant limited to one branch.
create function public._staff_table_settings_permission(p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.user_has_permission(p_user,'pos_fnb.manage_tables') and not exists(
  select 1 from public.user_branch_permission_overrides o where o.user_id=p_user
   and o.permission_code='pos_fnb.manage_tables' and o.override_type='revoke')
$$;
revoke all on function public._staff_table_settings_permission(uuid) from public,anon,authenticated;
do $patch$
declare item record; target oid; n integer; source text; patched text;
begin
 for item in select * from (values
  ('mark_fnb_table_available_atomic','_staff_permission_at_scope(v_actor,''pos_fnb.manage_tables'',(select staff_table_scope.branch_id from public.restaurant_tables staff_table_scope where staff_table_scope.id=p_table_id and staff_table_scope.tenant_id=v_tenant_id))'),
  ('update_branch_settings_atomic','_staff_permission_at_scope(v_actor,''pos_fnb.manage_tables'',p_branch_id)'),
  ('patch_tenant_settings_atomic','_staff_table_settings_permission(v_actor)'),
  ('_staff_legacy_merge_permission','_staff_permission_at_scope(p_user,''pos_fnb.manage_tables'',p_branch)')
 ) as entries(name,replacement) loop
  select count(*),min(p.oid::bigint)::oid into n,target from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if n<>1 then raise exception 'STAFF_TABLE_CONSUMER_AMBIGUOUS: %',item.name;end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\((?:v_actor|p_user),\s*''pos_fnb\.manage_tables''\)',item.replacement,'g');
  if patched=source then raise exception 'STAFF_TABLE_CONSUMER_CHANGED: %',item.name;end if;execute patched;
 end loop;
end $patch$;
-- The web already routes writes through guarded security-definer RPCs.
-- A raw table update must not bypass an explicit local restriction.
create function public._staff_direct_table_write_allowed()
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.user_branch_permission_overrides o
  where o.user_id=auth.uid() and o.permission_code='pos_fnb.manage_tables')
$$;
revoke all on function public._staff_direct_table_write_allowed() from public,anon;
grant execute on function public._staff_direct_table_write_allowed() to authenticated;
create policy staff_table_insert_rpc_only on public.restaurant_tables as restrictive for insert to authenticated
 with check ((select public._staff_direct_table_write_allowed()));
create policy staff_table_update_rpc_only on public.restaurant_tables as restrictive for update to authenticated
 using ((select public._staff_direct_table_write_allowed())) with check ((select public._staff_direct_table_write_allowed()));
create policy staff_table_delete_rpc_only on public.restaurant_tables as restrictive for delete to authenticated
 using ((select public._staff_direct_table_write_allowed()));
insert into public.staff_branch_permission_catalog values('pos_fnb.manage_tables',1);
commit;
