-- ============================================================
-- 00166 — Cách B (khóa cứng ở tầng THANH TOÁN + TỒN THỦ CÔNG): món F&B
--         (inventory_role='fnb_menu_item') KHÔNG BAO GIỜ giữ tồn trực tiếp
-- ============================================================
-- CEO 07/07/2026 — nền mã hàng Cách B. Món menu F&B (inventory_role='fnb_menu_item')
-- không giữ tồn: bán/hoàn đều đi qua công thức (BOM) hoặc đảo theo sổ cái
-- stock_movements — KHÔNG cộng/trừ thẳng tồn mã món. 00165 đã lo phần should_cascade
-- (món menu cascade công thức chung ở quán) + hủy bill hồi theo sổ cái. 00166 khóa
-- nốt 3 đường còn hở:
--
--   VIỆC 1) fnb_complete_payment_atomic v10: trong RPC bán F&B, món fnb_menu_item
--           LUÔN trừ theo công thức (BOM chung/riêng), KHÔNG BAO GIỜ rơi vào nhánh
--           "trừ tồn thẳng mã món". Thiếu công thức hợp lệ → CHẶN thanh toán
--           (raise MENU_NO_RECIPE), không đẻ tồn ảo âm cho mã món. Giữ NGUYÊN VĂN
--           2 nhánh cũ (SKU cascade / SKU không BOM trừ tồn chính nó) — SKU Retail
--           bán takeaway tại quán vẫn trừ tồn thật của nó (ĐÚNG).
--
--   VIỆC 2) apply_manual_stock_movement_atomic: chặn mọi tác động tồn TRỰC TIẾP
--           (nhập/xuất/điều chỉnh, và kiểm kho đi qua RPC này) lên mã fnb_menu_item.
--           Escape có chủ đích cho đảo lỗi legacy: "allow_menu": true trong item JSON.
--
--   VIỆC 3) get_stockout_forecast: bỏ món fnb_menu_item khỏi dự báo hết hàng (món
--           không giữ tồn nên tồn=0/ảo, không có ý nghĩa cảnh báo bổ sung).
--
-- AN TOÀN: latent trên data hiện tại (0 hóa đơn F&B, 2 mã fnb_menu_item là mã test).
-- Mọi hàm tái tạo NGUYÊN VĂN bản mới nhất (00148 v9 / 00056 / 00058), chỉ chèn đúng
-- phần khóa nêu trên. KHÔNG đổi signature (tránh tạo overload mới).
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- VIỆC 1 — fnb_complete_payment_atomic v10 (tái tạo 00148 v9, chỉ đổi nhánh dispatch)
-- ────────────────────────────────────────────────────────────────
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
  v_should_cascade boolean;
  v_bom_result jsonb;
  v_bom_results jsonb := '[]'::jsonb;
  v_role text;  -- 00166 (Cách B): vai trò tồn kho của sản phẩm (fnb_menu_item?)
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

  if p_shift_id is not null then
    if not exists (
      select 1 from public.shifts
      where id = p_shift_id and status = 'open' and branch_id = v_branch_id
    ) then
      raise exception 'Ca % không tồn tại hoặc đã đóng', p_shift_id;
    end if;
  end if;

  v_invoice_code := public.next_code(v_tenant_id, 'invoice');
  if v_invoice_code is null or v_invoice_code = '' then
    v_invoice_code := 'HD' || extract(epoch from now())::bigint::text;
  end if;

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

  -- 6. Insert invoice_items + trừ tồn (theo has_bom + cascade_mode + modifier)
  for r in
    select product_id, variant_id, product_name, variant_label, quantity, unit_price, toppings,
           modifier_selections
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

    select coalesce(has_bom, false), inventory_role into v_has_bom, v_role
    from public.products where id = r.product_id;

    -- CEO 07/07/2026 (Cách B): MÓN MENU F&B (fnb_menu_item) KHÔNG giữ tồn — LUÔN trừ
    -- theo công thức (BOM chung/riêng); KHÔNG BAO GIỜ trừ tồn thẳng mã món. Thiếu công
    -- thức hợp lệ → CHẶN thanh toán (raise), không đẻ tồn ảo âm cho mã món.
    if v_role = 'fnb_menu_item' then
      v_should_cascade := public.should_cascade_bom_at_branch(r.product_id, v_branch_id);
      if not v_should_cascade then
        raise exception 'MENU_NO_RECIPE: Món "%" chưa có công thức (BOM) nên không thể thanh toán. Vào Hàng hóa → Công thức để thiết lập.', r.product_name
          using errcode = 'P0001';
      end if;
      v_bom_result := public.consume_bom_for_sale(
        v_tenant_id, v_branch_id, r.product_id, r.quantity, v_invoice_id, p_created_by, v_invoice_code,
        r.modifier_selections, false, r.variant_id
      );
      v_bom_results := v_bom_results || jsonb_build_object(
        'product_id', r.product_id, 'product_name', r.product_name, 'sale_qty', r.quantity,
        'cascade', true, 'role', 'fnb_menu_item', 'result', v_bom_result
      );
    elsif v_has_bom then
      v_should_cascade := public.should_cascade_bom_at_branch(r.product_id, v_branch_id);

      if v_should_cascade then
        -- Cascade BOM bình thường (production hoặc outlet+BOM branch-specific)
        v_bom_result := public.consume_bom_for_sale(
          v_tenant_id, v_branch_id, r.product_id, r.quantity, v_invoice_id, p_created_by, v_invoice_code,
          r.modifier_selections,
          false,  -- không skip BOM
          r.variant_id  -- CONG THUC THEO SIZE: BOM cua variant neu co
        );
        v_bom_results := v_bom_results || jsonb_build_object(
          'product_id', r.product_id,
          'product_name', r.product_name,
          'sale_qty', r.quantity,
          'cascade', true,
          'result', v_bom_result
        );
      else
        -- Outlet branch + BOM global only → trừ tồn SKU trực tiếp
        insert into public.stock_movements (
          tenant_id, branch_id, product_id, type, quantity,
          reference_type, reference_id, note, created_by
        ) values (
          v_tenant_id, v_branch_id, r.product_id, 'out', r.quantity,
          'invoice', v_invoice_id,
          'F&B bán hàng (outlet, không cascade) - ' || v_invoice_code, p_created_by
        );

        perform public.increment_product_stock(r.product_id, -r.quantity);
        perform public.upsert_branch_stock(v_tenant_id, v_branch_id, r.product_id, -r.quantity);

        begin
          perform public.allocate_lots_fifo(v_tenant_id, r.product_id, v_branch_id, r.quantity, 'invoice', v_invoice_id);
        exception when others then null;
        end;

        v_bom_results := v_bom_results || jsonb_build_object(
          'product_id', r.product_id,
          'product_name', r.product_name,
          'sale_qty', r.quantity,
          'cascade', false,
          'reason', 'outlet_no_branch_bom'
        );

        -- CEO 03/06/2026 HOTFIX P0: SP không cascade nhưng có modifier_selections
        -- → CHỈ trừ topping NVL, KHÔNG cascade BOM (skip_bom_consume=true).
        -- Trước hotfix: không pass param → consume_bom_for_sale fallback dùng
        -- BOM global → DOUBLE trừ NVL gốc.
        if r.modifier_selections is not null and jsonb_typeof(r.modifier_selections) = 'array' then
          v_bom_result := public.consume_bom_for_sale(
            v_tenant_id, v_branch_id, r.product_id, r.quantity, v_invoice_id, p_created_by, v_invoice_code,
            r.modifier_selections,
            true  -- SKIP BOM consume — chỉ làm topping NVL
          );
          v_bom_results := v_bom_results || jsonb_build_object(
            'product_id', r.product_id,
            'product_name', r.product_name,
            'modifier_only', true,
            'result', v_bom_result
          );
        end if;
      end if;
    else
      -- SP không BOM: trừ tồn chính nó
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

      -- SP không BOM nhưng có modifier → chỉ topping NVL (skip BOM)
      if r.modifier_selections is not null and jsonb_typeof(r.modifier_selections) = 'array' then
        v_bom_result := public.consume_bom_for_sale(
          v_tenant_id, v_branch_id, r.product_id, r.quantity, v_invoice_id, p_created_by, v_invoice_code,
          r.modifier_selections,
          true  -- SKIP BOM (SP không có BOM nên không cần, nhưng pass true cho safety)
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

    -- Topping cũ (FnbCartTopping JSONB) — giữ logic v7
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
              v_should_cascade := public.should_cascade_bom_at_branch(v_topping_product_id, v_branch_id);
              if v_should_cascade then
                v_bom_result := public.consume_bom_for_sale(
                  v_tenant_id, v_branch_id, v_topping_product_id, v_topping_qty * r.quantity,
                  v_invoice_id, p_created_by, v_invoice_code, null, false
                );
                v_bom_results := v_bom_results || jsonb_build_object(
                  'product_id', v_topping_product_id,
                  'product_name', v_topping_name,
                  'sale_qty', v_topping_qty * r.quantity,
                  'topping', true,
                  'cascade', true,
                  'result', v_bom_result
                );
              else
                insert into public.stock_movements (
                  tenant_id, branch_id, product_id, type, quantity,
                  reference_type, reference_id, note, created_by
                ) values (
                  v_tenant_id, v_branch_id, v_topping_product_id, 'out',
                  v_topping_qty * r.quantity, 'invoice', v_invoice_id,
                  'Topping ' || v_topping_name || ' (outlet, không cascade) - ' || v_invoice_code, p_created_by
                );
                perform public.increment_product_stock(v_topping_product_id, -(v_topping_qty * r.quantity));
                perform public.upsert_branch_stock(v_tenant_id, v_branch_id, v_topping_product_id, -(v_topping_qty * r.quantity));
                begin
                  perform public.allocate_lots_fifo(v_tenant_id, v_topping_product_id, v_branch_id, v_topping_qty * r.quantity, 'invoice', v_invoice_id);
                exception when others then null;
                end;
              end if;
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

  -- 7. Cash transactions (giữ logic v7)
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
  'FnB payment v10 (00166, Cách B): món fnb_menu_item luôn cascade công thức, thiếu BOM → raise MENU_NO_RECIPE (không trừ tồn thẳng mã món). Giữ nguyên v9.';

-- ────────────────────────────────────────────────────────────────
-- VIỆC 2 — apply_manual_stock_movement_atomic (tái tạo 00056, thêm guard fnb_menu_item)
-- ────────────────────────────────────────────────────────────────
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
  v_role text;  -- 00166 (Cách B): chặn tác động tồn trực tiếp lên fnb_menu_item
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

    -- CEO 07/07/2026 (Cách B): CHẶN tác động tồn TRỰC TIẾP lên món F&B (fnb_menu_item).
    -- Món menu không giữ tồn → nhập/xuất/điều chỉnh/kiểm kho không được đụng mã món.
    -- Escape có chủ đích cho đảo lỗi legacy: đặt "allow_menu": true trong item JSON.
    if coalesce((v_item->>'allow_menu')::boolean, false) is not true then
      select inventory_role into v_role from public.products where id = v_product_id;
      if v_role = 'fnb_menu_item' then
        raise exception 'MENU_NO_DIRECT_STOCK: Món F&B không giữ tồn trực tiếp (sản phẩm %). Tồn của món đi qua công thức, không nhập/xuất/kiểm kho thẳng.', v_product_id
          using errcode = 'P0001';
      end if;
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
  'Atomic stock movement batch: inserts stock_movements and updates product/branch snapshots in one transaction. + 00166: chặn fnb_menu_item (escape allow_menu).';

grant execute on function public.apply_manual_stock_movement_atomic(uuid, uuid, uuid, jsonb)
  to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────
-- VIỆC 3 — get_stockout_forecast (tái tạo 00058, lọc bỏ fnb_menu_item khỏi CTE tồn)
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_stockout_forecast(
  p_tenant_id uuid,
  p_branch_id uuid default null,
  p_days integer default 30,
  p_limit integer default 8,
  p_product_type text default 'sku'
)
returns table (
  product_id uuid,
  product_code text,
  product_name text,
  unit text,
  stock numeric,
  min_stock numeric,
  avg_daily_out numeric,
  avg_daily_in numeric,
  total_out numeric,
  total_in numeric,
  days_until_stockout integer,
  forecast_date date
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_days integer := greatest(7, coalesce(p_days, 30));
begin
  return query
  with stock as (
    select
      bs.product_id,
      max(p.code)::text as product_code,
      max(p.name)::text as product_name,
      max(p.unit)::text as unit,
      sum(coalesce(bs.quantity, 0))::numeric as stock,
      max(coalesce(p.min_stock, 0))::numeric as min_stock
    from public.branch_stock bs
    join public.products p
      on p.id = bs.product_id
     and p.tenant_id = bs.tenant_id
    where bs.tenant_id = p_tenant_id
      and (p_branch_id is null or bs.branch_id = p_branch_id)
      and p.is_active is true
      and (p_product_type is null or p.product_type = p_product_type)
      and p.inventory_role <> 'fnb_menu_item'  -- 00166 (Cách B): món F&B không giữ tồn → bỏ khỏi dự báo
    group by bs.product_id
  ),
  movement as (
    select
      sm.product_id,
      sum(
        case
          when sm.type = 'out'
           and (
             p_branch_id is not null
             or lower(coalesce(sm.reference_type, '')) not like '%transfer%'
           )
          then abs(coalesce(sm.quantity, 0))
          else 0
        end
      )::numeric as total_out,
      sum(
        case
          when sm.type = 'in'
           and (
             p_branch_id is not null
             or sm.reference_type is null
             or lower(sm.reference_type) like '%purchase%'
             or lower(sm.reference_type) like '%goods_receipt%'
             or lower(sm.reference_type) like '%nhap_hang%'
           )
          then abs(coalesce(sm.quantity, 0))
          else 0
        end
      )::numeric as total_in
    from public.stock_movements sm
    where sm.tenant_id = p_tenant_id
      and sm.created_at >= now() - ((v_days::text || ' days')::interval)
      and (p_branch_id is null or sm.branch_id = p_branch_id)
    group by sm.product_id
  ),
  forecast as (
    select
      s.product_id,
      s.product_code,
      s.product_name,
      s.unit,
      s.stock,
      s.min_stock,
      coalesce(m.total_out, 0)::numeric as total_out,
      coalesce(m.total_in, 0)::numeric as total_in,
      (coalesce(m.total_out, 0) / v_days)::numeric as avg_daily_out,
      (coalesce(m.total_in, 0) / v_days)::numeric as avg_daily_in
    from stock s
    left join movement m on m.product_id = s.product_id
    where coalesce(m.total_out, 0) > 0
       or s.stock <= s.min_stock
  )
  select
    f.product_id,
    f.product_code,
    f.product_name,
    f.unit,
    f.stock,
    f.min_stock,
    f.avg_daily_out,
    f.avg_daily_in,
    f.total_out,
    f.total_in,
    case
      when f.avg_daily_out <= 0 then null
      else greatest(0, floor(f.stock / nullif(f.avg_daily_out, 0))::integer)
    end as days_until_stockout,
    case
      when f.avg_daily_out <= 0 then null
      else current_date + greatest(0, floor(f.stock / nullif(f.avg_daily_out, 0))::integer)
    end as forecast_date
  from forecast f
  order by
    case
      when f.stock <= 0 then 0
      when f.avg_daily_out > 0 and floor(f.stock / nullif(f.avg_daily_out, 0)) <= 3 then 0
      when f.avg_daily_out > 0 and floor(f.stock / nullif(f.avg_daily_out, 0)) <= 7 then 1
      when f.stock <= f.min_stock then 2
      when f.avg_daily_out > 0 and floor(f.stock / nullif(f.avg_daily_out, 0)) <= 14 then 2
      else 3
    end,
    case
      when f.avg_daily_out <= 0 then 2147483647
      else greatest(0, floor(f.stock / nullif(f.avg_daily_out, 0))::integer)
    end,
    f.total_out desc
  limit greatest(1, coalesce(p_limit, 8));
end;
$$;

grant execute on function public.get_stockout_forecast(uuid, uuid, integer, integer, text)
  to authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY sau khi áp (CEO chạy — read-only):
--
-- 1) 3 hàm còn tồn tại + comment đã cập nhật (v10 / +00166 / stockout):
--    select proname, obj_description(oid) as comment
--    from pg_proc
--    where proname in (
--      'fnb_complete_payment_atomic',
--      'apply_manual_stock_movement_atomic',
--      'get_stockout_forecast'
--    );
--
-- 2) Payment RPC v10: xác nhận nhánh dispatch mới có mặt trong định nghĩa
--    (tìm chuỗi 'MENU_NO_RECIPE' và "role', 'fnb_menu_item'"):
--    select pg_get_functiondef('public.fnb_complete_payment_atomic'::regproc) like '%MENU_NO_RECIPE%' as has_menu_guard,
--           pg_get_functiondef('public.fnb_complete_payment_atomic'::regproc) like '%fnb_menu_item%' as has_role_dispatch;
--
-- 3) Guard tồn thủ công: xác nhận có chuỗi 'MENU_NO_DIRECT_STOCK' + 'allow_menu':
--    select pg_get_functiondef('public.apply_manual_stock_movement_atomic'::regproc) like '%MENU_NO_DIRECT_STOCK%' as has_guard,
--           pg_get_functiondef('public.apply_manual_stock_movement_atomic'::regproc) like '%allow_menu%' as has_escape;
--
-- 4) Dự báo hết hàng đã loại fnb_menu_item (không có mã món trong kết quả):
--    select count(*) as menu_in_forecast
--    from public.get_stockout_forecast('148e8ac5-b891-4de3-9055-cfa41f39ddb0', null, 30, 500, null) f
--    join public.products p on p.id = f.product_id
--    where p.inventory_role = 'fnb_menu_item';
--    -- Kỳ vọng: 0.
--
-- Chưa kích hoạt trên data hiện tại (0 HĐ F&B, fnb_menu_item chỉ là mã test) —
-- khóa trước F&B go-live.
-- ============================================================
