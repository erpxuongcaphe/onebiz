-- ============================================================
-- 00275: Guard the F&B cleaning-to-available table transition
-- ============================================================
-- Definition only. Existing rows are not changed by this migration.

create or replace function public.mark_fnb_table_available_atomic(
  p_table_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_table record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_fnb.manage_tables') then
    raise exception using errcode = '42501', message = 'MANAGE_TABLES_PERMISSION_REQUIRED';
  end if;

  select rt.id, rt.branch_id, rt.status, rt.current_order_id
    into v_table
    from public.restaurant_tables rt
   where rt.id = p_table_id
     and rt.tenant_id = v_tenant_id
     and coalesce(rt.is_active, true)
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'TABLE_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_table.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if v_table.status <> 'cleaning' then
    raise exception using errcode = '22023', message = 'TABLE_NOT_CLEANING';
  end if;
  if v_table.current_order_id is not null then
    raise exception using errcode = '22023', message = 'TABLE_STILL_HAS_ORDER';
  end if;

  update public.restaurant_tables
     set status = 'available',
         current_order_id = null,
         updated_at = now()
   where id = v_table.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'fnb_table_available',
    'restaurant_table',
    v_table.id,
    jsonb_build_object('status', v_table.status),
    jsonb_build_object('status', 'available', 'atomic', true)
  );

  return jsonb_build_object(
    'table_id', v_table.id,
    'status', 'available'
  );
end;
$$;

revoke all on function public.mark_fnb_table_available_atomic(uuid)
  from public, anon;
grant execute on function public.mark_fnb_table_available_atomic(uuid)
  to authenticated;

select to_regprocedure(
  'public.mark_fnb_table_available_atomic(uuid)'
) is not null as mark_fnb_table_available_atomic_ok;
