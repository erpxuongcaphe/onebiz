-- ============================================================
-- 00069: Weighted Average Cost (WAC) auto-update + BOM cost cache
--
-- CEO 13/05/2026: 3 gap nghiêm trọng trong cost tracking:
--   Gap #1: NVL.cost_price KHÔNG tự update khi nhập kho giá mới
--   Gap #2: SKU thành phẩm.cost_price KHÔNG tự update theo COGS thực
--   Gap #3: BOM cost chỉ tính on-demand, không persist
--
-- Phương pháp: WAC (Weighted Average Cost / Bình quân gia quyền) — chuẩn
-- kế toán VN (TT200, TT133). Áp dụng nhất quán cho NVL nhập kho VÀ thành
-- phẩm sản xuất.
--
-- Formula:
--   new_cost = (current_stock × current_cost + new_qty × new_unit_price)
--              ───────────────────────────────────────────────────────────
--              (current_stock + new_qty)
--
-- Edge cases (CỰC KỲ QUAN TRỌNG):
--   1. current_stock <= 0 hoặc cost_price IS NULL/0 → new_cost = new_unit_price
--      (không có stock cũ để trung bình → dùng giá mới)
--   2. new_unit_price <= 0 hoặc new_qty <= 0 → SKIP update (đừng phá cost cũ)
--   3. current_stock + new_qty = 0 → impossible nếu new_qty > 0; skip
--   4. Race condition: 2 PO cùng receive 1 SP → FOR UPDATE row lock
--   5. Audit log mỗi lần update → CEO trace cost đổi qua thời gian
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. Helper apply_weighted_avg_cost — atomic, race-safe, audited
-- ────────────────────────────────────────────────────────────────
create or replace function public.apply_weighted_avg_cost(
  p_product_id uuid,
  p_new_qty numeric,
  p_new_unit_price numeric,
  p_reason text,                          -- 'purchase_receive' | 'production_complete'
  p_reference_type text default null,     -- 'purchase_order' | 'production_order'
  p_reference_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_product record;
  v_old_cost numeric(15, 4);
  v_old_stock numeric(15, 4);
  v_new_cost numeric(15, 4);
  v_actor uuid := auth.uid();
begin
  -- ── Edge case: skip nếu input không hợp lệ ──
  if p_new_qty is null or p_new_qty <= 0 then
    return jsonb_build_object('skipped', true, 'reason', 'INVALID_QTY');
  end if;
  if p_new_unit_price is null or p_new_unit_price <= 0 then
    return jsonb_build_object('skipped', true, 'reason', 'INVALID_UNIT_PRICE');
  end if;

  -- ── Lock row để chống race condition giữa 2 PO cùng receive ──
  select id, tenant_id, code, name, cost_price, stock
    into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND: %', p_product_id;
  end if;

  v_old_cost := coalesce(v_product.cost_price, 0);
  v_old_stock := coalesce(v_product.stock, 0);

  -- ── Tính WAC ──
  if v_old_stock <= 0 or v_old_cost <= 0 then
    -- Không có stock cũ hoặc cost cũ = 0 → dùng giá mới luôn
    v_new_cost := p_new_unit_price;
  else
    -- Bình quân gia quyền chuẩn
    v_new_cost := round(
      (v_old_stock * v_old_cost + p_new_qty * p_new_unit_price)
      / (v_old_stock + p_new_qty),
      4
    );
  end if;

  -- ── Update products.cost_price ──
  update public.products
  set cost_price = v_new_cost,
      updated_at = now()
  where id = p_product_id;

  -- ── Audit log để CEO trace lịch sử đổi cost ──
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_product.tenant_id,
    coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid),
    'cost_price_update',
    'product',
    p_product_id,
    jsonb_build_object(
      'cost_price', v_old_cost,
      'stock', v_old_stock
    ),
    jsonb_build_object(
      'cost_price', v_new_cost,
      'qty_added', p_new_qty,
      'unit_price_in', p_new_unit_price,
      'reason', p_reason,
      'reference_type', p_reference_type,
      'reference_id', p_reference_id,
      'product_code', v_product.code,
      'product_name', v_product.name
    )
  );

  return jsonb_build_object(
    'updated', true,
    'product_id', p_product_id,
    'old_cost', v_old_cost,
    'new_cost', v_new_cost,
    'old_stock', v_old_stock,
    'new_stock', v_old_stock + p_new_qty
  );
end;
$$;

comment on function public.apply_weighted_avg_cost is
  'Weighted Average Cost update (chuẩn TT200). Atomic, row-lock, audit log. Edge: stock=0 hoặc cost=NULL → dùng giá mới.';

grant execute on function public.apply_weighted_avg_cost(uuid, numeric, numeric, text, text, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2. Patch receive_purchase_items_atomic (Gap #1) — call WAC sau khi tăng stock
-- ────────────────────────────────────────────────────────────────
-- LƯU Ý: phải gọi WAC TRƯỚC khi increment_product_stock để dùng đúng
-- old_stock (chưa cộng qty mới). Trong RPC này em update WAC inline ngay sau
-- khi xác định v_actual_qty + r.unit_price > 0.
--
-- Drop signature cũ để recreate với logic mới
drop function if exists public.receive_purchase_items_atomic(uuid, jsonb, uuid);

create or replace function public.receive_purchase_items_atomic(
  p_order_id uuid,
  p_lines jsonb,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_po record;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_received_lines int := 0;
  v_received_qty_total numeric := 0;
  v_cost_updates int := 0;  -- count WAC updates cho audit
  v_all_received boolean;
  v_new_status text;
  v_input_invoice_id uuid := null;
  v_input_invoice_code text := null;
  v_input_invoice_total numeric := 0;
  v_today date := current_date;
  v_lot_stamp text := to_char(now(), 'YYYYMMDD');
  v_lot_idx int := 0;
  v_has_full_receive boolean;
  r record;
  v_requested_qty numeric;
  v_actual_qty numeric;
  v_remaining numeric;
  v_new_received numeric;
  v_wac_result jsonb;
begin
  -- 1. Load PO + validate
  select id, code, status, branch_id, tenant_id, supplier_id
    into v_po
  from public.purchase_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Purchase order % not found', p_order_id;
  end if;

  if v_po.status not in ('ordered', 'partial') then
    raise exception
      'Không thể nhập hàng ở trạng thái "%" (chỉ cho phép ordered/partial)',
      v_po.status;
  end if;

  v_tenant_id := v_po.tenant_id;
  v_branch_id := v_po.branch_id;

  -- 2. Detect "full receive all" mode
  v_has_full_receive :=
    p_lines is null
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) = 0;

  -- 3. Loop items
  for r in
    select id, product_id, product_name, quantity, received_quantity, unit_price
    from public.purchase_order_items
    where purchase_order_id = p_order_id
    for update
  loop
    v_remaining := greatest(0, coalesce(r.quantity, 0) - coalesce(r.received_quantity, 0));
    if v_remaining <= 0 then
      continue;
    end if;

    if v_has_full_receive then
      v_requested_qty := v_remaining;
    else
      select coalesce((elem->>'receive_qty')::numeric, 0)
        into v_requested_qty
      from jsonb_array_elements(p_lines) elem
      where (elem->>'item_id')::uuid = r.id
      limit 1;

      if v_requested_qty is null then
        v_requested_qty := 0;
      end if;
    end if;

    v_actual_qty := least(greatest(v_requested_qty, 0), v_remaining);
    if v_actual_qty <= 0 then
      continue;
    end if;

    -- ──────────────────────────────────────────────────────────
    -- GAP #1 FIX: Apply WAC BEFORE increment_product_stock
    -- ──────────────────────────────────────────────────────────
    -- apply_weighted_avg_cost dùng products.stock CHƯA bao gồm qty này
    -- → tính WAC đúng formula
    if r.unit_price is not null and r.unit_price > 0 then
      v_wac_result := public.apply_weighted_avg_cost(
        r.product_id,
        v_actual_qty,
        r.unit_price,
        'purchase_receive',
        'purchase_order',
        p_order_id
      );
      if (v_wac_result->>'updated')::boolean is true then
        v_cost_updates := v_cost_updates + 1;
      end if;
    end if;

    -- 3a. Stock movement ledger
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_branch_id, r.product_id, 'in', v_actual_qty,
      'purchase_order', p_order_id,
      v_po.code || ' - Nhập hàng NCC - ' || r.product_name,
      p_created_by
    );

    -- 3b. Atomic stock updates (products.stock + branch_stock)
    perform public.increment_product_stock(r.product_id, v_actual_qty);
    perform public.upsert_branch_stock(
      v_tenant_id, v_branch_id, r.product_id, v_actual_qty
    );

    -- 3c. Create product lot (FIFO)
    v_lot_idx := v_lot_idx + 1;
    insert into public.product_lots (
      tenant_id, product_id, variant_id, lot_number,
      source_type, purchase_order_id, supplier_id,
      received_date, initial_qty, current_qty,
      branch_id, status, note
    ) values (
      v_tenant_id, r.product_id, null,
      v_po.code || '-' || v_lot_stamp || '-' || lpad(v_lot_idx::text, 2, '0'),
      'purchase', p_order_id, v_po.supplier_id,
      v_today, v_actual_qty, v_actual_qty,
      v_branch_id, 'active', 'Nhập từ ' || v_po.code
    );

    -- 3d. Update received_quantity
    v_new_received := coalesce(r.received_quantity, 0) + v_actual_qty;
    update public.purchase_order_items
    set received_quantity = v_new_received
    where id = r.id;

    v_received_lines := v_received_lines + 1;
    v_received_qty_total := v_received_qty_total + v_actual_qty;
    v_input_invoice_total := v_input_invoice_total +
      (v_actual_qty * coalesce(r.unit_price, 0));
  end loop;

  if v_received_lines = 0 then
    raise exception 'Không có dòng hợp lệ nào để nhập — kiểm tra lại số lượng';
  end if;

  -- 4. Compute new status
  select bool_and(coalesce(received_quantity, 0) >= coalesce(quantity, 0))
    into v_all_received
  from public.purchase_order_items
  where purchase_order_id = p_order_id;

  v_new_status := case when v_all_received then 'completed' else 'partial' end;

  update public.purchase_orders
  set status = v_new_status, updated_at = now()
  where id = p_order_id and status in ('ordered', 'partial');

  if not found then
    raise exception
      'Purchase order % đã bị thay đổi trạng thái bởi request khác — vui lòng thử lại',
      p_order_id;
  end if;

  -- 5. Input invoice — khi đơn vừa hoàn thành
  if v_new_status = 'completed' and v_input_invoice_total > 0 then
    if not exists (
      select 1 from public.input_invoices
      where purchase_order_id = p_order_id
    ) then
      v_input_invoice_code := public.next_code(v_tenant_id, 'input_invoice');
      if v_input_invoice_code is null or v_input_invoice_code = '' then
        v_input_invoice_code := 'HDV' || extract(epoch from now())::bigint::text;
      end if;

      insert into public.input_invoices (
        tenant_id, branch_id, code,
        supplier_id, supplier_name,
        total_amount, tax_amount, status,
        purchase_order_id, note, created_by
      )
      select
        v_tenant_id, v_branch_id, v_input_invoice_code,
        v_po.supplier_id,
        (select name from public.suppliers where id = v_po.supplier_id),
        v_input_invoice_total, 0, 'unrecorded',
        p_order_id, 'Tự tạo từ PO ' || v_po.code, p_created_by;

      select id into v_input_invoice_id
      from public.input_invoices
      where code = v_input_invoice_code
        and tenant_id = v_tenant_id;
    end if;
  end if;

  return jsonb_build_object(
    'new_status', v_new_status,
    'received_lines', v_received_lines,
    'received_qty_total', v_received_qty_total,
    'cost_updates', v_cost_updates,
    'input_invoice_id', v_input_invoice_id,
    'input_invoice_code', v_input_invoice_code
  );
end;
$$;

grant execute on function public.receive_purchase_items_atomic(uuid, jsonb, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. Patch complete_production_order (Gap #2) — auto-update cost SKU thành phẩm
-- ────────────────────────────────────────────────────────────────
-- Sau khi consume_production_materials() → production_orders.cogs_amount đã có.
-- Tính unit_cogs = cogs_amount / completed_qty → apply WAC cho SKU thành phẩm.
drop function if exists public.complete_production_order(uuid, numeric, text, date, date);

create or replace function public.complete_production_order(
  p_production_order_id uuid,
  p_completed_qty numeric,
  p_lot_number text default null,
  p_manufactured_date date default current_date,
  p_expiry_date date default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_lot_id uuid;
  v_lot_number text;
  v_unit_cogs numeric(15, 4);
  v_wac_result jsonb;
begin
  select * into v_order from public.production_orders
  where id = p_production_order_id;
  if not found then
    raise exception 'Production order not found';
  end if;

  -- Generate lot number nếu không có
  v_lot_number := coalesce(
    p_lot_number,
    'LOT-' || to_char(now(), 'YYYYMMDD') || '-' || substr(uuid_generate_v4()::text, 1, 4)
  );

  -- Auto-calculate expiry nếu SP có shelf_life_days
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

  -- ──────────────────────────────────────────────────────────────
  -- GAP #2 FIX: Apply WAC cho SKU thành phẩm TRƯỚC khi increment stock
  -- ──────────────────────────────────────────────────────────────
  -- unit_cogs = cogs_amount (từ consume_production_materials 00026) / completed_qty
  -- Skip nếu cogs_amount = 0 (chưa consume materials hoặc materials cost = 0)
  if v_order.cogs_amount is not null
     and v_order.cogs_amount > 0
     and p_completed_qty > 0 then
    v_unit_cogs := round(v_order.cogs_amount / p_completed_qty, 4);

    v_wac_result := public.apply_weighted_avg_cost(
      v_order.product_id,
      p_completed_qty,
      v_unit_cogs,
      'production_complete',
      'production_order',
      p_production_order_id
    );
  end if;

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
    'SX hoàn thành: ' || v_order.code || ' | Lot: ' || v_lot_number,
    v_order.created_by
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

grant execute on function public.complete_production_order(uuid, numeric, text, date, date) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. BOM cost cache (Gap #3)
-- ────────────────────────────────────────────────────────────────
-- Thêm 2 column vào bom: cached_cost + cached_cost_updated_at
-- Mỗi khi bom_items đổi hoặc material.cost_price đổi → trigger recalc.
alter table public.bom
  add column if not exists cached_cost numeric(15, 2),
  add column if not exists cached_cost_updated_at timestamptz;

comment on column public.bom.cached_cost is
  'Tổng cost của 1 mẻ sản xuất (batch_size) = sum(material_qty × waste% × material.cost_price). Auto-recalc qua trigger.';

-- 4.1. Helper recalculate_bom_cost_cache — compute + persist
create or replace function public.recalculate_bom_cost_cache(p_bom_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_total numeric := 0;
begin
  select coalesce(
    sum(bi.quantity * (1 + bi.waste_percent / 100) * coalesce(p.cost_price, 0)),
    0
  )
  into v_total
  from public.bom_items bi
  join public.products p on p.id = bi.material_id
  where bi.bom_id = p_bom_id;

  update public.bom
  set cached_cost = round(v_total, 2),
      cached_cost_updated_at = now()
  where id = p_bom_id;

  return v_total;
end;
$$;

grant execute on function public.recalculate_bom_cost_cache(uuid) to authenticated;

-- 4.2. Trigger function: khi bom_items thay đổi → recalc parent bom
create or replace function public.trg_bom_items_recalc_parent()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bom_id uuid;
begin
  v_bom_id := coalesce(NEW.bom_id, OLD.bom_id);
  if v_bom_id is not null then
    perform public.recalculate_bom_cost_cache(v_bom_id);
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_bom_items_recalc on public.bom_items;
create trigger trg_bom_items_recalc
  after insert or update or delete on public.bom_items
  for each row
  execute function public.trg_bom_items_recalc_parent();

-- 4.3. Trigger function: khi products.cost_price đổi → recalc tất cả BOM dùng làm material
-- LƯU Ý: KHÔNG cascade chain (BOM A → SKU A → BOM B). Chỉ recalc 1 level —
-- BOMs có material là product này. Cost SKU thành phẩm chỉ đổi qua
-- complete_production_order, không qua trigger này.
create or replace function public.trg_product_cost_cascade_bom()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bom_id uuid;
begin
  -- Chỉ react khi cost_price THẬT SỰ đổi (tránh recompute vô ích)
  if NEW.cost_price is distinct from OLD.cost_price then
    for v_bom_id in
      select distinct bom_id from public.bom_items
      where material_id = NEW.id
    loop
      perform public.recalculate_bom_cost_cache(v_bom_id);
    end loop;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_product_cost_cascade on public.products;
create trigger trg_product_cost_cascade
  after update of cost_price on public.products
  for each row
  execute function public.trg_product_cost_cascade_bom();

-- 4.4. Backfill: tính cached_cost cho TẤT CẢ BOM hiện có (1 lần khi chạy migration)
do $$
declare
  r record;
begin
  for r in select id from public.bom loop
    perform public.recalculate_bom_cost_cache(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
