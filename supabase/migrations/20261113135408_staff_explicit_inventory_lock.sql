-- Preserve all existing effective access: the legacy RPC only accepts owner or
-- admin. Staff may use this one tenant-wide setting only after a future,
-- explicit per-person grant. Never grant access implicitly from an old role.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Freeze the checked grants and platform roles until the new gate commits.
lock table public.user_permission_overrides, public.profiles in share row exclusive mode;
do $migration$
declare source text; old text;
begin
 if exists(select 1 from public.user_permission_overrides o join public.profiles p on p.id=o.user_id and p.tenant_id=o.tenant_id
  where o.permission_code='inventory.lock' and o.override_type='grant' and coalesce(p.role,'') not in ('owner','admin')) then
  raise exception 'STAFF_INVENTORY_LOCK_EXISTING_GRANT_REQUIRES_REVIEW';
 end if;
 source:=pg_get_functiondef('public.set_tenant_setting(text,jsonb,text)'::regprocedure);
 old:='if v_profile.role not in (''owner'', ''admin'') then';
 if position(old in source)=0 then raise exception 'STAFF_INVENTORY_LOCK_SETTING_GUARD_CHANGED';end if;
 source:=replace(source,old,
  'if v_profile.role not in (''owner'', ''admin'') and not (p_key=''inventory_lock'' and exists(select 1 from public.user_permission_overrides o where o.tenant_id=v_profile.tenant_id and o.user_id=v_actor and o.permission_code=''inventory.lock'' and o.override_type=''grant'') and coalesce(public.user_has_permission(v_actor,''inventory.lock''),false)) then');
 execute source;
 source:=pg_get_functiondef('public._staff_profile_snapshot(uuid)'::regprocedure);
 old:='''roleId'',target.role_id,''isActive'',target.is_active';
 if position(old in source)=0 then raise exception 'STAFF_INVENTORY_LOCK_SNAPSHOT_CHANGED';end if;
 execute replace(source,old,'''roleId'',target.role_id,''platformRole'',target.role,''isActive'',target.is_active');
 -- Keep both normal auth bootstrap and its legacy fallback consistent with the
 -- server gate; this changes only the inventory.lock entry in the list.
 source:=pg_get_functiondef('public.get_user_effective_permissions(uuid)'::regprocedure);
 old:='return query select p.permission_code from public.get_user_effective_permissions_before_account_hierarchy(p_user_id) p';
 if position(old in source)=0 then raise exception 'STAFF_INVENTORY_LOCK_AUTH_PERMISSIONS_CHANGED';end if;
 execute replace(source,old,
  'return query select p.permission_code from public.get_user_effective_permissions_before_account_hierarchy(p_user_id) p where p.permission_code<>''inventory.lock'' or exists(select 1 from public.profiles lp where lp.id=p_user_id and (lp.role in (''owner'',''admin'') or exists(select 1 from public.user_permission_overrides lo where lo.tenant_id=lp.tenant_id and lo.user_id=lp.id and lo.permission_code=''inventory.lock'' and lo.override_type=''grant''))) union select ''inventory.lock''::text where exists(select 1 from public.profiles lp where lp.id=p_user_id and lp.role in (''owner'',''admin''))');
end
$migration$;
commit;
