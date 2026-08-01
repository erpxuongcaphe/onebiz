-- ============================================================
-- 00249: Harden inventory-check and stock-transfer completion
--
-- Function definitions only. Existing business rows are not changed while the
-- migration is applied. Proven 00056 implementations are retained privately.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public._apply_inventory_check_impl_00056(uuid,uuid,uuid)') is null then
    if to_regprocedure('public.apply_inventory_check_atomic(uuid,uuid,uuid)') is null then
      raise exception 'MISSING_REQUIRED_FUNCTION: apply_inventory_check_atomic';
    end if;
    execute 'alter function public.apply_inventory_check_atomic(uuid,uuid,uuid) rename to _apply_inventory_check_impl_00056';
  end if;

  if to_regprocedure('public._complete_stock_transfer_impl_00056(uuid,uuid,uuid)') is null then
    if to_regprocedure('public.complete_stock_transfer_atomic(uuid,uuid,uuid)') is null then
      raise exception 'MISSING_REQUIRED_FUNCTION: complete_stock_transfer_atomic';
    end if;
    execute 'alter function public.complete_stock_transfer_atomic(uuid,uuid,uuid) rename to _complete_stock_transfer_impl_00056';
  end if;
end;
$$;

revoke all on function public._apply_inventory_check_impl_00056(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public._complete_stock_transfer_impl_00056(uuid,uuid,uuid)
  from public, anon, authenticated;

create or replace function public.apply_inventory_check_atomic(
  p_tenant_id uuid,
  p_check_id uuid,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_check record;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_created_by is not null and p_created_by <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_tenant_id is not null and p_tenant_id <> v_tenant_id then
    raise exception 'TENANT_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.check') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  select ic.id, ic.code, ic.branch_id, ic.status
    into v_check
    from public.inventory_checks ic
   where ic.id = p_check_id
     and ic.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'INVENTORY_CHECK_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_check.branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.inventory_check_items ici
      join public.products p on p.id = ici.product_id
     where ici.check_id = v_check.id
       and p.tenant_id = v_tenant_id
       and p.inventory_role = 'fnb_menu_item'
  ) then
    raise exception 'MENU_NO_DIRECT_STOCK' using errcode = 'P0001';
  end if;

  v_result := public._apply_inventory_check_impl_00056(
    v_tenant_id, v_check.id, v_actor
  );

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'complete',
    'inventory_check',
    v_check.id,
    jsonb_build_object(
      'code', v_check.code,
      'branch_id', v_check.branch_id,
      'previous_status', v_check.status,
      'result', v_result,
      'atomic', true
    )
  );

  return v_result;
end;
$$;

create or replace function public.complete_stock_transfer_atomic(
  p_tenant_id uuid,
  p_transfer_id uuid,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_transfer record;
  v_item record;
  v_available numeric;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_created_by is not null and p_created_by <> v_actor then
    raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_tenant_id is not null and p_tenant_id <> v_tenant_id then
    raise exception 'TENANT_SPOOF_BLOCKED' using errcode = 'P0001';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.transfer') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;

  select st.id, st.code, st.from_branch_id, st.to_branch_id, st.status
    into v_transfer
    from public.stock_transfers st
   where st.id = p_transfer_id
     and st.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'STOCK_TRANSFER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.user_has_branch_access(v_actor, v_transfer.from_branch_id)
     or not public.user_has_branch_access(v_actor, v_transfer.to_branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;

  for v_item in
    select sti.product_id, sum(sti.quantity) as quantity
      from public.stock_transfer_items sti
      join public.products p
        on p.id = sti.product_id
       and p.tenant_id = v_tenant_id
     where sti.transfer_id = v_transfer.id
     group by sti.product_id
  loop
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception 'INVALID_TRANSFER_QUANTITY' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.products p
       where p.id = v_item.product_id
         and p.tenant_id = v_tenant_id
         and p.inventory_role = 'fnb_menu_item'
    ) then
      raise exception 'MENU_NO_DIRECT_STOCK' using errcode = 'P0001';
    end if;

    select bs.quantity into v_available
      from public.branch_stock bs
     where bs.tenant_id = v_tenant_id
       and bs.branch_id = v_transfer.from_branch_id
       and bs.product_id = v_item.product_id
       and bs.variant_id is null
     for update;
    if not found or coalesce(v_available, 0) < v_item.quantity then
      raise exception 'INSUFFICIENT_SOURCE_STOCK' using errcode = 'P0001';
    end if;
  end loop;

  v_result := public._complete_stock_transfer_impl_00056(
    v_tenant_id, v_transfer.id, v_actor
  );

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'complete',
    'stock_transfer',
    v_transfer.id,
    jsonb_build_object(
      'code', v_transfer.code,
      'from_branch_id', v_transfer.from_branch_id,
      'to_branch_id', v_transfer.to_branch_id,
      'previous_status', v_transfer.status,
      'result', v_result,
      'atomic', true
    )
  );

  return v_result;
end;
$$;

revoke all on function public.apply_inventory_check_atomic(uuid,uuid,uuid)
  from public, anon;
grant execute on function public.apply_inventory_check_atomic(uuid,uuid,uuid)
  to authenticated;

revoke all on function public.complete_stock_transfer_atomic(uuid,uuid,uuid)
  from public, anon;
grant execute on function public.complete_stock_transfer_atomic(uuid,uuid,uuid)
  to authenticated;

commit;

-- Verification only. Both rows must be fully true.
select
  p.proname,
  p.prosecdef as security_definer_ok,
  p.prosrc like '%auth.uid()%' as auth_actor_ok,
  p.prosrc like '%user_has_permission%' as permission_check_ok,
  p.prosrc like '%user_has_branch_access%' as branch_check_ok,
  p.prosrc like '%insert into public.audit_log%' as atomic_audit_ok,
  case when p.proname = 'complete_stock_transfer_atomic'
    then p.prosrc like '%INSUFFICIENT_SOURCE_STOCK%'
    else p.prosrc like '%MENU_NO_DIRECT_STOCK%'
  end as stock_guard_ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'apply_inventory_check_atomic',
    'complete_stock_transfer_atomic'
  )
order by p.proname;
