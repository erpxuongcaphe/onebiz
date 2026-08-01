-- ============================================================
-- 00246: Harden manual stock and stock-document RPCs
--
-- Function/privilege changes only. Existing stock and documents are untouched.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public._apply_manual_stock_movement_impl_00226(uuid,uuid,uuid,jsonb)') is null then
    alter function public.apply_manual_stock_movement_atomic(uuid, uuid, uuid, jsonb)
      rename to _apply_manual_stock_movement_impl_00226;
  end if;
  if to_regprocedure('public._apply_disposal_export_impl_00084(uuid,uuid)') is null then
    alter function public.apply_disposal_export_atomic(uuid, uuid)
      rename to _apply_disposal_export_impl_00084;
  end if;
  if to_regprocedure('public._apply_internal_export_impl_00084(uuid,uuid)') is null then
    alter function public.apply_internal_export_atomic(uuid, uuid)
      rename to _apply_internal_export_impl_00084;
  end if;
  if to_regprocedure('public._void_disposal_export_impl_00228(uuid,uuid,text)') is null then
    alter function public.void_disposal_export_atomic(uuid, uuid, text)
      rename to _void_disposal_export_impl_00228;
  end if;
  if to_regprocedure('public._void_internal_export_impl_00228(uuid,uuid,text)') is null then
    alter function public.void_internal_export_atomic(uuid, uuid, text)
      rename to _void_internal_export_impl_00228;
  end if;
end;
$$;

revoke all on function public._apply_manual_stock_movement_impl_00226(
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public._apply_disposal_export_impl_00084(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public._apply_internal_export_impl_00084(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public._void_disposal_export_impl_00228(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public._void_internal_export_impl_00228(uuid, uuid, text)
  from public, anon, authenticated;

create or replace function public.apply_manual_stock_movement_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_created_by uuid,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_item jsonb;
  v_reference_type text;
  v_permission text;
  v_result jsonb;
  v_entity_id uuid;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_created_by is not null and p_created_by <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_tenant_id is not null and p_tenant_id <> v_tenant_id then
    raise exception 'TENANT_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;
  if p_branch_id is null or not exists (
    select 1 from public.branches b
     where b.id = p_branch_id and b.tenant_id = v_tenant_id
  ) then
    raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'STOCK_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if coalesce((v_item->>'allow_menu')::boolean, false) then
      raise exception 'MENU_STOCK_OVERRIDE_DENIED' using errcode = 'P0001';
    end if;

    v_reference_type := nullif(v_item->>'reference_type', '');
    v_permission := case v_reference_type
      when 'stock_adjustment' then 'inventory.adjust'
      when 'initial_stock_reset' then 'inventory.adjust'
      when 'supplier_return' then 'inventory.create_po'
      when 'disposal_export' then 'inventory.dispose'
      when 'internal_export' then 'inventory.internal_export'
      else null
    end;
    if v_permission is null then
      raise exception 'STOCK_REFERENCE_TYPE_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    if not public.user_has_permission(v_actor, v_permission) then
      raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
    end if;

    if v_reference_type in ('stock_adjustment', 'initial_stock_reset')
       and coalesce(
         (
           public.get_tenant_setting(
             v_tenant_id,
             'inventory_lock',
             '{"locked": false}'::jsonb
           )->>'locked'
         )::boolean,
         false
       ) then
      raise exception 'INVENTORY_LOCKED' using errcode = 'P0001';
    end if;

    if v_entity_id is null then
      begin
        v_entity_id := nullif(v_item->>'reference_id', '')::uuid;
      exception when others then
        v_entity_id := null;
      end;
    end if;
  end loop;

  v_result := public._apply_manual_stock_movement_impl_00226(
    v_tenant_id, p_branch_id, v_actor, p_items
  );

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'manual_stock_movement',
    'stock_batch',
    coalesce(v_entity_id, p_branch_id),
    jsonb_build_object(
      'branch_id', p_branch_id,
      'items', p_items,
      'result', v_result,
      'atomic', true
    )
  );

  return v_result;
end;
$$;

create or replace function public.apply_disposal_export_atomic(
  p_disposal_id uuid,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_doc record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if p_actor_id is not null and p_actor_id <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;
  select p.tenant_id into v_tenant_id from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'inventory.dispose') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  select d.id, d.tenant_id, d.branch_id into v_doc
    from public.disposal_exports d
   where d.id = p_disposal_id and d.tenant_id = v_tenant_id
   for update;
  if not found then raise exception 'DISPOSAL_NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.user_has_branch_access(v_actor, v_doc.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  return public._apply_disposal_export_impl_00084(p_disposal_id, v_actor);
end;
$$;

create or replace function public.apply_internal_export_atomic(
  p_export_id uuid,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_doc record;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if p_actor_id is not null and p_actor_id <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;
  select p.tenant_id into v_tenant_id from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'inventory.internal_export') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  select e.id, e.tenant_id, e.branch_id into v_doc
    from public.internal_exports e
   where e.id = p_export_id and e.tenant_id = v_tenant_id
   for update;
  if not found then raise exception 'INTERNAL_EXPORT_NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.user_has_branch_access(v_actor, v_doc.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  return public._apply_internal_export_impl_00084(p_export_id, v_actor);
end;
$$;

create or replace function public.void_disposal_export_atomic(
  p_disposal_id uuid,
  p_created_by uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_doc record;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if p_created_by is not null and p_created_by <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;
  select p.tenant_id into v_tenant_id from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'inventory.dispose') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  select d.id, d.tenant_id, d.branch_id into v_doc
    from public.disposal_exports d
   where d.id = p_disposal_id and d.tenant_id = v_tenant_id
   for update;
  if not found then raise exception 'DISPOSAL_NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.user_has_branch_access(v_actor, v_doc.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  v_result := public._void_disposal_export_impl_00228(
    p_disposal_id, v_actor, nullif(trim(p_reason), '')
  );
  insert into public.audit_log (tenant_id, user_id, action, entity_type, entity_id, new_data)
  values (v_tenant_id, v_actor, 'void_disposal', 'disposal_export', p_disposal_id,
          v_result || jsonb_build_object('reason', nullif(trim(p_reason), ''), 'atomic', true));
  return v_result;
end;
$$;

create or replace function public.void_internal_export_atomic(
  p_export_id uuid,
  p_created_by uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_doc record;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if p_created_by is not null and p_created_by <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;
  select p.tenant_id into v_tenant_id from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'inventory.internal_export') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  select e.id, e.tenant_id, e.branch_id into v_doc
    from public.internal_exports e
   where e.id = p_export_id and e.tenant_id = v_tenant_id
   for update;
  if not found then raise exception 'INTERNAL_EXPORT_NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.user_has_branch_access(v_actor, v_doc.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  v_result := public._void_internal_export_impl_00228(
    p_export_id, v_actor, nullif(trim(p_reason), '')
  );
  insert into public.audit_log (tenant_id, user_id, action, entity_type, entity_id, new_data)
  values (v_tenant_id, v_actor, 'void_internal_export', 'internal_export', p_export_id,
          v_result || jsonb_build_object('reason', nullif(trim(p_reason), ''), 'atomic', true));
  return v_result;
end;
$$;

revoke all on function public.apply_manual_stock_movement_atomic(uuid, uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.apply_manual_stock_movement_atomic(uuid, uuid, uuid, jsonb)
  to authenticated;
revoke all on function public.apply_disposal_export_atomic(uuid, uuid) from public, anon;
grant execute on function public.apply_disposal_export_atomic(uuid, uuid) to authenticated;
revoke all on function public.apply_internal_export_atomic(uuid, uuid) from public, anon;
grant execute on function public.apply_internal_export_atomic(uuid, uuid) to authenticated;
revoke all on function public.void_disposal_export_atomic(uuid, uuid, text) from public, anon;
grant execute on function public.void_disposal_export_atomic(uuid, uuid, text) to authenticated;
revoke all on function public.void_internal_export_atomic(uuid, uuid, text) from public, anon;
grant execute on function public.void_internal_export_atomic(uuid, uuid, text) to authenticated;

commit;

-- Verification only. Expected: five rows and all booleans true.
select
  p.proname,
  p.prosecdef as security_definer_ok,
  p.prosrc like '%auth.uid()%' as auth_actor_ok,
  p.prosrc like '%user_has_permission%' as permission_check_ok,
  p.prosrc like '%user_has_branch_access%' as branch_check_ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'apply_manual_stock_movement_atomic',
    'apply_disposal_export_atomic',
    'apply_internal_export_atomic',
    'void_disposal_export_atomic',
    'void_internal_export_atomic'
  )
order by p.proname;
