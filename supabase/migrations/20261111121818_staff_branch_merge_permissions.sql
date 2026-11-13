begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_legacy_merge_permission(p_user uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.user_has_permission(p_user,'pos_fnb.manage_tables') and not exists(
  select 1 from public.user_permission_overrides o where o.user_id=p_user
   and o.permission_code='pos_fnb.merge_bills' and o.override_type='revoke') and not exists(
  select 1 from public.user_branch_permission_overrides o where o.user_id=p_user
   and o.branch_id=p_branch and o.permission_code='pos_fnb.merge_bills')
$$;
revoke all on function public._staff_legacy_merge_permission(uuid,uuid) from public,anon,authenticated;
do $patch$
declare source text; patched text; scope text;
begin
 scope:='(select staff_merge_scope.branch_id from public.kitchen_orders staff_merge_scope where staff_merge_scope.id=p_target_order_id and staff_merge_scope.tenant_id=v_tenant_id)';
 source:=pg_get_functiondef('public.merge_kitchen_orders_atomic(uuid,uuid[])'::regprocedure);
 patched:=replace(source,'user_has_permission(v_actor, ''pos_fnb.merge_bills'')',
  '_staff_permission_at_scope(v_actor,''pos_fnb.merge_bills'','||scope||')');
 if patched=source then raise exception 'STAFF_MERGE_CONSUMER_CHANGED';end if;
 source:=patched;
 patched:=replace(source,'user_has_permission(v_actor, ''pos_fnb.manage_tables'')',
  '_staff_legacy_merge_permission(v_actor,'||scope||')');
 if patched=source then raise exception 'STAFF_MERGE_ALIAS_CHANGED';end if;execute patched;
 source:=pg_get_functiondef('public.get_my_auth_bootstrap()'::regprocedure);
 patched:=replace(source,'''pos_fnb.cancel_unpaid_order'',''pos_fnb.void_paid_bill''',
  '''pos_fnb.cancel_unpaid_order'',''pos_fnb.void_paid_bill'',''pos_fnb.merge_bills''');
 if patched=source then raise exception 'STAFF_MERGE_BOOTSTRAP_CHANGED';end if;execute patched;
end $patch$;
insert into public.staff_branch_permission_catalog values('pos_fnb.merge_bills',1);
commit;
