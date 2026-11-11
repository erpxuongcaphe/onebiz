begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare item record; target oid; n integer; source text; patched text;
begin
 for item in select * from (values
 ('fnb_floor_zone_config_atomic','p_branch_id'),
 ('fnb_table_config_atomic','p_branch_id'),
 ('reorder_fnb_floor_zones_atomic','p_branch_id'),
 ('fnb_floor_plan_object_writable','v_branch'),
 ('fnb_floor_decoration_config_atomic','case when p_action=''create'' then v_zone.branch_id else v_deco.branch_id end')
 ) entries(name,branch_expression) loop
  select count(*),min(p.oid::bigint)::oid into n,target from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if n<>1 then raise exception 'STAFF_FLOOR_CONSUMER_AMBIGUOUS: %',item.name;end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''floor_plan\.edit_branch''\)',
   '_staff_permission_at_scope(\1,''floor_plan.edit_branch'','||item.branch_expression||')','g');
  if patched=source then raise exception 'STAFF_FLOOR_CONSUMER_CHANGED: %',item.name;end if;execute patched;
 end loop;
 source:=pg_get_functiondef('public.fnb_floor_layout_update_atomic(jsonb)'::regprocedure);
 patched:=replace(source,'user_has_permission(v_actor, ''floor_plan.edit_branch'')','_staff_permission_any_branch(v_actor,''floor_plan.edit_branch'')');
 if patched=source or position('not public.user_has_branch_access(v_actor, v_row.branch_id)' in source)=0 then raise exception 'STAFF_FLOOR_LAYOUT_CHANGED';end if;
 patched:=replace(patched,'not public.user_has_branch_access(v_actor, v_row.branch_id)',
  '(not public._staff_permission_at_scope(v_actor,''floor_plan.edit_branch'',v_row.branch_id) or not public.user_has_branch_access(v_actor,v_row.branch_id))');
 execute patched;
end $patch$;
-- Explicit global floor-plan grants keep their established company scope.
-- Users with local exceptions use checked RPCs rather than raw table writes.
create function public._staff_direct_floor_write_allowed()
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.user_branch_permission_overrides where user_id=auth.uid() and permission_code='floor_plan.edit_branch')
$$;
revoke all on function public._staff_direct_floor_write_allowed() from public,anon;
grant execute on function public._staff_direct_floor_write_allowed() to authenticated;
do $$ declare table_name text;begin
 foreach table_name in array array['restaurant_tables','floor_plan_zones','floor_plan_decorations'] loop
  execute format('create policy staff_floor_insert on public.%I as restrictive for insert to authenticated with check ((select public._staff_direct_floor_write_allowed()))',table_name);
  execute format('create policy staff_floor_update on public.%I as restrictive for update to authenticated using ((select public._staff_direct_floor_write_allowed())) with check ((select public._staff_direct_floor_write_allowed()))',table_name);
  execute format('create policy staff_floor_delete on public.%I as restrictive for delete to authenticated using ((select public._staff_direct_floor_write_allowed()))',table_name);
 end loop;
end $$;
insert into public.staff_branch_permission_catalog values('floor_plan.edit_branch',1);
commit;
