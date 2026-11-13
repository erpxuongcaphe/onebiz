-- Direct reads must remain within assigned/report/global-floor scope. All web
-- writes use the existing permission-checked SECURITY DEFINER RPCs; raw DML
-- must not bypass those checks when no branch exception has been configured.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
declare table_name text; proc_name text; floor_owner oid; proc_owner oid; is_definer boolean; forced boolean;
begin
 if to_regprocedure('public._staff_direct_floor_write_allowed()') is null
   or to_regprocedure('public._staff_direct_table_write_allowed()') is null
   or position('user_branch_permission_overrides' in pg_get_functiondef('public._staff_direct_floor_write_allowed()'::regprocedure))=0
   or position('user_branch_permission_overrides' in pg_get_functiondef('public._staff_direct_table_write_allowed()'::regprocedure))=0 then
  raise exception 'FLOOR_DIRECT_GUARD_BASELINE_CHANGED';
 end if;
 foreach table_name in array array['restaurant_tables','floor_plan_zones','floor_plan_decorations'] loop
  select relowner,relforcerowsecurity into floor_owner,forced from pg_class
   where oid=to_regclass('public.'||table_name) and relrowsecurity;
  if floor_owner is null or forced then raise exception 'FLOOR_RLS_BASELINE_CHANGED: %',table_name;end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename=table_name
      and policyname in ('staff_floor_insert','staff_floor_update','staff_floor_delete')
      and permissive='RESTRICTIVE')<>3 then
   raise exception 'FLOOR_WRITE_POLICIES_CHANGED: %',table_name;
  end if;
  foreach proc_name in array array['fnb_floor_zone_config_atomic','fnb_floor_layout_update_atomic',
   'fnb_floor_decoration_config_atomic','fnb_table_config_atomic','reorder_fnb_floor_zones_atomic'] loop
   select p.proowner,p.prosecdef into proc_owner,is_definer from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname=proc_name;
   if proc_owner is distinct from floor_owner or not coalesce(is_definer,false) then
    raise exception 'FLOOR_RPC_OWNER_CHANGED: % / %',table_name,proc_name;
   end if;
  end loop;
 end loop;
 if (select count(*) from pg_policies where schemaname='public' and tablename='restaurant_tables'
     and policyname in ('staff_table_insert_rpc_only','staff_table_update_rpc_only','staff_table_delete_rpc_only')
     and permissive='RESTRICTIVE')<>3 then raise exception 'FLOOR_TABLE_WRITE_POLICIES_CHANGED';end if;
end $$;

create function public._staff_floor_readable_branches()
returns uuid[] language sql stable security definer set search_path = '' as $$
 select coalesce(array_agg(b.id),'{}'::uuid[])
 from public.branches b
 join public.profiles p on p.id=auth.uid() and p.tenant_id=b.tenant_id and coalesce(p.is_active,true)
 where b.tenant_id=public.get_user_tenant_id()
   and (public.user_has_branch_access(p.id,b.id)
     or public.user_has_permission(p.id,'reports.view_all_branches')
     or public.user_has_permission(p.id,'floor_plan.edit_global'))
$$;
revoke all on function public._staff_floor_readable_branches() from public,anon;
grant execute on function public._staff_floor_readable_branches() to authenticated;

create or replace function public._staff_direct_floor_write_allowed()
returns boolean language sql stable security definer set search_path = '' as $$ select false $$;
create or replace function public._staff_direct_table_write_allowed()
returns boolean language sql stable security definer set search_path = '' as $$ select false $$;

do $$
declare table_name text;
begin
 foreach table_name in array array['restaurant_tables','floor_plan_zones','floor_plan_decorations'] loop
  execute format('create policy staff_floor_branch_read on public.%I as restrictive for select to authenticated using (coalesce(branch_id=any((select public._staff_floor_readable_branches())::uuid[]),false))',table_name);
 end loop;
end $$;
commit;
