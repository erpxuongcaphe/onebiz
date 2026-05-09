-- ============================================================
-- OneBiz ERP - Zero-drift stock hardening
--
-- Adds transaction-level RPCs for stock mutations that were previously
-- orchestrated from the browser in multiple round trips.
-- ============================================================

create or replace function public.apply_manual_stock_movement_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_created_by uuid,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_product_id uuid;
  v_type text;
  v_quantity numeric;
  v_reference_type text;
  v_reference_id uuid;
  v_note text;
  v_delta numeric;
  v_count int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Stock movement requires at least one item';
  end if;

  if not exists (
    select 1 from public.branches
    where id = p_branch_id and tenant_id = p_tenant_id
  ) then
    raise exception 'Branch % does not belong to tenant %', p_branch_id, p_tenant_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_type := nullif(v_item->>'type', '');
    v_quantity := coalesce((v_item->>'quantity')::numeric, 0);
    v_reference_type := nullif(v_item->>'reference_type', '');
    v_reference_id := nullif(v_item->>'reference_id', '')::uuid;
    v_note := nullif(v_item->>'note', '');

    if v_product_id is null or v_type not in ('in', 'out', 'adjust') or v_quantity <= 0 then
      raise exception 'Invalid stock movement item: %', v_item;
    end if;

    if not exists (
      select 1 from public.products
      where id = v_product_id and tenant_id = p_tenant_id
    ) then
      raise exception 'Product % does not belong to tenant %', v_product_id, p_tenant_id;
    end if;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_branch_id, v_product_id, v_type, v_quantity,
      v_reference_type, v_reference_id, v_note, p_created_by
    );

    v_delta := case
      when v_type = 'in' then v_quantity
      when v_type = 'out' then -v_quantity
      else 0
    end;

    if v_delta <> 0 then
      perform public.increment_product_stock(v_product_id, v_delta);
      perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_product_id, v_delta);
    end if;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'items', v_count);
end;
$$;

comment on function public.apply_manual_stock_movement_atomic is
  'Atomic stock movement batch: inserts stock_movements and updates product/branch snapshots in one transaction.';

grant execute on function public.apply_manual_stock_movement_atomic(uuid, uuid, uuid, jsonb)
  to authenticated, service_role;

create or replace function public.apply_inventory_check_atomic(
  p_tenant_id uuid,
  p_check_id uuid,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check record;
  v_item record;
  v_diff numeric;
  v_applied int := 0;
  v_item_count int := 0;
begin
  select *
    into v_check
    from public.inventory_checks
   where tenant_id = p_tenant_id
     and id = p_check_id
   for update;

  if not found then
    raise exception 'Inventory check % not found', p_check_id;
  end if;

  if v_check.status not in ('draft', 'in_progress') then
    raise exception 'Inventory check % already processed (status=%)', v_check.code, v_check.status;
  end if;

  select count(*)
    into v_item_count
    from public.inventory_check_items
   where check_id = p_check_id;

  if v_item_count = 0 then
    raise exception 'Inventory check % has no items', v_check.code;
  end if;

  for v_item in
    select ici.product_id, ici.product_name, ici.system_stock, ici.actual_stock
      from public.inventory_check_items ici
      join public.products p on p.id = ici.product_id and p.tenant_id = p_tenant_id
     where ici.check_id = p_check_id
  loop
    v_diff := coalesce(v_item.actual_stock, 0) - coalesce(v_item.system_stock, 0);
    if v_diff = 0 then
      continue;
    end if;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id,
      v_check.branch_id,
      v_item.product_id,
      case when v_diff > 0 then 'in' else 'out' end,
      abs(v_diff),
      'inventory_check',
      p_check_id,
      v_check.code || ' - Kiem ke - ' || coalesce(v_item.product_name, ''),
      p_created_by
    );

    perform public.increment_product_stock(v_item.product_id, v_diff);
    perform public.upsert_branch_stock(p_tenant_id, v_check.branch_id, v_item.product_id, v_diff);
    v_applied := v_applied + 1;
  end loop;

  update public.inventory_checks
     set status = 'balanced',
         updated_at = now()
   where id = p_check_id
     and tenant_id = p_tenant_id;

  return jsonb_build_object('success', true, 'applied_items', v_applied);
end;
$$;

comment on function public.apply_inventory_check_atomic is
  'Applies an inventory check in one transaction: locks the check, writes deltas, updates stock snapshots, then marks balanced.';

grant execute on function public.apply_inventory_check_atomic(uuid, uuid, uuid)
  to authenticated, service_role;

create or replace function public.complete_stock_transfer_atomic(
  p_tenant_id uuid,
  p_transfer_id uuid,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer record;
  v_item record;
  v_item_count int := 0;
begin
  select *
    into v_transfer
    from public.stock_transfers
   where tenant_id = p_tenant_id
     and id = p_transfer_id
   for update;

  if not found then
    raise exception 'Stock transfer % not found', p_transfer_id;
  end if;

  if v_transfer.status not in ('draft', 'in_transit') then
    raise exception 'Stock transfer % already processed (status=%)', v_transfer.code, v_transfer.status;
  end if;

  if v_transfer.from_branch_id = v_transfer.to_branch_id then
    raise exception 'Source and destination branches must be different';
  end if;

  select count(*)
    into v_item_count
    from public.stock_transfer_items
   where transfer_id = p_transfer_id;

  if v_item_count = 0 then
    raise exception 'Stock transfer % has no items', v_transfer.code;
  end if;

  for v_item in
    select sti.product_id, sti.product_name, sti.quantity
      from public.stock_transfer_items sti
      join public.products p on p.id = sti.product_id and p.tenant_id = p_tenant_id
     where sti.transfer_id = p_transfer_id
  loop
    if coalesce(v_item.quantity, 0) <= 0 then
      raise exception 'Invalid transfer quantity for product %', v_item.product_id;
    end if;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values
    (
      p_tenant_id,
      v_transfer.from_branch_id,
      v_item.product_id,
      'out',
      v_item.quantity,
      'stock_transfer',
      p_transfer_id,
      v_transfer.code || ' - Xuat chuyen kho - ' || coalesce(v_item.product_name, ''),
      p_created_by
    ),
    (
      p_tenant_id,
      v_transfer.to_branch_id,
      v_item.product_id,
      'in',
      v_item.quantity,
      'stock_transfer',
      p_transfer_id,
      v_transfer.code || ' - Nhap chuyen kho - ' || coalesce(v_item.product_name, ''),
      p_created_by
    );

    -- Company-wide products.stock does not change for an internal transfer.
    perform public.upsert_branch_stock(p_tenant_id, v_transfer.from_branch_id, v_item.product_id, -v_item.quantity);
    perform public.upsert_branch_stock(p_tenant_id, v_transfer.to_branch_id, v_item.product_id, v_item.quantity);
  end loop;

  update public.stock_transfers
     set status = 'completed',
         completed_at = now(),
         updated_at = now()
   where id = p_transfer_id
     and tenant_id = p_tenant_id;

  return jsonb_build_object('success', true, 'items', v_item_count);
end;
$$;

comment on function public.complete_stock_transfer_atomic is
  'Completes a stock transfer atomically: source branch out, destination branch in, and status completed in one transaction.';

grant execute on function public.complete_stock_transfer_atomic(uuid, uuid, uuid)
  to authenticated, service_role;
