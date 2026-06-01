-- ============================================================
-- 00122 — Sprint 2.3b: RPC scale BOM theo modifier + trừ tồn topping NVL
-- ============================================================
-- CEO 01/06/2026 (Phương án B+ — Toast inheritance):
--   Khi cashier FnB chọn modifier (vd "70% đường" + "Trân châu đen"):
--     1. Đường (NVL trong BOM của ly) bị scale theo scale_factor option đã chọn.
--        BOM 10g đường × 0.7 → tồn trừ 7g đường (KHÔNG phải 10g).
--     2. Trân châu (option có linkedProductId = NVL-TPV-001) trừ tồn 1 phần
--        cho mỗi ly có chọn.
--
-- Migration này KHÔNG đụng schema khác — chỉ:
--   1. ADD cột `modifier_selections jsonb` vào kitchen_order_items.
--   2. UPDATE fnb_send_to_kitchen_atomic để lưu cột mới.
--   3. UPDATE consume_bom_for_sale: nhận optional p_modifier_selections,
--      apply scale + trừ topping NVL.
--   4. UPDATE fnb_complete_payment_atomic: select modifier_selections + pass
--      vào consume_bom_for_sale.
--
-- BACKWARD COMPAT 100%:
--   - Nếu modifier_selections null/empty → behavior y nguyên trước.
--   - SP chưa setup modifier_scale_target trong bom_items → giữ qty BOM gốc.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ADD cột modifier_selections vào kitchen_order_items
-- ────────────────────────────────────────────────────────────
alter table public.kitchen_order_items
  add column if not exists modifier_selections jsonb;

comment on column public.kitchen_order_items.modifier_selections is
  'CEO 01/06/2026: Snapshot lựa chọn modifier (Mức đường, Mức đá, Topping...) tại thời điểm cashier tạo dòng. RPC consume_bom_for_sale đọc để scale BOM + trừ tồn topping NVL.';

-- ────────────────────────────────────────────────────────────
-- 2. UPDATE fnb_send_to_kitchen_atomic — lưu modifier_selections
-- ────────────────────────────────────────────────────────────
create or replace function public.fnb_send_to_kitchen_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_created_by uuid,
  p_table_id uuid default null,
  p_order_type text default 'dine_in',
  p_note text default null,
  p_idempotency_key text default null,
  p_order_number text default null,
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_existing record;
  v_item jsonb;
  v_product_id uuid;
  v_station_id uuid;
  v_claimed int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Kitchen order requires at least one item';
  end if;

  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select id, order_number into v_existing
    from public.kitchen_orders
    where tenant_id = p_tenant_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if found then
      return jsonb_build_object(
        'kitchen_order_id', v_existing.id,
        'order_number', v_existing.order_number,
        'idempotent', true
      );
    end if;
  end if;

  v_order_number := coalesce(nullif(p_order_number, ''), public.next_code(p_tenant_id, 'kitchen_order'));
  if v_order_number is null or v_order_number = '' then
    v_order_number := 'KB' || extract(epoch from now())::bigint::text;
  end if;

  insert into public.kitchen_orders (
    tenant_id, branch_id, table_id, order_number, order_type,
    note, created_by, idempotency_key
  ) values (
    p_tenant_id, p_branch_id, p_table_id, v_order_number, p_order_type,
    p_note, p_created_by, nullif(p_idempotency_key, '')
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::uuid;
    select c.kitchen_station_id into v_station_id
    from public.products p
    left join public.categories c on c.id = p.category_id and c.tenant_id = p.tenant_id
    where p.tenant_id = p_tenant_id and p.id = v_product_id
    limit 1;

    insert into public.kitchen_order_items (
      kitchen_order_id, product_id, product_name,
      variant_id, variant_label, quantity, unit_price,
      note, toppings, kitchen_station_id,
      modifier_selections  -- CEO 01/06/2026: Sprint 2.3a
    ) values (
      v_order_id,
      v_product_id,
      coalesce(nullif(v_item->>'productName', ''), 'Sản phẩm'),
      nullif(v_item->>'variantId', '')::uuid,
      nullif(v_item->>'variantLabel', ''),
      coalesce((v_item->>'quantity')::numeric, 0),
      coalesce((v_item->>'unitPrice')::numeric, 0),
      nullif(v_item->>'note', ''),
      v_item->'toppings',
      v_station_id,
      v_item->'modifierSelections'  -- jsonb path → null nếu absent
    );
  end loop;

  if p_order_type = 'dine_in' and p_table_id is not null then
    update public.restaurant_tables
    set status = 'occupied', current_order_id = v_order_id, updated_at = now()
    where tenant_id = p_tenant_id
      and id = p_table_id
      and status = 'available';

    get diagnostics v_claimed = row_count;
    if v_claimed = 0 then
      raise exception 'Table % is not available', p_table_id;
    end if;
  end if;

  return jsonb_build_object(
    'kitchen_order_id', v_order_id,
    'order_number', v_order_number
  );
exception when unique_violation then
  if p_idempotency_key is not null and p_idempotency_key <> '' then
    select id, order_number into v_existing
    from public.kitchen_orders
    where tenant_id = p_tenant_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if found then
      return jsonb_build_object(
        'kitchen_order_id', v_existing.id,
        'order_number', v_existing.order_number,
        'idempotent', true
      );
    end if;
  end if;
  raise;
end;
$$;

comment on function public.fnb_send_to_kitchen_atomic is
  'Atomic F&B send-to-kitchen v6 (CEO 01/06/2026): lưu modifier_selections JSONB.';

-- ────────────────────────────────────────────────────────────
-- 3. UPDATE consume_bom_for_sale — scale + trừ topping NVL
-- ────────────────────────────────────────────────────────────
-- Drop old 7-arg signature trước khi create new 8-arg signature.
-- Nếu skip bước này, Postgres treat thành 2 function khác (overload) →
-- caller cũ gọi vào signature cũ, bypass modifier scale.
drop function if exists public.consume_bom_for_sale(uuid, uuid, uuid, numeric, uuid, uuid, text);

create or replace function public.consume_bom_for_sale(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sku_id uuid,
  p_qty numeric,
  p_invoice_id uuid,
  p_created_by uuid,
  p_invoice_code text default null,
  p_modifier_selections jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bom_id uuid;
  v_bom record;
  v_item record;
  v_consumed jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_consume_qty numeric;
  v_available numeric;
  v_allow_negative boolean;
  v_note text;
  v_modifier_scale numeric;
  v_sel jsonb;
  v_opt jsonb;
  v_linked_id uuid;
  v_topping_qty numeric;
  v_topping_name text;
begin
  if p_tenant_id is null or p_branch_id is null or p_sku_id is null then
    raise exception 'consume_bom_for_sale: tenant_id, branch_id, sku_id are required';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'consume_bom_for_sale: qty must be > 0';
  end if;

  -- ─── 1. Lookup BOM ───
  v_bom_id := public.get_active_bom_for_branch(p_sku_id, p_branch_id);

  -- ─── 2. Get setting allow_negative_stock ───
  v_allow_negative := coalesce(
    (public.get_tenant_setting(p_tenant_id, 'allow_negative_stock', 'true'::jsonb))::boolean,
    true
  );

  -- ─── 3. BOM consume (nếu có BOM) ───
  if v_bom_id is not null then
    select b.id, b.name, b.code into v_bom
    from public.bom b
    where b.id = v_bom_id;

    v_note := format(
      'Tiêu hao NVL theo BOM [%s] — HĐ %s',
      coalesce(v_bom.code, v_bom.name, 'BOM'),
      coalesce(p_invoice_code, p_invoice_id::text)
    );

    for v_item in
      select
        bi.material_id,
        bi.unit,
        bi.quantity,
        coalesce(bi.waste_percent, 0) as waste_percent,
        bi.modifier_scale_target,  -- CEO 01/06/2026: Sprint 2.1 schema
        p.code as material_code,
        p.name as material_name
      from public.bom_items bi
        left join public.products p on p.id = bi.material_id
      where bi.bom_id = v_bom_id
      order by bi.sort_order, bi.id
    loop
      -- ─── Apply modifier scale nếu BOM item có modifier_scale_target ───
      v_modifier_scale := 1;
      if v_item.modifier_scale_target is not null
         and p_modifier_selections is not null
         and jsonb_typeof(p_modifier_selections) = 'array' then
        -- Tìm chọn lựa modifier cho target group này
        for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
          if (v_sel->>'groupId')::uuid = v_item.modifier_scale_target then
            -- Lấy option đầu tiên có scaleFactor (single rule).
            -- Nếu multi rule → take min scale (chấp nhận giảm tồn ít hơn).
            for v_opt in select * from jsonb_array_elements(v_sel->'options') loop
              if v_opt->>'scaleFactor' is not null
                 and v_opt->>'scaleFactor' <> 'null' then
                v_modifier_scale := least(
                  v_modifier_scale,
                  coalesce((v_opt->>'scaleFactor')::numeric, 1)
                );
              end if;
            end loop;
            exit;
          end if;
        end loop;
      end if;

      -- consume_qty = quantity × (1 + waste/100) × p_qty × modifier_scale
      v_consume_qty := round(
        (v_item.quantity * (1 + v_item.waste_percent / 100) * p_qty * v_modifier_scale)::numeric,
        4
      );

      if v_consume_qty <= 0 then
        continue;  -- modifier scale = 0 (vd Không đường) → skip NVL
      end if;

      -- Check stock NVL available
      select coalesce(sum(quantity), 0) into v_available
      from public.branch_stock
      where product_id = v_item.material_id
        and branch_id = p_branch_id
        and variant_id is null;

      if v_available < v_consume_qty then
        if not v_allow_negative then
          raise exception 'NVL_INSUFFICIENT: NVL "%" tại chi nhánh thiếu — còn %, cần % (cho %s × %s)',
            coalesce(v_item.material_name, v_item.material_code, v_item.material_id::text),
            v_available, v_consume_qty,
            p_qty, coalesce(v_bom.name, 'BOM');
        else
          v_warnings := v_warnings || jsonb_build_object(
            'material_id', v_item.material_id,
            'material_code', v_item.material_code,
            'material_name', v_item.material_name,
            'available', v_available,
            'required', v_consume_qty,
            'modifier_scale', v_modifier_scale,
            'reason', format(
              'NVL "%s" còn %s nhưng cần %s — tồn kho sẽ âm',
              coalesce(v_item.material_name, v_item.material_code), v_available, v_consume_qty
            )
          );
        end if;
      end if;

      perform public.upsert_branch_stock(
        p_tenant_id, p_branch_id, v_item.material_id, -v_consume_qty
      );

      insert into public.stock_movements (
        tenant_id, branch_id, product_id, type, quantity,
        reference_type, reference_id, note, created_by
      ) values (
        p_tenant_id, p_branch_id, v_item.material_id, 'out', v_consume_qty,
        'bom_consume', p_invoice_id,
        v_note || format(' [%s × %s × scale %s]',
          p_qty, coalesce(v_item.material_name, 'NVL'), v_modifier_scale),
        p_created_by
      );

      v_consumed := v_consumed || jsonb_build_object(
        'material_id', v_item.material_id,
        'material_code', v_item.material_code,
        'material_name', v_item.material_name,
        'qty', v_consume_qty,
        'unit', v_item.unit,
        'modifier_scale', v_modifier_scale
      );
    end loop;
  else
    -- SKU chưa setup BOM → vẫn return success, chỉ warning
    v_warnings := v_warnings || jsonb_build_object(
      'reason', 'SKU chưa có BOM — không trừ NVL gốc. Vẫn xử lý topping NVL nếu có.'
    );
  end if;

  -- ─── 4. Trừ tồn topping NVL theo linkedProductId (CEO 01/06/2026) ───
  -- Modifier option có linkedProductId (vd Trân châu đen → NVL-TPV-001) →
  -- POS trừ 1 đơn vị NVL topping × p_qty (số ly có chọn topping này).
  if p_modifier_selections is not null
     and jsonb_typeof(p_modifier_selections) = 'array' then
    for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
      for v_opt in select * from jsonb_array_elements(v_sel->'options') loop
        if v_opt->>'linkedProductId' is not null
           and v_opt->>'linkedProductId' <> ''
           and v_opt->>'linkedProductId' <> 'null' then
          v_linked_id := (v_opt->>'linkedProductId')::uuid;
          v_topping_name := coalesce(v_opt->>'label', 'Topping');
          -- 1 ly = 1 đơn vị NVL topping. Nhân với p_qty (số ly).
          v_topping_qty := p_qty;

          -- Check stock
          select coalesce(sum(quantity), 0) into v_available
          from public.branch_stock
          where product_id = v_linked_id
            and branch_id = p_branch_id
            and variant_id is null;

          if v_available < v_topping_qty then
            if not v_allow_negative then
              raise exception 'NVL_INSUFFICIENT: Topping "%" tại chi nhánh thiếu — còn %, cần %',
                v_topping_name, v_available, v_topping_qty;
            else
              v_warnings := v_warnings || jsonb_build_object(
                'material_id', v_linked_id,
                'material_name', v_topping_name,
                'available', v_available,
                'required', v_topping_qty,
                'reason', format('Topping NVL "%s" còn %s nhưng cần %s', v_topping_name, v_available, v_topping_qty)
              );
            end if;
          end if;

          perform public.upsert_branch_stock(
            p_tenant_id, p_branch_id, v_linked_id, -v_topping_qty
          );

          insert into public.stock_movements (
            tenant_id, branch_id, product_id, type, quantity,
            reference_type, reference_id, note, created_by
          ) values (
            p_tenant_id, p_branch_id, v_linked_id, 'out', v_topping_qty,
            'modifier_topping', p_invoice_id,
            format('Topping %s × %s — HĐ %s', v_topping_name, v_topping_qty,
              coalesce(p_invoice_code, p_invoice_id::text)),
            p_created_by
          );

          v_consumed := v_consumed || jsonb_build_object(
            'material_id', v_linked_id,
            'material_name', v_topping_name,
            'qty', v_topping_qty,
            'kind', 'modifier_topping'
          );
        end if;
      end loop;
    end loop;
  end if;

  return jsonb_build_object(
    'success', true,
    'bom_id', v_bom_id,
    'bom_name', coalesce(v_bom.name, null),
    'consumed', v_consumed,
    'warnings', v_warnings,
    'allow_negative', v_allow_negative
  );
end;
$$;

grant execute on function public.consume_bom_for_sale(uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb) to authenticated;

comment on function public.consume_bom_for_sale is
  'v3 (CEO 01/06/2026): consume BOM + apply modifier scale + trừ topping NVL. Backward compat 100%.';

-- ────────────────────────────────────────────────────────────
-- 4. UPDATE fnb_complete_payment_atomic — pass modifier_selections
-- ────────────────────────────────────────────────────────────
create or replace function public.fnb_complete_payment_atomic(
  p_kitchen_order_id uuid,
  p_customer_id uuid,
  p_customer_name text,
  p_payment_method text,
  p_payment_breakdown jsonb,
  p_paid numeric,
  p_discount_amount numeric,
  p_note text,
  p_created_by uuid,
  p_shift_id uuid default null,
  p_tip_amount numeric default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_invoice_code text;
  v_items_subtotal numeric := 0;
  v_total_discount numeric;
  v_delivery_fee numeric;
  v_tip numeric;
  v_commission_percent numeric;
  v_commission_amount numeric;
  v_total numeric;
  v_total_gross numeric;
  v_tax_total numeric := 0;
  v_cash_code text;
  v_customer_name text;
  v_note text;
  v_actual_paid numeric;
  r record;
  t jsonb;
  v_vat_rate numeric;
  v_vat_amt numeric;
  v_line_before_tax numeric;
  v_topping_qty numeric;
  v_topping_price numeric;
  v_topping_product_id uuid;
  v_topping_name text;
  v_topping_total numeric;
  v_breakdown_item jsonb;
  v_method text;
  v_amount numeric;
  v_method_label text;
  v_payment_method_effective text;
  v_has_bom boolean;
  v_bom_result jsonb;
  v_bom_results jsonb := '[]'::jsonb;
begin
  -- 1. Load + validate kitchen order
  select * into v_order from public.kitchen_orders where id = p_kitchen_order_id;
  if not found then
    raise exception 'Kitchen order % not found', p_kitchen_order_id;
  end if;
  if v_order.status = 'completed' then
    raise exception 'Kitchen order % already paid (invoice_id=%)', p_kitchen_order_id, v_order.invoice_id;
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'Kitchen order % was cancelled — cannot pay', p_kitchen_order_id;
  end if;

  v_tenant_id := v_order.tenant_id;
  v_branch_id := v_order.branch_id;
  v_delivery_fee := coalesce(v_order.delivery_fee, 0);
  v_tip := greatest(0, coalesce(p_tip_amount, 0));
  v_commission_percent := coalesce(v_order.platform_commission_percent, 0);
  v_customer_name := coalesce(nullif(p_customer_name, ''), 'Khách lẻ');
  v_note := coalesce(p_note, 'F&B - ' || v_order.order_number);

  -- Shift guard
  if p_shift_id is not null then
    if not exists (
      select 1 from public.shifts
      where id = p_shift_id and status = 'open' and branch_id = v_branch_id
    ) then
      raise exception 'Ca % không tồn tại hoặc đã đóng', p_shift_id;
    end if;
  end if;

  -- 2. Invoice code
  v_invoice_code := public.next_code(v_tenant_id, 'invoice');
  if v_invoice_code is null or v_invoice_code = '' then
    v_invoice_code := 'HD' || extract(epoch from now())::bigint::text;
  end if;

  -- 3. Tính subtotal + tax (items + toppings) — KHÔNG đổi từ v5
  for r in
    select product_id, product_name, variant_label, quantity, unit_price, toppings
    from public.kitchen_order_items where kitchen_order_id = p_kitchen_order_id
  loop
    v_line_before_tax := r.quantity * r.unit_price;
    select coalesce(vat_rate, 0) into v_vat_rate from public.products where id = r.product_id;
    v_vat_rate := coalesce(v_vat_rate, 0);
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);
    v_items_subtotal := v_items_subtotal + v_line_before_tax;
    v_tax_total := v_tax_total + v_vat_amt;

    if r.toppings is not null then
      for t in select * from jsonb_array_elements(r.toppings) loop
        v_topping_qty := coalesce((t->>'quantity')::numeric, 0);
        if v_topping_qty > 0 then
          v_topping_price := coalesce((t->>'price')::numeric, 0);
          v_items_subtotal := v_items_subtotal + (v_topping_qty * v_topping_price * r.quantity);
        end if;
      end loop;
    end if;
  end loop;

  v_total_discount := coalesce(v_order.discount_amount, 0) + coalesce(p_discount_amount, 0);

  -- 4. Tổng gross + commission + thực thu
  v_total_gross := v_items_subtotal - v_total_discount + v_delivery_fee + v_tip;
  v_commission_amount := round(v_total_gross * v_commission_percent / 100);
  v_total := v_total_gross - v_commission_amount;
  if v_total < 0 then v_total := 0; end if;

  if v_commission_amount > 0 then
    v_actual_paid := v_total;
    v_payment_method_effective := 'transfer';
  else
    v_actual_paid := p_paid;
    v_payment_method_effective := p_payment_method;
  end if;

  -- 5. Insert invoice
  insert into public.invoices (
    tenant_id, branch_id, code, customer_id, customer_name, status,
    subtotal, discount_amount, tax_amount, total, paid, debt,
    delivery_fee, platform_commission, platform_commission_percent,
    payment_method, source, note, created_by, shift_id, tip_amount
  ) values (
    v_tenant_id, v_branch_id, v_invoice_code, p_customer_id, v_customer_name, 'completed',
    v_items_subtotal, v_total_discount, v_tax_total, v_total, v_actual_paid,
    greatest(0, v_total - v_actual_paid),
    v_delivery_fee, v_commission_amount, v_commission_percent,
    v_payment_method_effective, 'fnb', v_note, p_created_by, p_shift_id, v_tip
  ) returning id into v_invoice_id;

  update public.kitchen_orders
  set platform_commission_amount = v_commission_amount
  where id = p_kitchen_order_id;

  -- 6. Insert invoice_items + trừ tồn (theo has_bom) + BOM consume với modifier
  for r in
    select product_id, product_name, variant_label, quantity, unit_price, toppings,
           modifier_selections  -- CEO 01/06/2026 — Sprint 2.3b
    from public.kitchen_order_items where kitchen_order_id = p_kitchen_order_id
  loop
    v_line_before_tax := r.quantity * r.unit_price;
    select coalesce(vat_rate, 0) into v_vat_rate from public.products where id = r.product_id;
    v_vat_rate := coalesce(v_vat_rate, 0);
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);

    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit,
      quantity, unit_price, discount, vat_rate, vat_amount, total
    ) values (
      v_invoice_id, r.product_id,
      case when r.variant_label is not null and r.variant_label <> ''
           then r.product_name || ' (' || r.variant_label || ')'
           else r.product_name end,
      'Cái', r.quantity, r.unit_price, 0, v_vat_rate, v_vat_amt, v_line_before_tax
    );

    select coalesce(has_bom, false) into v_has_bom
    from public.products where id = r.product_id;

    if v_has_bom then
      -- CEO 01/06/2026 — Sprint 2.3b: pass modifier_selections → scale BOM + trừ topping NVL
      v_bom_result := public.consume_bom_for_sale(
        v_tenant_id, v_branch_id, r.product_id, r.quantity, v_invoice_id, p_created_by, v_invoice_code,
        r.modifier_selections
      );
      v_bom_results := v_bom_results || jsonb_build_object(
        'product_id', r.product_id,
        'product_name', r.product_name,
        'sale_qty', r.quantity,
        'result', v_bom_result
      );
    else
      insert into public.stock_movements (
        tenant_id, branch_id, product_id, type, quantity,
        reference_type, reference_id, note, created_by
      ) values (
        v_tenant_id, v_branch_id, r.product_id, 'out', r.quantity,
        'invoice', v_invoice_id,
        'F&B bán hàng - ' || v_invoice_code, p_created_by
      );

      perform public.increment_product_stock(r.product_id, -r.quantity);
      perform public.upsert_branch_stock(v_tenant_id, v_branch_id, r.product_id, -r.quantity);

      begin
        perform public.allocate_lots_fifo(v_tenant_id, r.product_id, v_branch_id, r.quantity, 'invoice', v_invoice_id);
      exception when others then null;
      end;

      -- SP không có BOM nhưng có modifier_selections → vẫn trừ topping NVL
      -- (vd món bánh không có BOM nhưng có topping NVL được chọn).
      if r.modifier_selections is not null and jsonb_typeof(r.modifier_selections) = 'array' then
        -- Gọi consume_bom_for_sale với p_sku_id = product_id, p_qty = r.quantity.
        -- Function sẽ skip BOM consume (vì không có BOM) + chỉ trừ topping NVL.
        v_bom_result := public.consume_bom_for_sale(
          v_tenant_id, v_branch_id, r.product_id, r.quantity, v_invoice_id, p_created_by, v_invoice_code,
          r.modifier_selections
        );
        v_bom_results := v_bom_results || jsonb_build_object(
          'product_id', r.product_id,
          'product_name', r.product_name,
          'sale_qty', r.quantity,
          'topping_only', true,
          'result', v_bom_result
        );
      end if;
    end if;

    -- Topping cũ (FnbCartTopping qua toppings JSONB) — giữ logic v5
    if r.toppings is not null then
      for t in select * from jsonb_array_elements(r.toppings) loop
        v_topping_qty := coalesce((t->>'quantity')::numeric, 0);
        if v_topping_qty > 0 then
          v_topping_product_id := nullif(t->>'product_id', '')::uuid;
          if v_topping_product_id is not null then
            v_topping_name := coalesce(t->>'name', 'Topping');
            v_topping_price := coalesce((t->>'price')::numeric, 0);
            v_topping_total := v_topping_qty * v_topping_price * r.quantity;

            select coalesce(has_bom, false) into v_has_bom
            from public.products where id = v_topping_product_id;

            if v_has_bom then
              v_bom_result := public.consume_bom_for_sale(
                v_tenant_id, v_branch_id, v_topping_product_id, v_topping_qty * r.quantity,
                v_invoice_id, p_created_by, v_invoice_code,
                null  -- topping cũ không có modifier riêng
              );
              v_bom_results := v_bom_results || jsonb_build_object(
                'product_id', v_topping_product_id,
                'product_name', v_topping_name,
                'sale_qty', v_topping_qty * r.quantity,
                'topping', true,
                'result', v_bom_result
              );
            else
              insert into public.stock_movements (
                tenant_id, branch_id, product_id, type, quantity,
                reference_type, reference_id, note, created_by
              ) values (
                v_tenant_id, v_branch_id, v_topping_product_id, 'out',
                v_topping_qty * r.quantity, 'invoice', v_invoice_id,
                'Topping ' || v_topping_name || ' - ' || v_invoice_code, p_created_by
              );

              perform public.increment_product_stock(v_topping_product_id, -(v_topping_qty * r.quantity));
              perform public.upsert_branch_stock(v_tenant_id, v_branch_id, v_topping_product_id, -(v_topping_qty * r.quantity));

              begin
                perform public.allocate_lots_fifo(v_tenant_id, v_topping_product_id, v_branch_id, v_topping_qty * r.quantity, 'invoice', v_invoice_id);
              exception when others then null;
              end;
            end if;
          end if;
        end if;
      end loop;
    end if;
  end loop;

  -- 7. Cash transactions (KHÔNG đổi từ v5)
  if v_actual_paid > 0 then
    if p_payment_method = 'mixed'
       and p_payment_breakdown is not null
       and jsonb_typeof(p_payment_breakdown) = 'array'
       and jsonb_array_length(p_payment_breakdown) > 0
       and v_commission_amount = 0
    then
      for v_breakdown_item in select * from jsonb_array_elements(p_payment_breakdown) loop
        v_amount := coalesce((v_breakdown_item->>'amount')::numeric, 0);
        v_method := v_breakdown_item->>'method';
        if v_amount > 0 and v_method in ('cash', 'transfer', 'card') then
          v_cash_code := public.next_code(v_tenant_id, 'cash_receipt');
          if v_cash_code is null or v_cash_code = '' then
            v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
          end if;
          v_method_label := case v_method
            when 'cash' then 'tiền mặt'
            when 'transfer' then 'chuyển khoản'
            when 'card' then 'thẻ' else v_method end;
          insert into public.cash_transactions (
            tenant_id, branch_id, code, type, category, amount,
            counterparty, payment_method,
            reference_type, reference_id, note, created_by, shift_id
          ) values (
            v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'Bán hàng', v_amount,
            v_customer_name, v_method,
            'invoice', v_invoice_id,
            'Thu tiền HĐ ' || v_invoice_code || ' (' || v_method_label || ')',
            p_created_by, p_shift_id
          );
        end if;
      end loop;
    else
      v_cash_code := public.next_code(v_tenant_id, 'cash_receipt');
      if v_cash_code is null or v_cash_code = '' then
        v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
      end if;
      insert into public.cash_transactions (
        tenant_id, branch_id, code, type, category, amount,
        counterparty, payment_method,
        reference_type, reference_id, note, created_by, shift_id
      ) values (
        v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'Bán hàng',
        v_actual_paid, v_customer_name,
        case
          when v_commission_amount > 0 then 'transfer'
          when p_payment_method = 'mixed' then 'cash'
          else p_payment_method
        end,
        'invoice', v_invoice_id,
        case
          when v_commission_amount > 0
          then 'Thu thực HĐ ' || v_invoice_code
               || ' (gross ' || v_total_gross::text
               || ' - phí sàn ' || v_commission_amount::text || ')'
          else 'Thu tiền HĐ ' || v_invoice_code
        end,
        p_created_by, p_shift_id
      );
    end if;
  end if;

  -- 8. Close kitchen order + release table
  update public.kitchen_orders
  set status = 'completed', invoice_id = v_invoice_id, updated_at = now()
  where id = p_kitchen_order_id;

  if v_order.table_id is not null then
    update public.restaurant_tables
    set status = 'available', current_order_id = null, updated_at = now()
    where id = v_order.table_id;
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_code', v_invoice_code,
    'total', v_total,
    'paid', v_actual_paid,
    'debt', greatest(0, v_total - v_actual_paid),
    'bom_consume_results', v_bom_results
  );
end;
$$;

comment on function public.fnb_complete_payment_atomic is
  'v6 (CEO 01/06/2026): pass modifier_selections vào consume_bom_for_sale để scale BOM + trừ topping NVL.';

notify pgrst, 'reload schema';
