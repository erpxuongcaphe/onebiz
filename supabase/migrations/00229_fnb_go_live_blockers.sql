-- ============================================================
-- 00229 — Ba lỗi chặn ngày mở quán F&B
-- ============================================================
-- Rà lại 5 cáo buộc trong báo cáo audit, xác minh bằng code + schema:
--   ✅ ĐÚNG  Thu tiền trước là món BIẾN MẤT khỏi màn bếp
--   ✅ ĐÚNG  Hai tablet bấm Thanh toán cùng nhịp có thể thu hai lần
--   ✅ ĐÚNG  Món cùng tên khác size không lưu được công thức thứ hai
--   ❌ SAI   "Gửi bếp xong không thanh toán được" — vẫn thanh toán bình thường
--   ⚠️ KHÁC  "Thêm món sau gửi bếp thu thừa" — giỏ ĐƯỢC dọn sau khi gửi, lỗi
--            thật là bấm thẳng Thanh toán thì món mới trong giỏ không được
--            gửi bếp → sửa ở tầng ứng dụng, không phải ở đây.
--
-- File này vá 3 cái ĐÚNG. Không đụng một dòng dữ liệu nào.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1) Công thức theo SIZE: mỗi (món × chi nhánh × size) một công thức
-- ────────────────────────────────────────────────────────────
-- Khoá cũ (00106) chỉ tính (đơn vị, món, chi nhánh) — thiếu size. Món "Cà phê
-- sữa" lưu công thức size M xong, lưu tiếp size L là dính trùng khoá, không
-- lưu được. Màn nhập công thức theo size lưu kèm variant_id nên chỉ cần đưa
-- size vào khoá là xong.
--
-- Prod hiện chưa có công thức F&B nào nên đổi khoá không đụng dữ liệu cũ;
-- BOM Retail (variant_id NULL) vẫn giữ nguyên ràng buộc như trước nhờ coalesce.
drop index if exists public.idx_bom_product_branch_unique;

create unique index if not exists idx_bom_product_branch_variant_unique
  on public.bom (
    tenant_id,
    product_id,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where is_active = true and product_id is not null;

comment on index public.idx_bom_product_branch_variant_unique is
  'Mỗi món × chi nhánh × size có tối đa 1 công thức đang dùng (00229 — thêm size vào khoá).';

-- ────────────────────────────────────────────────────────────
-- 2+3) Hàm thanh toán F&B: khoá chống thu hai lần + không đá món khỏi bếp
--      (bản sống 00166, sửa đúng 2 chỗ — xem chú thích trong hàm)
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
  v_should_cascade boolean;
  v_bom_result jsonb;
  v_bom_results jsonb := '[]'::jsonb;
  v_role text;  -- 00166 (Cách B): vai trò tồn kho của sản phẩm (fnb_menu_item?)
begin
  -- 1. Load + validate kitchen order
  -- 00229: FOR UPDATE khoá dòng đơn bếp tới hết giao dịch. Trước đây hai
  -- tablet bấm Thanh toán cùng nhịp đều đọc thấy invoice_id còn trống rồi
  -- cùng đi tiếp → thu tiền hai lần. Máy thứ hai giờ phải xếp hàng đợi,
  -- đọc lại thấy đã có hoá đơn nên dừng ở guard bên dưới.
  select * into v_order from public.kitchen_orders where id = p_kitchen_order_id for update;
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

  -- 00229: TIỀN và BẾP là hai việc khác nhau.
  -- Trước đây thu tiền là ép status='completed', mà màn bếp chỉ hiện
  -- pending/preparing/ready → khách trả tiền trước (rất phổ biến ở quán cà
  -- phê) là món BIẾN MẤT khỏi màn bếp, không ai pha.
  -- Giờ: chỉ gắn hoá đơn. Bếp đang dở thì giữ nguyên tiến độ để tiếp tục
  -- làm; chỉ đơn đã phục vụ xong (served) mới đóng lại.
  update public.kitchen_orders
  set status = case when v_order.status = 'served' then 'completed' else v_order.status end,
      invoice_id = v_invoice_id,
      updated_at = now()
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
-- ============================================================
-- VERIFY — chạy sau khi áp
-- ============================================================
-- 1) Khoá công thức đã có size (phải ra 1 dòng):
-- select indexname from pg_indexes
-- where tablename = 'bom' and indexname = 'idx_bom_product_branch_variant_unique';
--
-- 2) Hàm thanh toán đã khoá đơn + không ép đóng bếp (cả 2 phải true):
-- select pg_get_functiondef('public.fnb_complete_payment_atomic'::regproc) like '%for update%' as co_khoa,
--        pg_get_functiondef('public.fnb_complete_payment_atomic'::regproc) like '%when v_order.status = ''served''%' as giu_tien_do_bep;
