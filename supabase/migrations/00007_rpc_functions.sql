-- ============================================================
-- OneBiz ERP — RPC Functions v4
-- next_group_code, BOM cost, Production, Lot FIFO, Pipeline
-- ============================================================

-- ============================================================
-- 1. next_group_code() — Sinh mã NVL-BAO-001, SKU-CPC-001, NCC-SUA-001, KHA-KSI-001
-- ============================================================
create or replace function public.next_group_code(
  p_tenant_id uuid,
  p_prefix text,
  p_group_code text
) returns text
language plpgsql
security definer
as $$
declare
  v_next int;
  v_padding int;
begin
  -- Upsert: increment or create sequence
  insert into public.group_code_sequences (tenant_id, prefix, group_code, current_number, padding)
  values (p_tenant_id, p_prefix, p_group_code, 1, 3)
  on conflict (tenant_id, prefix, group_code)
  do update set current_number = group_code_sequences.current_number + 1
  returning current_number, padding into v_next, v_padding;

  return p_prefix || '-' || p_group_code || '-' || lpad(v_next::text, v_padding, '0');
end;
$$;

-- ============================================================
-- 2. calculate_bom_cost() — Chi phí sản xuất theo BOM
-- ============================================================
create or replace function public.calculate_bom_cost(
  p_bom_id uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_total numeric := 0;
  v_items jsonb := '[]'::jsonb;
  r record;
begin
  for r in
    select
      bi.material_id,
      p.name as material_name,
      p.code as material_code,
      bi.quantity,
      bi.unit,
      bi.waste_percent,
      p.cost_price,
      round(bi.quantity * (1 + bi.waste_percent / 100) * p.cost_price, 2) as line_cost
    from public.bom_items bi
    join public.products p on p.id = bi.material_id
    where bi.bom_id = p_bom_id
    order by bi.sort_order
  loop
    v_total := v_total + r.line_cost;
    v_items := v_items || jsonb_build_object(
      'material_id', r.material_id,
      'material_name', r.material_name,
      'material_code', r.material_code,
      'quantity', r.quantity,
      'unit', r.unit,
      'waste_percent', r.waste_percent,
      'cost_price', r.cost_price,
      'line_cost', r.line_cost
    );
  end loop;

  return jsonb_build_object(
    'bom_id', p_bom_id,
    'total_cost', v_total,
    'items', v_items
  );
end;
$$;

-- ============================================================
-- 3. consume_production_materials() — Trừ NVL khi SX
-- ============================================================
create or replace function public.consume_production_materials(
  p_production_order_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_order record;
  r record;
begin
  select * into v_order from public.production_orders where id = p_production_order_id;
  if not found then
    raise exception 'Production order not found';
  end if;

  -- Trừ NVL stock theo actual_qty (hoặc planned_qty nếu chưa có actual)
  for r in
    select
      pom.product_id,
      coalesce(pom.actual_qty, pom.planned_qty) as qty,
      pom.unit
    from public.production_order_materials pom
    where pom.production_order_id = p_production_order_id
  loop
    -- Trừ stock tổng trên products
    update public.products
    set stock = stock - r.qty
    where id = r.product_id;

    -- Trừ branch_stock
    update public.branch_stock
    set quantity = quantity - r.qty, updated_at = now()
    where product_id = r.product_id and branch_id = v_order.branch_id;

    -- Log stock movement
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_order.tenant_id, v_order.branch_id, r.product_id, 'out', r.qty,
      'production_order', p_production_order_id,
      'SX: ' || v_order.code, v_order.created_by
    );
  end loop;
end;
$$;

-- ============================================================
-- 4. complete_production_order() — Nhập kho SKU + tạo lot
-- ============================================================
create or replace function public.complete_production_order(
  p_production_order_id uuid,
  p_completed_qty numeric,
  p_lot_number text default null,
  p_manufactured_date date default current_date,
  p_expiry_date date default null
) returns uuid
language plpgsql
security definer
as $$
declare
  v_order record;
  v_lot_id uuid;
  v_lot_number text;
begin
  select * into v_order from public.production_orders where id = p_production_order_id;
  if not found then
    raise exception 'Production order not found';
  end if;

  -- Generate lot number if not provided
  v_lot_number := coalesce(p_lot_number, 'LOT-' || to_char(now(), 'YYYYMMDD') || '-' || substr(uuid_generate_v4()::text, 1, 4));

  -- Auto-calculate expiry if product has shelf_life_days
  if p_expiry_date is null then
    select
      case
        when shelf_life_unit = 'day' then p_manufactured_date + shelf_life_days
        when shelf_life_unit = 'month' then p_manufactured_date + (shelf_life_days || ' months')::interval
        when shelf_life_unit = 'year' then p_manufactured_date + (shelf_life_days || ' years')::interval
        else null
      end
    into p_expiry_date
    from public.products
    where id = v_order.product_id and shelf_life_days is not null;
  end if;

  -- Tạo lot
  insert into public.product_lots (
    tenant_id, product_id, variant_id, lot_number,
    source_type, production_order_id,
    manufactured_date, expiry_date, received_date,
    initial_qty, current_qty, branch_id, status
  ) values (
    v_order.tenant_id, v_order.product_id, v_order.variant_id, v_lot_number,
    'production', p_production_order_id,
    p_manufactured_date, p_expiry_date, current_date,
    p_completed_qty, p_completed_qty, v_order.branch_id, 'active'
  ) returning id into v_lot_id;

  -- Nhập kho SKU
  update public.products
  set stock = stock + p_completed_qty
  where id = v_order.product_id;

  -- Nhập branch_stock
  insert into public.branch_stock (tenant_id, branch_id, product_id, variant_id, quantity)
  values (v_order.tenant_id, v_order.branch_id, v_order.product_id, v_order.variant_id, p_completed_qty)
  on conflict (branch_id, product_id, variant_id)
  do update set quantity = branch_stock.quantity + p_completed_qty, updated_at = now();

  -- Log stock movement IN
  insert into public.stock_movements (
    tenant_id, branch_id, product_id, type, quantity,
    reference_type, reference_id, note, created_by
  ) values (
    v_order.tenant_id, v_order.branch_id, v_order.product_id, 'in', p_completed_qty,
    'production_order', p_production_order_id,
    'SX hoàn thành: ' || v_order.code || ' | Lot: ' || v_lot_number, v_order.created_by
  );

  -- Update production order
  update public.production_orders
  set completed_qty = p_completed_qty,
      lot_number = v_lot_number,
      status = 'completed',
      actual_end = now(),
      updated_at = now()
  where id = p_production_order_id;

  return v_lot_id;
end;
$$;

-- ============================================================
-- 5. allocate_lots_fifo() — Auto chọn lots FIFO, trừ current_qty
-- ============================================================
create or replace function public.allocate_lots_fifo(
  p_tenant_id uuid,
  p_product_id uuid,
  p_branch_id uuid,
  p_quantity numeric,
  p_source_type text,
  p_source_id uuid,
  p_allocated_by uuid default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_remaining numeric := p_quantity;
  v_allocated jsonb := '[]'::jsonb;
  r record;
  v_take numeric;
begin
  -- FIFO: sort by expiry_date ASC (sớm nhất trước), then received_date ASC
  for r in
    select id, lot_number, current_qty, expiry_date, manufactured_date
    from public.product_lots
    where tenant_id = p_tenant_id
      and product_id = p_product_id
      and branch_id = p_branch_id
      and status = 'active'
      and current_qty > 0
    order by
      expiry_date asc nulls last,
      received_date asc,
      created_at asc
  loop
    exit when v_remaining <= 0;

    v_take := least(r.current_qty, v_remaining);

    -- Trừ current_qty
    update public.product_lots
    set current_qty = current_qty - v_take,
        status = case when current_qty - v_take <= 0 then 'consumed' else status end,
        updated_at = now()
    where id = r.id;

    -- Ghi lot_allocation
    insert into public.lot_allocations (
      tenant_id, lot_id, source_type, source_id, quantity, allocated_by
    ) values (
      p_tenant_id, r.id, p_source_type, p_source_id, v_take, p_allocated_by
    );

    v_remaining := v_remaining - v_take;

    v_allocated := v_allocated || jsonb_build_object(
      'lot_id', r.id,
      'lot_number', r.lot_number,
      'quantity', v_take,
      'expiry_date', r.expiry_date,
      'manufactured_date', r.manufactured_date
    );
  end loop;

  if v_remaining > 0 then
    raise warning 'Insufficient lot stock. Short by % units', v_remaining;
  end if;

  return jsonb_build_object(
    'allocated', v_allocated,
    'total_allocated', p_quantity - v_remaining,
    'shortage', v_remaining
  );
end;
$$;

-- ============================================================
-- 6. get_lots_for_product() — Danh sách lots còn tồn
-- ============================================================
create or replace function public.get_lots_for_product(
  p_product_id uuid,
  p_branch_id uuid default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_lots jsonb := '[]'::jsonb;
  r record;
begin
  for r in
    select
      pl.id, pl.lot_number, pl.source_type,
      pl.manufactured_date, pl.expiry_date, pl.received_date,
      pl.current_qty, pl.initial_qty, pl.status,
      pl.branch_id, b.name as branch_name,
      case
        when pl.expiry_date is null then 'no_expiry'
        when pl.expiry_date < current_date then 'expired'
        when pl.expiry_date < current_date + interval '30 days' then 'expiring_soon'
        else 'ok'
      end as expiry_status,
      pl.expiry_date - current_date as days_until_expiry
    from public.product_lots pl
    join public.branches b on b.id = pl.branch_id
    where pl.product_id = p_product_id
      and pl.status = 'active'
      and pl.current_qty > 0
      and (p_branch_id is null or pl.branch_id = p_branch_id)
    order by pl.expiry_date asc nulls last, pl.received_date asc
  loop
    v_lots := v_lots || jsonb_build_object(
      'id', r.id,
      'lot_number', r.lot_number,
      'source_type', r.source_type,
      'manufactured_date', r.manufactured_date,
      'expiry_date', r.expiry_date,
      'received_date', r.received_date,
      'current_qty', r.current_qty,
      'initial_qty', r.initial_qty,
      'branch_name', r.branch_name,
      'expiry_status', r.expiry_status,
      'days_until_expiry', r.days_until_expiry
    );
  end loop;

  return v_lots;
end;
$$;

-- ============================================================
-- 7. check_expiring_lots() — Lots sắp hết hạn
-- ============================================================
create or replace function public.check_expiring_lots(
  p_tenant_id uuid,
  p_days_threshold int default 30
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb := '[]'::jsonb;
  r record;
begin
  for r in
    select
      pl.id, pl.lot_number, pl.product_id,
      p.name as product_name, p.code as product_code,
      pl.expiry_date, pl.current_qty,
      pl.branch_id, b.name as branch_name,
      pl.expiry_date - current_date as days_remaining
    from public.product_lots pl
    join public.products p on p.id = pl.product_id
    join public.branches b on b.id = pl.branch_id
    where pl.tenant_id = p_tenant_id
      and pl.status = 'active'
      and pl.current_qty > 0
      and pl.expiry_date is not null
      and pl.expiry_date <= current_date + (p_days_threshold || ' days')::interval
    order by pl.expiry_date asc
  loop
    v_result := v_result || jsonb_build_object(
      'lot_id', r.id,
      'lot_number', r.lot_number,
      'product_id', r.product_id,
      'product_name', r.product_name,
      'product_code', r.product_code,
      'expiry_date', r.expiry_date,
      'current_qty', r.current_qty,
      'branch_name', r.branch_name,
      'days_remaining', r.days_remaining,
      'is_expired', r.days_remaining < 0
    );
  end loop;

  return jsonb_build_object(
    'threshold_days', p_days_threshold,
    'total', jsonb_array_length(v_result),
    'lots', v_result
  );
end;
$$;

-- ============================================================
-- 8. Pipeline RPCs
-- ============================================================

-- 8.1 pipeline_transition() — Chuyển stage
create or replace function public.pipeline_transition(
  p_pipeline_item_id uuid,
  p_to_stage_id uuid,
  p_changed_by uuid default null,
  p_note text default null,
  p_dimensions jsonb default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_item record;
  v_transition record;
begin
  select * into v_item from public.pipeline_items where id = p_pipeline_item_id;
  if not found then
    raise exception 'Pipeline item not found';
  end if;

  -- Validate transition exists
  select * into v_transition
  from public.pipeline_transitions
  where from_stage_id = v_item.current_stage_id and to_stage_id = p_to_stage_id;

  if not found then
    raise exception 'Transition not allowed from current stage to target stage';
  end if;

  -- Log history
  insert into public.pipeline_history (
    pipeline_item_id, from_stage_id, to_stage_id, transition_id, changed_by, note
  ) values (
    p_pipeline_item_id, v_item.current_stage_id, p_to_stage_id, v_transition.id, p_changed_by, p_note
  );

  -- Update item
  update public.pipeline_items
  set current_stage_id = p_to_stage_id,
      dimensions = coalesce(p_dimensions, dimensions),
      entered_at = now(),
      updated_at = now()
  where id = p_pipeline_item_id;

  return jsonb_build_object(
    'success', true,
    'from_stage', v_item.current_stage_id,
    'to_stage', p_to_stage_id,
    'transition_name', v_transition.name
  );
end;
$$;

-- 8.2 pipeline_get_allowed_transitions() — Transitions cho phép từ stage hiện tại
create or replace function public.pipeline_get_allowed_transitions(
  p_pipeline_item_id uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_item record;
  v_result jsonb := '[]'::jsonb;
  r record;
begin
  select * into v_item from public.pipeline_items where id = p_pipeline_item_id;
  if not found then return '[]'::jsonb; end if;

  for r in
    select pt.id, pt.name, ps.id as stage_id, ps.code, ps.name as stage_name, ps.color
    from public.pipeline_transitions pt
    join public.pipeline_stages ps on ps.id = pt.to_stage_id
    where pt.from_stage_id = v_item.current_stage_id
    order by ps.sort_order
  loop
    v_result := v_result || jsonb_build_object(
      'transition_id', r.id,
      'name', r.name,
      'to_stage_id', r.stage_id,
      'to_stage_code', r.code,
      'to_stage_name', r.stage_name,
      'to_stage_color', r.color
    );
  end loop;

  return v_result;
end;
$$;

-- 8.3 pipeline_get_board() — Kanban board data
create or replace function public.pipeline_get_board(
  p_pipeline_id uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_columns jsonb := '[]'::jsonb;
  r_stage record;
  v_items jsonb;
begin
  for r_stage in
    select id, code, name, color, sort_order, is_initial, is_final
    from public.pipeline_stages
    where pipeline_id = p_pipeline_id
    order by sort_order
  loop
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', pi.id,
        'entity_id', pi.entity_id,
        'dimensions', pi.dimensions,
        'entered_at', pi.entered_at
      ) order by pi.entered_at desc
    ), '[]'::jsonb) into v_items
    from public.pipeline_items pi
    where pi.current_stage_id = r_stage.id;

    v_columns := v_columns || jsonb_build_object(
      'stage_id', r_stage.id,
      'code', r_stage.code,
      'name', r_stage.name,
      'color', r_stage.color,
      'is_initial', r_stage.is_initial,
      'is_final', r_stage.is_final,
      'items', v_items,
      'count', jsonb_array_length(v_items)
    );
  end loop;

  return jsonb_build_object(
    'pipeline_id', p_pipeline_id,
    'columns', v_columns
  );
end;
$$;

-- 8.4 pipeline_get_timeline() — Timeline history cho 1 entity
create or replace function public.pipeline_get_timeline(
  p_pipeline_item_id uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb := '[]'::jsonb;
  r record;
begin
  for r in
    select
      ph.id, ph.changed_at, ph.note,
      fs.name as from_stage_name, fs.code as from_stage_code, fs.color as from_color,
      ts.name as to_stage_name, ts.code as to_stage_code, ts.color as to_color,
      p.full_name as changed_by_name
    from public.pipeline_history ph
    left join public.pipeline_stages fs on fs.id = ph.from_stage_id
    join public.pipeline_stages ts on ts.id = ph.to_stage_id
    left join public.profiles p on p.id = ph.changed_by
    where ph.pipeline_item_id = p_pipeline_item_id
    order by ph.changed_at desc
  loop
    v_result := v_result || jsonb_build_object(
      'id', r.id,
      'changed_at', r.changed_at,
      'note', r.note,
      'from_stage', r.from_stage_name,
      'from_stage_code', r.from_stage_code,
      'from_color', r.from_color,
      'to_stage', r.to_stage_name,
      'to_stage_code', r.to_stage_code,
      'to_color', r.to_color,
      'changed_by', r.changed_by_name
    );
  end loop;

  return v_result;
end;
$$;
