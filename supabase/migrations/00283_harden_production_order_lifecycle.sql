-- ============================================================
-- 00283: Harden production-order lifecycle
-- ============================================================
-- Definition only. This migration does not update business data.
--
-- Guarantees:
--   - create order + materials is one transaction;
--   - actor, tenant and branch access are derived server-side;
--   - ordinary status changes cannot bypass complete/cancel stock flows;
--   - complete/cancel require effective permissions and branch access;
--   - cancel never falls back to a status-only update.

create or replace function public.create_production_order_atomic(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_order record;
  v_code text;
  v_branch_id uuid;
  v_bom_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_planned_qty numeric;
  v_materials jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.id, p.tenant_id, p.role
    into v_profile
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'production.create_order') then
    raise exception using errcode = '42501', message = 'CREATE_PRODUCTION_ORDER_PERMISSION_REQUIRED';
  end if;

  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or exists (
       select 1
         from jsonb_object_keys(p_input) as item(key)
        where item.key not in (
          'branch_id', 'bom_id', 'product_id', 'variant_id', 'planned_qty',
          'planned_start', 'planned_end', 'notes', 'materials'
        )
     ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_INPUT_INVALID';
  end if;

  begin
    v_branch_id := nullif(p_input->>'branch_id', '')::uuid;
    v_bom_id := nullif(p_input->>'bom_id', '')::uuid;
    v_product_id := nullif(p_input->>'product_id', '')::uuid;
    v_variant_id := nullif(p_input->>'variant_id', '')::uuid;
    v_planned_qty := (p_input->>'planned_qty')::numeric;
  exception when others then
    raise exception using errcode = '22023', message = 'PRODUCTION_INPUT_INVALID';
  end;

  if v_branch_id is null
     or not exists (
       select 1
         from public.branches b
        where b.id = v_branch_id
          and b.tenant_id = v_profile.tenant_id
          and coalesce(b.is_active, true)
     )
     or not public.user_has_branch_access(v_actor, v_branch_id) then
    raise exception using errcode = '42501', message = 'PRODUCTION_BRANCH_ACCESS_DENIED';
  end if;
  if v_planned_qty is null or v_planned_qty <= 0 then
    raise exception using errcode = '22023', message = 'PLANNED_QUANTITY_INVALID';
  end if;
  if nullif(trim(coalesce(p_input->>'notes', '')), '') is not null
     and length(p_input->>'notes') > 2000 then
    raise exception using errcode = '22023', message = 'PRODUCTION_NOTES_TOO_LONG';
  end if;
  if nullif(p_input->>'planned_start', '') is not null
     and nullif(p_input->>'planned_end', '') is not null
     and (p_input->>'planned_end')::date < (p_input->>'planned_start')::date then
    raise exception using errcode = '22023', message = 'PRODUCTION_DATE_RANGE_INVALID';
  end if;

  if not exists (
    select 1
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_profile.tenant_id
       and coalesce(p.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_PRODUCT_NOT_FOUND';
  end if;
  if not exists (
    select 1
      from public.bom b
     where b.id = v_bom_id
       and b.tenant_id = v_profile.tenant_id
       and b.product_id = v_product_id
       and coalesce(b.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_BOM_NOT_FOUND';
  end if;
  if v_variant_id is not null and not exists (
    select 1
      from public.product_variants pv
     where pv.id = v_variant_id
       and pv.tenant_id = v_profile.tenant_id
       and pv.product_id = v_product_id
       and coalesce(pv.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_VARIANT_NOT_FOUND';
  end if;

  v_materials := p_input->'materials';
  if v_materials is null
     or jsonb_typeof(v_materials) <> 'array'
     or jsonb_array_length(v_materials) = 0
     or jsonb_array_length(v_materials) > 500 then
    raise exception using errcode = '22023', message = 'PRODUCTION_MATERIALS_INVALID';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_materials) as item(value)
     where jsonb_typeof(item.value) <> 'object'
        or nullif(item.value->>'product_id', '') is null
        or nullif(trim(coalesce(item.value->>'unit', '')), '') is null
        or length(item.value->>'unit') > 40
        or (item.value->>'planned_qty')::numeric <= 0
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_MATERIAL_INVALID';
  end if;
  if (
    select count(*)
      from jsonb_array_elements(v_materials) as item(value)
  ) <> (
    select count(distinct (item.value->>'product_id')::uuid)
      from jsonb_array_elements(v_materials) as item(value)
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_MATERIAL_DUPLICATED';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_materials) as item(value)
      left join public.products p
        on p.id = (item.value->>'product_id')::uuid
       and p.tenant_id = v_profile.tenant_id
       and coalesce(p.is_active, true)
     where p.id is null
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_MATERIAL_NOT_FOUND';
  end if;

  v_code := public.next_code(v_profile.tenant_id, 'production_order');

  insert into public.production_orders (
    tenant_id, code, branch_id, bom_id, product_id, variant_id,
    planned_qty, planned_start, planned_end, notes, created_by
  ) values (
    v_profile.tenant_id,
    v_code,
    v_branch_id,
    v_bom_id,
    v_product_id,
    v_variant_id,
    v_planned_qty,
    nullif(p_input->>'planned_start', '')::date,
    nullif(p_input->>'planned_end', '')::date,
    nullif(trim(coalesce(p_input->>'notes', '')), ''),
    v_actor
  )
  returning * into v_order;

  insert into public.production_order_materials (
    production_order_id, product_id, planned_qty, unit, unit_cost
  )
  select
    v_order.id,
    p.id,
    (item.value->>'planned_qty')::numeric,
    trim(item.value->>'unit'),
    coalesce(p.cost_price, 0)
  from jsonb_array_elements(v_materials) as item(value)
  join public.products p
    on p.id = (item.value->>'product_id')::uuid
   and p.tenant_id = v_profile.tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_profile.tenant_id,
    v_actor,
    'create',
    'production_order',
    v_order.id,
    to_jsonb(v_order) || jsonb_build_object(
      'material_count', jsonb_array_length(v_materials),
      'atomic', true
    )
  );

  return jsonb_build_object(
    'id', v_order.id,
    'code', v_order.code,
    'status', v_order.status,
    'branch_id', v_order.branch_id
  );
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'PRODUCTION_INPUT_INVALID';
end;
$$;

create or replace function public.change_production_status_atomic(
  p_production_order_id uuid,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_order record;
  v_allowed boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.id, p.tenant_id, p.role
    into v_profile
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'production.complete_order') then
    raise exception using errcode = '42501', message = 'UPDATE_PRODUCTION_ORDER_PERMISSION_REQUIRED';
  end if;

  select po.*
    into v_order
    from public.production_orders po
   where po.id = p_production_order_id
     and po.tenant_id = v_profile.tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'PRODUCTION_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'PRODUCTION_BRANCH_ACCESS_DENIED';
  end if;
  if p_new_status in ('completed', 'cancelled') then
    raise exception using errcode = '22023', message = 'USE_PRODUCTION_STOCK_FLOW';
  end if;

  v_allowed := case v_order.status
    when 'planned' then p_new_status = 'material_check'
    when 'material_check' then p_new_status in ('planned', 'in_production')
    when 'in_production' then p_new_status = 'quality_check'
    when 'quality_check' then p_new_status = 'in_production'
    else false
  end;
  if not v_allowed then
    raise exception using errcode = '22023', message = 'PRODUCTION_STATUS_TRANSITION_INVALID';
  end if;

  update public.production_orders
     set status = p_new_status,
         actual_start = case
           when p_new_status = 'in_production' then coalesce(actual_start, now())
           else actual_start
         end,
         updated_at = now()
   where id = v_order.id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id,
    v_actor,
    'status_change',
    'production_order',
    v_order.id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('status', p_new_status, 'atomic', true)
  );

  return jsonb_build_object(
    'id', v_order.id,
    'from_status', v_order.status,
    'status', p_new_status
  );
end;
$$;

create or replace function public.revert_production_materials(
  p_production_order_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_order record;
  v_material record;
  v_reverted_qty numeric(15, 2) := 0;
  v_reverted_cogs numeric(15, 2) := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.id, p.tenant_id, p.role
    into v_profile
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'production.cancel_order') then
    raise exception using errcode = '42501', message = 'CANCEL_PRODUCTION_ORDER_PERMISSION_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'CANCEL_REASON_REQUIRED';
  end if;
  if length(p_reason) > 1000 then
    raise exception using errcode = '22023', message = 'CANCEL_REASON_TOO_LONG';
  end if;

  select po.*
    into v_order
    from public.production_orders po
   where po.id = p_production_order_id
     and po.tenant_id = v_profile.tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'PRODUCTION_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'PRODUCTION_BRANCH_ACCESS_DENIED';
  end if;
  if v_order.status not in ('planned', 'material_check', 'in_production', 'quality_check') then
    raise exception using errcode = '22023', message = 'PRODUCTION_CANCEL_STATUS_INVALID';
  end if;

  for v_material in
    select pom.id, pom.product_id, pom.actual_qty, pom.unit_cost
      from public.production_order_materials pom
     where pom.production_order_id = v_order.id
       and coalesce(pom.actual_qty, 0) > 0
     for update
  loop
    update public.products p
       set stock = coalesce(p.stock, 0) + v_material.actual_qty
     where p.id = v_material.product_id
       and p.tenant_id = v_profile.tenant_id;
    if not found then
      raise exception using errcode = '22023', message = 'PRODUCTION_MATERIAL_NOT_FOUND';
    end if;

    insert into public.branch_stock (
      tenant_id, branch_id, product_id, variant_id, quantity
    ) values (
      v_profile.tenant_id,
      v_order.branch_id,
      v_material.product_id,
      null,
      v_material.actual_qty
    )
    on conflict (tenant_id, branch_id, product_id) where variant_id is null
    do update
      set quantity = public.branch_stock.quantity + excluded.quantity,
          updated_at = now();

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_profile.tenant_id,
      v_order.branch_id,
      v_material.product_id,
      'in',
      v_material.actual_qty,
      'production_order',
      v_order.id,
      'Huy san xuat: ' || v_order.code || ' - ' || trim(p_reason),
      v_actor
    );

    v_reverted_qty := v_reverted_qty + v_material.actual_qty;
    v_reverted_cogs := v_reverted_cogs
      + coalesce(v_material.unit_cost, 0) * v_material.actual_qty;

    update public.production_order_materials
       set actual_qty = null
     where id = v_material.id;
  end loop;

  update public.production_orders
     set status = 'cancelled',
         cogs_amount = 0,
         notes = concat_ws(
           E'\n',
           nullif(notes, ''),
           '[HUY] ' || trim(p_reason)
         ),
         updated_at = now()
   where id = v_order.id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id,
    v_actor,
    'cancel',
    'production_order',
    v_order.id,
    jsonb_build_object(
      'status', v_order.status,
      'cogs_amount', coalesce(v_order.cogs_amount, 0)
    ),
    jsonb_build_object(
      'status', 'cancelled',
      'reason', trim(p_reason),
      'reverted_materials_qty', v_reverted_qty,
      'reverted_cogs', v_reverted_cogs,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'reverted_materials_qty', v_reverted_qty,
    'reverted_cogs', v_reverted_cogs
  );
end;
$$;

create or replace function public.complete_production_atomic(
  p_production_order_id uuid,
  p_completed_qty numeric,
  p_lot_number text default null,
  p_manufactured_date date default current_date,
  p_expiry_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_order record;
  v_out_count integer;
  v_lot_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.id, p.tenant_id, p.role
    into v_profile
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'production.complete_order') then
    raise exception using errcode = '42501', message = 'COMPLETE_PRODUCTION_ORDER_PERMISSION_REQUIRED';
  end if;

  select po.*
    into v_order
    from public.production_orders po
   where po.id = p_production_order_id
     and po.tenant_id = v_profile.tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'PRODUCTION_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'PRODUCTION_BRANCH_ACCESS_DENIED';
  end if;
  if v_order.status not in ('planned', 'material_check', 'in_production', 'quality_check') then
    raise exception using errcode = '22023', message = 'PRODUCTION_COMPLETE_STATUS_INVALID';
  end if;
  if p_completed_qty is null
     or p_completed_qty <= 0
     or p_completed_qty > v_order.planned_qty then
    raise exception using errcode = '22023', message = 'COMPLETED_QUANTITY_INVALID';
  end if;
  if p_expiry_date is not null
     and p_manufactured_date is not null
     and p_expiry_date < p_manufactured_date then
    raise exception using errcode = '22023', message = 'PRODUCTION_EXPIRY_DATE_INVALID';
  end if;

  select count(*)
    into v_out_count
    from public.stock_movements sm
   where sm.tenant_id = v_profile.tenant_id
     and sm.reference_id = v_order.id
     and sm.reference_type = 'production_order'
     and sm.type = 'out';
  if v_out_count > 0 then
    raise exception using errcode = '22023', message = 'PRODUCTION_STOCK_RECONCILIATION_REQUIRED';
  end if;

  perform public.consume_production_materials(v_order.id);
  v_lot_id := public.complete_production_order(
    v_order.id,
    p_completed_qty,
    nullif(trim(coalesce(p_lot_number, '')), ''),
    coalesce(p_manufactured_date, current_date),
    p_expiry_date
  );

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id,
    v_actor,
    'complete',
    'production_order',
    v_order.id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object(
      'status', 'completed',
      'completed_qty', p_completed_qty,
      'lot_id', v_lot_id,
      'atomic', true
    )
  );

  return v_lot_id;
end;
$$;

revoke all on function public.create_production_order_atomic(jsonb) from public, anon;
grant execute on function public.create_production_order_atomic(jsonb) to authenticated;

revoke all on function public.change_production_status_atomic(uuid, text) from public, anon;
grant execute on function public.change_production_status_atomic(uuid, text) to authenticated;

revoke all on function public.revert_production_materials(uuid, text) from public, anon;
grant execute on function public.revert_production_materials(uuid, text) to authenticated;

revoke all on function public.complete_production_atomic(uuid, numeric, text, date, date)
  from public, anon;
grant execute on function public.complete_production_atomic(uuid, numeric, text, date, date)
  to authenticated;

-- Keep low-level stock functions callable only from trusted server/database code.
revoke all on function public.consume_production_materials(uuid)
  from public, anon, authenticated;
grant execute on function public.consume_production_materials(uuid) to service_role;

revoke all on function public.complete_production_order(uuid, numeric, text, date, date)
  from public, anon, authenticated;
grant execute on function public.complete_production_order(uuid, numeric, text, date, date)
  to service_role;

select
  to_regprocedure('public.create_production_order_atomic(jsonb)') is not null
    as production_create_rpc_ok,
  to_regprocedure('public.change_production_status_atomic(uuid,text)') is not null
    as production_status_rpc_ok,
  to_regprocedure('public.revert_production_materials(uuid,text)') is not null
    as production_cancel_rpc_ok,
  to_regprocedure('public.complete_production_atomic(uuid,numeric,text,date,date)') is not null
    as production_complete_rpc_ok;

notify pgrst, 'reload schema';
