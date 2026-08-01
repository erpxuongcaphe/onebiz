-- ============================================================
-- 00263: Atomic inventory-check cancellation
-- ============================================================
-- Function definition only. Applying it does not change existing checks or stock.

create or replace function public.cancel_inventory_check_atomic(
  p_check_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_check record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.check') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;

  select ic.id, ic.code, ic.branch_id, ic.status
    into v_check
    from public.inventory_checks ic
   where ic.id = p_check_id
     and ic.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'INVENTORY_CHECK_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_check.branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if v_check.status = 'cancelled' then
    return jsonb_build_object(
      'check_id', v_check.id, 'code', v_check.code,
      'status', 'cancelled', 'idempotent', true
    );
  end if;
  if v_check.status not in ('draft', 'in_progress') then
    raise exception using errcode = '22023', message = 'INVENTORY_CHECK_ALREADY_APPLIED';
  end if;

  update public.inventory_checks
     set status = 'cancelled', updated_at = now()
   where id = v_check.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'cancel', 'inventory_check', v_check.id,
    jsonb_build_object('code', v_check.code, 'status', v_check.status),
    jsonb_build_object('status', 'cancelled', 'atomic', true)
  );

  return jsonb_build_object(
    'check_id', v_check.id, 'code', v_check.code,
    'status', 'cancelled', 'idempotent', false
  );
end;
$$;

revoke all on function public.cancel_inventory_check_atomic(uuid)
  from public, anon;
grant execute on function public.cancel_inventory_check_atomic(uuid)
  to authenticated;

comment on function public.cancel_inventory_check_atomic(uuid) is
  'Cancels only unapplied inventory checks with tenant, branch, permission and audit guards.';

select to_regprocedure(
  'public.cancel_inventory_check_atomic(uuid)'
) is not null as cancel_inventory_check_atomic_ok;
