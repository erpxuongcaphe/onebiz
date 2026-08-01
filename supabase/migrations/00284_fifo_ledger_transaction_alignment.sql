-- ============================================================
-- 00284: Keep the FIFO lot ledger aligned with real branch stock
-- ============================================================
-- Definition-only migration. Applying this file does not change invoices,
-- purchase orders, stock movements, branch stock, or existing lot quantities.

begin;

-- BOM quantities use four decimals. Widening precision preserves every
-- existing value while preventing future rounding drift in the lot ledger.
alter table public.product_lots
  alter column initial_qty type numeric(18,4),
  alter column current_qty type numeric(18,4);

alter table public.lot_allocations
  alter column quantity type numeric(18,4);

-- 00231 unintentionally removed values introduced by 00104.
alter table public.product_lots
  drop constraint if exists product_lots_source_type_check;
alter table public.product_lots
  add constraint product_lots_source_type_check
  check (source_type in (
    'production', 'purchase', 'opening', 'adjustment', 'transfer'
  ));

alter table public.lot_allocations
  drop constraint if exists lot_allocations_source_type_check;
alter table public.lot_allocations
  add constraint lot_allocations_source_type_check
  check (source_type in (
    'invoice', 'production', 'production_cancel', 'transfer', 'disposal',
    'inventory_check', 'purchase_order_revert', 'supplier_return',
    'manual_adjust', 'reconciliation'
  ));

create or replace function public._reconcile_product_lots_to_branch_00284(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_actor uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target numeric(18,4) := 0;
  v_lot_total numeric(18,4) := 0;
  v_difference numeric(18,4) := 0;
  v_remaining numeric(18,4) := 0;
  v_take numeric(18,4) := 0;
  v_adjustment_lot_id uuid;
  v_lot record;
begin
  if p_tenant_id is null or p_branch_id is null or p_product_id is null
     or p_source_id is null then
    raise exception using errcode = '22023', message = 'LOT_RECONCILE_ARGUMENT_REQUIRED';
  end if;

  select bs.quantity
    into v_target
    from public.branch_stock bs
   where bs.tenant_id = p_tenant_id
     and bs.branch_id = p_branch_id
     and bs.product_id = p_product_id
     and bs.variant_id is null
   for update;
  if not found then
    v_target := 0;
  end if;

  select coalesce(sum(pl.current_qty), 0)
    into v_lot_total
    from public.product_lots pl
   where pl.tenant_id = p_tenant_id
     and pl.branch_id = p_branch_id
     and pl.product_id = p_product_id
     and pl.status in ('active', 'expired');

  v_difference := round(v_target - v_lot_total, 4);

  if v_difference > 0.0001 then
    insert into public.product_lots (
      tenant_id, product_id, variant_id, lot_number, source_type,
      received_date, initial_qty, current_qty, branch_id, status, note
    ) values (
      p_tenant_id,
      p_product_id,
      null,
      'ADJ-' || upper(left(replace(p_source_type, '_', ''), 8))
        || '-' || left(p_source_id::text, 8)
        || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      'adjustment',
      current_date,
      v_difference,
      v_difference,
      p_branch_id,
      'active',
      concat_ws(' - ', 'Can bang so lo theo ton chi nhanh', p_note)
    ) returning id into v_adjustment_lot_id;
  elsif v_difference < -0.0001 then
    v_remaining := abs(v_difference);

    for v_lot in
      select pl.id, pl.current_qty
        from public.product_lots pl
       where pl.tenant_id = p_tenant_id
         and pl.branch_id = p_branch_id
         and pl.product_id = p_product_id
         and pl.status in ('active', 'expired')
         and pl.current_qty > 0
       order by pl.expiry_date asc nulls last,
                pl.received_date asc,
                pl.created_at asc,
                pl.id asc
       for update
    loop
      exit when v_remaining <= 0.0001;
      v_take := least(v_lot.current_qty, v_remaining);

      update public.product_lots
         set current_qty = current_qty - v_take,
             status = case
               when current_qty - v_take <= 0.0001 then 'consumed'
               else status
             end,
             updated_at = now()
       where id = v_lot.id;

      insert into public.lot_allocations (
        tenant_id, lot_id, source_type, source_id, quantity, allocated_by
      ) values (
        p_tenant_id, v_lot.id, p_source_type, p_source_id, v_take, p_actor
      );

      v_remaining := v_remaining - v_take;
    end loop;

    -- Negative branch stock cannot be represented by physical lots. Consume
    -- all lots and report the residual instead of fabricating negative lots.
    if v_remaining > 0.0001 and v_target >= 0 then
      raise exception using errcode = 'P0001', message = 'LOT_LEDGER_SHORTAGE';
    end if;
  end if;

  if abs(v_difference) > 0.0001 then
    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, new_data
    ) values (
      p_tenant_id,
      p_actor,
      'lot_reconcile',
      'product_lot',
      p_product_id,
      jsonb_build_object(
        'branch_id', p_branch_id,
        'source_type', p_source_type,
        'source_id', p_source_id,
        'lot_total_before', v_lot_total,
        'branch_stock_target', v_target,
        'difference', v_difference,
        'unrepresented_negative_qty', greatest(v_remaining, 0),
        'note', p_note,
        'migration', '00284'
      )
    );
  end if;

  return jsonb_build_object(
    'branch_stock_target', v_target,
    'lot_total_before', v_lot_total,
    'difference', v_difference,
    'adjustment_lot_id', v_adjustment_lot_id,
    'unrepresented_negative_qty', greatest(v_remaining, 0)
  );
end;
$$;

revoke all on function public._reconcile_product_lots_to_branch_00284(
  uuid, uuid, uuid, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public._reconcile_product_lots_to_branch_00284(
  uuid, uuid, uuid, text, uuid, uuid, text
) to service_role;

-- Preserve the hardened implementations and add lot reconciliation after
-- their existing stock operation, inside the same database transaction.
do $$
begin
  if to_regprocedure('public._apply_inventory_check_auth_impl_00249(uuid,uuid,uuid)') is null then
    alter function public.apply_inventory_check_atomic(uuid,uuid,uuid)
      rename to _apply_inventory_check_auth_impl_00249;
  end if;
  if to_regprocedure('public._complete_stock_transfer_auth_impl_00249(uuid,uuid,uuid)') is null then
    alter function public.complete_stock_transfer_atomic(uuid,uuid,uuid)
      rename to _complete_stock_transfer_auth_impl_00249;
  end if;
  if to_regprocedure('public._complete_production_auth_impl_00283(uuid,numeric,text,date,date)') is null then
    alter function public.complete_production_atomic(uuid,numeric,text,date,date)
      rename to _complete_production_auth_impl_00283;
  end if;
  if to_regprocedure('public._revert_production_auth_impl_00283(uuid,text)') is null then
    alter function public.revert_production_materials(uuid,text)
      rename to _revert_production_auth_impl_00283;
  end if;
  if to_regprocedure('public._revert_received_po_impl_00214(uuid,uuid,boolean)') is null then
    alter function public.revert_received_purchase_order_atomic(uuid,uuid,boolean)
      rename to _revert_received_po_impl_00214;
  end if;
end;
$$;

revoke all on function public._apply_inventory_check_auth_impl_00249(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public._complete_stock_transfer_auth_impl_00249(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public._complete_production_auth_impl_00283(uuid,numeric,text,date,date)
  from public, anon, authenticated;
revoke all on function public._revert_production_auth_impl_00283(uuid,text)
  from public, anon, authenticated;
revoke all on function public._revert_received_po_impl_00214(uuid,uuid,boolean)
  from public, anon, authenticated;

create or replace function public.apply_inventory_check_atomic(
  p_tenant_id uuid,
  p_check_id uuid,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_branch_id uuid;
  v_product_id uuid;
  v_result jsonb;
begin
  v_result := public._apply_inventory_check_auth_impl_00249(
    p_tenant_id, p_check_id, p_created_by
  );

  select ic.tenant_id, ic.branch_id
    into v_tenant_id, v_branch_id
    from public.inventory_checks ic
   where ic.id = p_check_id;

  for v_product_id in
    select distinct ici.product_id
      from public.inventory_check_items ici
     where ici.check_id = p_check_id
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      v_tenant_id, v_branch_id, v_product_id,
      'inventory_check', p_check_id, v_actor,
      'Kiem ke ' || p_check_id::text
    );
  end loop;

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
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_from_branch_id uuid;
  v_to_branch_id uuid;
  v_product_id uuid;
  v_result jsonb;
begin
  v_result := public._complete_stock_transfer_auth_impl_00249(
    p_tenant_id, p_transfer_id, p_created_by
  );

  select st.tenant_id, st.from_branch_id, st.to_branch_id
    into v_tenant_id, v_from_branch_id, v_to_branch_id
    from public.stock_transfers st
   where st.id = p_transfer_id;

  for v_product_id in
    select distinct sti.product_id
      from public.stock_transfer_items sti
     where sti.transfer_id = p_transfer_id
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      v_tenant_id, v_from_branch_id, v_product_id,
      'transfer', p_transfer_id, v_actor, 'Chuyen kho - kho xuat'
    );
    perform public._reconcile_product_lots_to_branch_00284(
      v_tenant_id, v_to_branch_id, v_product_id,
      'transfer', p_transfer_id, v_actor, 'Chuyen kho - kho nhan'
    );
  end loop;

  return v_result;
end;
$$;

create or replace function public.complete_production_atomic(
  p_production_order_id uuid,
  p_completed_qty numeric,
  p_lot_number text default null,
  p_manufactured_date date default current_date,
  p_expiry_date date default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_branch_id uuid;
  v_product_id uuid;
  v_lot_id uuid;
begin
  v_lot_id := public._complete_production_auth_impl_00283(
    p_production_order_id, p_completed_qty, p_lot_number,
    p_manufactured_date, p_expiry_date
  );

  select po.tenant_id, po.branch_id
    into v_tenant_id, v_branch_id
    from public.production_orders po
   where po.id = p_production_order_id;

  for v_product_id in
    select distinct pom.product_id
      from public.production_order_materials pom
     where pom.production_order_id = p_production_order_id
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      v_tenant_id, v_branch_id, v_product_id,
      'production', p_production_order_id, v_actor,
      'Xuat nguyen lieu san xuat'
    );
  end loop;

  return v_lot_id;
end;
$$;

create or replace function public.revert_production_materials(
  p_production_order_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_branch_id uuid;
  v_product_id uuid;
  v_result jsonb;
begin
  v_result := public._revert_production_auth_impl_00283(
    p_production_order_id, p_reason
  );

  select po.tenant_id, po.branch_id
    into v_tenant_id, v_branch_id
    from public.production_orders po
   where po.id = p_production_order_id;

  for v_product_id in
    select distinct sm.product_id
      from public.stock_movements sm
     where sm.tenant_id = v_tenant_id
       and sm.reference_type = 'production_order'
       and sm.reference_id = p_production_order_id
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      v_tenant_id, v_branch_id, v_product_id,
      'production_cancel', p_production_order_id, v_actor,
      'Hoan nguyen lieu khi huy san xuat'
    );
  end loop;

  return v_result;
end;
$$;

create or replace function public.revert_received_purchase_order_atomic(
  p_order_id uuid,
  p_user_id uuid,
  p_allow_negative boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_branch_id uuid;
  v_product_id uuid;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if p_user_id is not null and p_user_id <> v_actor then
    raise exception using errcode = '42501', message = 'ACTOR_SPOOF_BLOCKED';
  end if;

  select po.tenant_id, po.branch_id
    into v_tenant_id, v_branch_id
    from public.purchase_orders po
   where po.id = p_order_id;

  v_result := public._revert_received_po_impl_00214(
    p_order_id, v_actor, p_allow_negative
  );

  for v_product_id in
    select distinct sm.product_id
      from public.stock_movements sm
     where sm.tenant_id = v_tenant_id
       and sm.reference_type = 'purchase_order_revert'
       and sm.reference_id = p_order_id
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      v_tenant_id, v_branch_id, v_product_id,
      'purchase_order_revert', p_order_id, v_actor,
      'Hoan nhap phieu mua hang'
    );
  end loop;

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

revoke all on function public.complete_production_atomic(uuid,numeric,text,date,date)
  from public, anon;
grant execute on function public.complete_production_atomic(uuid,numeric,text,date,date)
  to authenticated;

revoke all on function public.revert_production_materials(uuid,text)
  from public, anon;
grant execute on function public.revert_production_materials(uuid,text)
  to authenticated;

revoke all on function public.revert_received_purchase_order_atomic(uuid,uuid,boolean)
  from public, anon;
grant execute on function public.revert_received_purchase_order_atomic(uuid,uuid,boolean)
  to authenticated;

commit;

select
  to_regprocedure('public._reconcile_product_lots_to_branch_00284(uuid,uuid,uuid,text,uuid,uuid,text)') is not null
    as lot_reconcile_helper_ok,
  to_regprocedure('public.apply_inventory_check_atomic(uuid,uuid,uuid)') is not null
    as inventory_check_fifo_ok,
  to_regprocedure('public.complete_stock_transfer_atomic(uuid,uuid,uuid)') is not null
    as stock_transfer_fifo_ok,
  to_regprocedure('public.complete_production_atomic(uuid,numeric,text,date,date)') is not null
    as production_complete_fifo_ok,
  to_regprocedure('public.revert_production_materials(uuid,text)') is not null
    as production_cancel_fifo_ok,
  to_regprocedure('public.revert_received_purchase_order_atomic(uuid,uuid,boolean)') is not null
    as purchase_revert_fifo_ok;

notify pgrst, 'reload schema';
