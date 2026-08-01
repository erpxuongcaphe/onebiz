-- ============================================================
-- 00256: Atomic creation for inventory checks and stock transfers
--
-- Function definitions only. Applying this migration does not update
-- existing business rows. New documents are validated and written in one
-- database transaction after this migration is active.
-- ============================================================

begin;

create or replace function public.create_and_apply_inventory_check_atomic(
  p_branch_id uuid,
  p_note text,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_check_id uuid;
  v_code text;
  v_item jsonb;
  v_product record;
  v_product_id uuid;
  v_actual_stock numeric;
  v_system_stock numeric;
  v_apply_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.check') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;
  if not exists (
    select 1
      from public.branches b
     where b.id = p_branch_id
       and b.tenant_id = v_tenant_id
       and coalesce(b.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'BRANCH_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 5000 then
    raise exception using errcode = '22023', message = 'INVENTORY_CHECK_ITEMS_INVALID';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_items) e
     group by e->>'product_id'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'DUPLICATE_PRODUCT';
  end if;

  v_code := public.next_code(v_tenant_id, 'inventory');

  insert into public.inventory_checks (
    tenant_id, branch_id, code, status, note, created_by
  ) values (
    v_tenant_id, p_branch_id, v_code, 'in_progress',
    nullif(trim(coalesce(p_note, '')), ''), v_actor
  )
  returning id into v_check_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := nullif(v_item->>'product_id', '')::uuid;
      v_actual_stock := nullif(v_item->>'actual_stock', '')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'INVENTORY_CHECK_ITEM_INVALID';
    end;

    if v_product_id is null
       or v_actual_stock is null
       or v_actual_stock < 0
       or v_actual_stock = 'NaN'::numeric then
      raise exception using errcode = '22023', message = 'INVENTORY_CHECK_ITEM_INVALID';
    end if;

    select p.id, p.name, p.inventory_role
      into v_product
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id
       and coalesce(p.is_active, true);
    if not found then
      raise exception using errcode = '22023', message = 'PRODUCT_NOT_FOUND';
    end if;
    if v_product.inventory_role = 'fnb_menu_item' then
      raise exception using errcode = '22023', message = 'MENU_NO_DIRECT_STOCK';
    end if;

    select coalesce(bs.quantity, 0)
      into v_system_stock
      from public.branch_stock bs
     where bs.tenant_id = v_tenant_id
       and bs.branch_id = p_branch_id
       and bs.product_id = v_product_id
       and bs.variant_id is null
     for update;
    if not found then
      v_system_stock := 0;
    end if;

    insert into public.inventory_check_items (
      check_id, product_id, product_name, system_stock, actual_stock
    ) values (
      v_check_id, v_product_id, v_product.name, v_system_stock, v_actual_stock
    );
  end loop;

  -- Nested RPC runs in this same transaction. Any apply error rolls back the
  -- header and every item as well as all stock effects.
  v_apply_result := public.apply_inventory_check_atomic(
    v_tenant_id, v_check_id, v_actor
  );

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'create_and_apply',
    'inventory_check',
    v_check_id,
    jsonb_build_object(
      'code', v_code,
      'branch_id', p_branch_id,
      'item_count', jsonb_array_length(p_items),
      'apply_result', v_apply_result,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'check_id', v_check_id,
    'code', v_code,
    'status', 'balanced',
    'apply_result', v_apply_result
  );
end;
$$;

create or replace function public.create_stock_transfer_atomic(
  p_from_branch_id uuid,
  p_to_branch_id uuid,
  p_note text,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_transfer_id uuid;
  v_code text;
  v_item jsonb;
  v_product record;
  v_product_id uuid;
  v_quantity numeric;
  v_available numeric;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.transfer') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;
  if p_from_branch_id is null
     or p_to_branch_id is null
     or p_from_branch_id = p_to_branch_id then
    raise exception using errcode = '22023', message = 'TRANSFER_BRANCHES_INVALID';
  end if;
  if (
    select count(*)
      from public.branches b
     where b.id in (p_from_branch_id, p_to_branch_id)
       and b.tenant_id = v_tenant_id
       and coalesce(b.is_active, true)
  ) <> 2 then
    raise exception using errcode = '22023', message = 'TRANSFER_BRANCH_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, p_from_branch_id)
     or not public.user_has_branch_access(v_actor, p_to_branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;
  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 5000 then
    raise exception using errcode = '22023', message = 'TRANSFER_ITEMS_INVALID';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_items) e
     group by e->>'product_id'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'DUPLICATE_PRODUCT';
  end if;

  v_code := public.next_code(v_tenant_id, 'stock_transfer');

  insert into public.stock_transfers (
    tenant_id, code, from_branch_id, to_branch_id, status,
    total_items, note, created_by
  ) values (
    v_tenant_id, v_code, p_from_branch_id, p_to_branch_id, 'draft',
    jsonb_array_length(p_items), nullif(trim(coalesce(p_note, '')), ''), v_actor
  )
  returning id into v_transfer_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := nullif(v_item->>'product_id', '')::uuid;
      v_quantity := nullif(v_item->>'quantity', '')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'TRANSFER_ITEM_INVALID';
    end;

    if v_product_id is null
       or v_quantity is null
       or v_quantity <= 0
       or v_quantity = 'NaN'::numeric then
      raise exception using errcode = '22023', message = 'TRANSFER_ITEM_INVALID';
    end if;

    select p.id, p.name, p.code, p.unit, p.inventory_role
      into v_product
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id
       and coalesce(p.is_active, true);
    if not found then
      raise exception using errcode = '22023', message = 'PRODUCT_NOT_FOUND';
    end if;
    if v_product.inventory_role = 'fnb_menu_item' then
      raise exception using errcode = '22023', message = 'MENU_NO_DIRECT_STOCK';
    end if;

    select coalesce(bs.quantity, 0) - coalesce(bs.reserved, 0)
      into v_available
      from public.branch_stock bs
     where bs.tenant_id = v_tenant_id
       and bs.branch_id = p_from_branch_id
       and bs.product_id = v_product_id
       and bs.variant_id is null;
    if not found then
      v_available := 0;
    end if;
    if v_available < v_quantity then
      raise exception using
        errcode = '22023',
        message = 'INSUFFICIENT_SOURCE_STOCK',
        detail = v_product.name || ': requested=' || v_quantity::text
          || ', available=' || v_available::text;
    end if;

    insert into public.stock_transfer_items (
      transfer_id, product_id, product_name, product_code, unit, quantity, note
    ) values (
      v_transfer_id,
      v_product_id,
      v_product.name,
      v_product.code,
      v_product.unit,
      v_quantity,
      nullif(trim(coalesce(v_item->>'note', '')), '')
    );
  end loop;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    v_actor,
    'create',
    'stock_transfer',
    v_transfer_id,
    jsonb_build_object(
      'code', v_code,
      'from_branch_id', p_from_branch_id,
      'to_branch_id', p_to_branch_id,
      'item_count', jsonb_array_length(p_items),
      'status', 'draft',
      'atomic', true
    )
  );

  return jsonb_build_object(
    'transfer_id', v_transfer_id,
    'code', v_code,
    'status', 'draft'
  );
end;
$$;

create or replace function public.set_stock_transfer_state_atomic(
  p_transfer_id uuid,
  p_new_status text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_transfer record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'inventory.transfer') then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;
  if p_new_status not in ('in_transit', 'cancelled') then
    raise exception using errcode = '22023', message = 'TRANSFER_STATUS_INVALID';
  end if;

  select st.id, st.code, st.from_branch_id, st.to_branch_id, st.status
    into v_transfer
    from public.stock_transfers st
   where st.id = p_transfer_id
     and st.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'STOCK_TRANSFER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_transfer.from_branch_id)
     or not public.user_has_branch_access(v_actor, v_transfer.to_branch_id) then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;

  if v_transfer.status = p_new_status then
    return jsonb_build_object(
      'transfer_id', v_transfer.id,
      'status', v_transfer.status,
      'idempotent', true
    );
  end if;
  if p_new_status = 'in_transit' and v_transfer.status <> 'draft' then
    raise exception using errcode = '22023', message = 'TRANSFER_TRANSITION_INVALID';
  end if;
  if p_new_status = 'cancelled'
     and v_transfer.status not in ('draft', 'in_transit') then
    raise exception using errcode = '22023', message = 'TRANSFER_TRANSITION_INVALID';
  end if;

  update public.stock_transfers
     set status = p_new_status,
         updated_at = now()
   where id = v_transfer.id
     and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id,
    v_actor,
    case when p_new_status = 'cancelled' then 'cancel' else 'status_change' end,
    'stock_transfer',
    v_transfer.id,
    jsonb_build_object('status', v_transfer.status),
    jsonb_build_object('status', p_new_status, 'atomic', true)
  );

  return jsonb_build_object(
    'transfer_id', v_transfer.id,
    'status', p_new_status,
    'idempotent', false
  );
end;
$$;

revoke all on function public.create_and_apply_inventory_check_atomic(
  uuid, text, jsonb
) from public, anon;
grant execute on function public.create_and_apply_inventory_check_atomic(
  uuid, text, jsonb
) to authenticated;

revoke all on function public.create_stock_transfer_atomic(
  uuid, uuid, text, jsonb
) from public, anon;
grant execute on function public.create_stock_transfer_atomic(
  uuid, uuid, text, jsonb
) to authenticated;

revoke all on function public.set_stock_transfer_state_atomic(
  uuid, text
) from public, anon;
grant execute on function public.set_stock_transfer_state_atomic(
  uuid, text
) to authenticated;

commit;

-- Read-only verification. Every value must be true.
select
  to_regprocedure(
    'public.create_and_apply_inventory_check_atomic(uuid,text,jsonb)'
  ) is not null as inventory_create_apply_ok,
  to_regprocedure(
    'public.create_stock_transfer_atomic(uuid,uuid,text,jsonb)'
  ) is not null as transfer_create_ok,
  to_regprocedure(
    'public.set_stock_transfer_state_atomic(uuid,text)'
  ) is not null as transfer_state_ok;
