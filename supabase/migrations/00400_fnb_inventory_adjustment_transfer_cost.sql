-- Keep opted-in branch cost ledgers aligned with inventory adjustments,
-- supplier returns, stock exports, and transfers. Gains need branch WAC.
begin;

do $migration$
begin
  if to_regclass('public.inventory_checks') is null
     or to_regclass('public.stock_transfers') is null
     or to_regclass('public.stock_transfer_items') is null
     or to_regclass('public.supplier_returns') is null
     or to_regclass('public.disposal_exports') is null
     or to_regclass('public.internal_exports') is null
     or to_regprocedure('public._fnb_branch_cost_tracking_enabled_00390(uuid,uuid)') is null
     or to_regprocedure('public._post_fnb_branch_cost_in_00390(uuid,uuid,uuid,numeric,numeric,text,text,uuid,uuid,text,uuid)') is null
     or to_regprocedure('public._post_fnb_branch_cost_out_00390(uuid,uuid,uuid,numeric,text,text,uuid,uuid,text,uuid)') is null
     or to_regprocedure('public.complete_stock_transfer_atomic(uuid,uuid,uuid)') is null then
    raise exception 'FNB_00400_PREREQUISITE_MISSING';
  end if;
end;
$migration$;

alter table public.fnb_branch_product_cost_events
  drop constraint fnb_branch_product_cost_events_source_type_check;
alter table public.fnb_branch_product_cost_events
  add constraint fnb_branch_product_cost_events_source_type_check
  check (source_type in (
    'opening', 'purchase_receipt', 'internal_sale_receipt',
    'production_consume', 'production_complete', 'bom_consume',
    'invoice_void_restore', 'return_bom_restore',
    'production_cancel_restore', 'purchase_order_revert',
    'inventory_adjustment', 'stock_transfer', 'supplier_return',
    'disposal_export', 'internal_export',
    'disposal_export_restore', 'internal_export_restore'
  ));

create function public._capture_fnb_inventory_cost_event_00400()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_tenant uuid;
  v_source_branch uuid;
  v_source_type text;
  v_unit_cost numeric(18,6);
  v_costed_quantity numeric(18,4);
  v_original_quantity numeric(18,4);
  v_original_cost numeric(18,4);
  v_already_restored numeric(18,4);
begin
  v_source_type := case new.reference_type
    when 'inventory_check' then 'inventory_adjustment'
    when 'stock_adjustment' then 'inventory_adjustment'
    when 'initial_stock_reset' then 'inventory_adjustment'
    when 'supplier_return' then 'supplier_return'
    when 'disposal_export' then 'disposal_export'
    when 'internal_export' then 'internal_export'
    when 'disposal_export_void' then 'disposal_export_restore'
    when 'internal_export_void' then 'internal_export_restore'
    else null
  end;
  if v_source_type is null or new.type not in ('in', 'out') then
    return new;
  end if;
  if not public._fnb_branch_cost_tracking_enabled_00390(new.tenant_id, new.branch_id) then
    return new;
  end if;

  if new.reference_type = 'inventory_check' then
    select ic.tenant_id, ic.branch_id into v_source_tenant, v_source_branch
      from public.inventory_checks ic where ic.id = new.reference_id for update;
  elsif new.reference_type = 'supplier_return' then
    select sr.tenant_id, sr.branch_id into v_source_tenant, v_source_branch
      from public.supplier_returns sr where sr.id = new.reference_id for update;
  elsif new.reference_type in ('disposal_export', 'disposal_export_void') then
    select de.tenant_id, de.branch_id into v_source_tenant, v_source_branch
      from public.disposal_exports de where de.id = new.reference_id for update;
  elsif new.reference_type in ('internal_export', 'internal_export_void') then
    select ie.tenant_id, ie.branch_id into v_source_tenant, v_source_branch
      from public.internal_exports ie where ie.id = new.reference_id for update;
  elsif new.reference_type in ('stock_adjustment', 'initial_stock_reset') then
    v_source_tenant := new.tenant_id;
    v_source_branch := new.branch_id;
  else
    return new;
  end if;
  if not found or v_source_tenant is distinct from new.tenant_id
     or v_source_branch is distinct from new.branch_id then
    raise exception using errcode = 'P0001', message = 'FNB_INVENTORY_COST_SOURCE_REQUIRED';
  end if;

  if new.type = 'out' then
    perform public._post_fnb_branch_cost_out_00390(
      new.tenant_id, new.branch_id, new.product_id, new.quantity,
      v_source_type, new.reference_type, new.reference_id,
      new.id, new.note, new.created_by
    );
  elsif new.reference_type in ('disposal_export_void', 'internal_export_void') then
    select coalesce(sum(e.quantity), 0), coalesce(sum(e.total_cost), 0)
      into v_original_quantity, v_original_cost
      from public.stock_movements original
      join public.fnb_branch_product_cost_events e
        on e.source_stock_movement_id = original.id
     where original.tenant_id = new.tenant_id
       and original.branch_id = new.branch_id
       and original.product_id = new.product_id
       and original.reference_id = new.reference_id
       and original.type = 'out'
       and original.reference_type = case new.reference_type
         when 'disposal_export_void' then 'disposal_export'
         else 'internal_export'
       end
       and e.direction = 'out'
       and e.source_type = case new.reference_type
         when 'disposal_export_void' then 'disposal_export'
         else 'internal_export'
       end;
    select coalesce(sum(e.quantity), 0) into v_already_restored
      from public.stock_movements restored
      join public.fnb_branch_product_cost_events e
        on e.source_stock_movement_id = restored.id
     where restored.tenant_id = new.tenant_id
       and restored.branch_id = new.branch_id
       and restored.product_id = new.product_id
       and restored.reference_id = new.reference_id
       and restored.type = 'in'
       and restored.reference_type = new.reference_type
       and e.direction = 'in'
       and e.source_type = v_source_type;
    if v_original_quantity <= 0
       or v_already_restored + new.quantity > v_original_quantity + 0.0001 then
      raise exception using errcode = 'P0001', message = 'FNB_STOCK_EXPORT_RESTORE_SOURCE_REQUIRED';
    end if;
    perform public._post_fnb_branch_cost_in_00390(
      new.tenant_id, new.branch_id, new.product_id, new.quantity,
      round(v_original_cost / v_original_quantity, 6), v_source_type,
      new.reference_type, new.reference_id, new.id, new.note, new.created_by
    );
  elsif new.type = 'in' then
    select b.unit_cost, b.costed_quantity into v_unit_cost, v_costed_quantity
      from public.fnb_branch_product_cost_balances b
     where b.tenant_id = new.tenant_id and b.branch_id = new.branch_id
       and b.product_id = new.product_id for update;
    if not found or v_costed_quantity <= 0 then
      raise exception using errcode = 'P0001', message = 'FNB_MANUAL_STOCK_GAIN_COST_REQUIRED';
    end if;
    perform public._post_fnb_branch_cost_in_00390(
      new.tenant_id, new.branch_id, new.product_id, new.quantity, v_unit_cost,
      v_source_type, new.reference_type, new.reference_id,
      new.id, new.note, new.created_by
    );
  end if;
  return new;
end;
$$;

drop trigger if exists capture_fnb_inventory_check_cost_00400 on public.stock_movements;
drop trigger if exists capture_fnb_inventory_cost_event_00400 on public.stock_movements;
create trigger capture_fnb_inventory_cost_event_00400
  after insert on public.stock_movements
  for each row when (new.reference_type in (
    'inventory_check', 'stock_adjustment', 'initial_stock_reset',
    'supplier_return', 'disposal_export', 'internal_export',
    'disposal_export_void', 'internal_export_void'
  ))
  execute function public._capture_fnb_inventory_cost_event_00400();
revoke all on function public._capture_fnb_inventory_cost_event_00400()
  from public, anon, authenticated;

do $rename$
begin
  if to_regprocedure('public._complete_stock_transfer_cost_impl_00400(uuid,uuid,uuid)') is null then
    alter function public.complete_stock_transfer_atomic(uuid,uuid,uuid)
      rename to _complete_stock_transfer_cost_impl_00400;
  end if;
end;
$rename$;
revoke all on function public._complete_stock_transfer_cost_impl_00400(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

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
  v_result jsonb;
  v_transfer record;
  v_product record;
  v_movement record;
  v_source_enabled boolean;
  v_target_enabled boolean;
  v_source_qty numeric(18,4);
  v_target_qty numeric(18,4);
  v_cost_qty numeric(18,4);
  v_cost_total numeric(18,4);
  v_transfer_unit_cost numeric(18,6);
begin
  v_result := public._complete_stock_transfer_cost_impl_00400(
    p_tenant_id, p_transfer_id, p_created_by
  );

  select st.tenant_id, st.from_branch_id, st.to_branch_id
    into v_transfer
    from public.stock_transfers st
   where st.id = p_transfer_id and st.tenant_id = p_tenant_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'FNB_TRANSFER_COST_SOURCE_REQUIRED';
  end if;
  v_source_enabled := public._fnb_branch_cost_tracking_enabled_00390(
    v_transfer.tenant_id, v_transfer.from_branch_id
  );
  v_target_enabled := public._fnb_branch_cost_tracking_enabled_00390(
    v_transfer.tenant_id, v_transfer.to_branch_id
  );
  if v_target_enabled and not v_source_enabled then
    raise exception using errcode = 'P0001', message = 'FNB_TRANSFER_SOURCE_COST_REQUIRED';
  end if;
  if not v_source_enabled then
    return v_result;
  end if;

  for v_product in
    select distinct sti.product_id
      from public.stock_transfer_items sti
     where sti.transfer_id = p_transfer_id
     order by sti.product_id
  loop
    select coalesce(sum(sm.quantity), 0) into v_source_qty
      from public.stock_movements sm
     where sm.tenant_id = v_transfer.tenant_id and sm.branch_id = v_transfer.from_branch_id
       and sm.product_id = v_product.product_id and sm.reference_type = 'stock_transfer'
       and sm.reference_id = p_transfer_id and sm.type = 'out';
    select coalesce(sum(sm.quantity), 0) into v_target_qty
      from public.stock_movements sm
     where sm.tenant_id = v_transfer.tenant_id and sm.branch_id = v_transfer.to_branch_id
       and sm.product_id = v_product.product_id and sm.reference_type = 'stock_transfer'
       and sm.reference_id = p_transfer_id and sm.type = 'in';
    if v_source_qty <= 0 or abs(v_source_qty - v_target_qty) > 0.0001 then
      raise exception using errcode = 'P0001', message = 'FNB_TRANSFER_COST_MOVEMENTS_REQUIRED';
    end if;

    for v_movement in
      select sm.id, sm.quantity, sm.note, sm.created_by
        from public.stock_movements sm
       where sm.tenant_id = v_transfer.tenant_id and sm.branch_id = v_transfer.from_branch_id
         and sm.product_id = v_product.product_id and sm.reference_type = 'stock_transfer'
         and sm.reference_id = p_transfer_id and sm.type = 'out'
       order by sm.id
    loop
      perform public._post_fnb_branch_cost_out_00390(
        v_transfer.tenant_id, v_transfer.from_branch_id, v_product.product_id,
        v_movement.quantity, 'stock_transfer', 'stock_transfer', p_transfer_id,
        v_movement.id, v_movement.note, v_movement.created_by
      );
    end loop;

    if v_target_enabled then
      select coalesce(sum(e.quantity), 0), coalesce(sum(e.total_cost), 0)
        into v_cost_qty, v_cost_total
        from public.fnb_branch_product_cost_events e
       where e.tenant_id = v_transfer.tenant_id and e.branch_id = v_transfer.from_branch_id
         and e.product_id = v_product.product_id and e.direction = 'out'
         and e.source_type = 'stock_transfer'
         and e.source_reference_type = 'stock_transfer'
         and e.source_reference_id = p_transfer_id;
      if v_cost_qty <= 0 or abs(v_cost_qty - v_target_qty) > 0.0001 then
        raise exception using errcode = 'P0001', message = 'FNB_TRANSFER_COST_MOVEMENTS_REQUIRED';
      end if;
      v_transfer_unit_cost := round(v_cost_total / v_cost_qty, 6);
      for v_movement in
        select sm.id, sm.quantity, sm.note, sm.created_by
          from public.stock_movements sm
         where sm.tenant_id = v_transfer.tenant_id and sm.branch_id = v_transfer.to_branch_id
           and sm.product_id = v_product.product_id and sm.reference_type = 'stock_transfer'
           and sm.reference_id = p_transfer_id and sm.type = 'in'
         order by sm.id
      loop
        perform public._post_fnb_branch_cost_in_00390(
          v_transfer.tenant_id, v_transfer.to_branch_id, v_product.product_id,
          v_movement.quantity, v_transfer_unit_cost, 'stock_transfer',
          'stock_transfer', p_transfer_id, v_movement.id,
          v_movement.note, v_movement.created_by
        );
      end loop;
    end if;
  end loop;
  return v_result;
end;
$$;

revoke all on function public.complete_stock_transfer_atomic(uuid,uuid,uuid)
  from public, anon;
grant execute on function public.complete_stock_transfer_atomic(uuid,uuid,uuid)
  to authenticated, service_role;

commit;
