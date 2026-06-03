-- ============================================================
-- 00123 — Branch cascade_mode: phân biệt Kho/Xưởng vs Quán
-- (CEO 03/06/2026 — Sprint 3, Phase 1)
--
-- VẤN ĐỀ G1: Internal Sale Retail → FnB hiện trừ tồn SKU trực tiếp ở
-- branch bán. Khi SKU has_bom=true (vd "Sữa đặc 1 lon" BOM = 1 lon NVL),
-- branch_stock(SKU) = 0 luôn → trừ ra số âm → tồn NVL Retail KHÔNG giảm
-- → số liệu lệch giữa tồn ngoài thực tế và tồn ghi nhận.
--
-- PATTERN ĐÚNG (CEO clarify):
--   • Kho tổng (Retail) là TRUNG TÂM phân phối: chỉ quản lý tồn NVL gốc.
--     SKU đóng gói (lon/thùng/gói) là "nhãn bán" không giữ tồn.
--     Khi bán SKU (cho khách ngoài qua POS hoặc cho FnB qua Internal Sale)
--     → cascade BOM → trừ NVL gốc.
--   • Quán FnB là OUTLET: nhận SKU đóng gói qua Internal Sale, dùng làm
--     nguyên liệu pha chế. Bán món pha chế (có BOM tham chiếu SKU) →
--     cascade BOM trừ SKU đã nhập. Bán SKU đóng gói trực tiếp (takeaway
--     lon nước…) → trừ tồn SKU trực tiếp (không cascade về NVL gốc, vì
--     NVL gốc không tồn tại ở Quán).
--
-- GIẢI PHÁP: thêm cột `branches.cascade_mode` enum:
--   • 'production' — Kho/Xưởng. Bán/xuất has_bom=true → cascade BOM (trừ
--      NVL gốc).
--   • 'outlet'     — Quán/Cửa hàng. Bán has_bom=true mà BOM tồn tại tại
--      branch (BOM branch-specific) → cascade. Còn lại trừ tồn SKU thẳng.
--
-- AUTO-MIGRATE từ branch_type hiện có:
--   • warehouse / factory  → production
--   • store / office        → outlet
-- → CEO KHÔNG phải cấu hình lại cho data cũ.
--
-- BACKWARD COMPAT:
--   • Các tenant chưa setup BOM branch-specific → outlet branch sẽ trừ
--     tồn SKU trực tiếp như trước (an toàn, không cascade làm âm NVL).
--   • Các production branch tiếp tục cascade BOM như cũ.
--   • Để outlet branch cascade BOM cho món pha chế (Bạc xỉu…) → CEO tạo
--     BOM branch-specific (đã có sẵn ở migration 00096).
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. ALTER branches: ADD cascade_mode
-- ────────────────────────────────────────────────────────────────
alter table public.branches
  add column if not exists cascade_mode text not null default 'outlet'
  check (cascade_mode in ('production', 'outlet'));

comment on column public.branches.cascade_mode is
  'CEO 03/06/2026 — Sprint 3: chế độ tồn kho. production=Kho/Xưởng (bán SKU cascade BOM trừ NVL gốc). outlet=Quán (bán SKU trừ tồn SKU trực tiếp, trừ khi có BOM branch-specific).';

-- ────────────────────────────────────────────────────────────────
-- 2. AUTO-MIGRATE từ branch_type → cascade_mode (idempotent)
-- ────────────────────────────────────────────────────────────────
-- warehouse + factory → production (kho/xưởng sản xuất)
-- store + office       → outlet (cửa hàng + văn phòng)
-- → DEFAULT 'outlet' nên chỉ cần UPDATE production case.
update public.branches
   set cascade_mode = 'production'
 where branch_type in ('warehouse', 'factory')
   and cascade_mode = 'outlet';  -- idempotent: skip nếu đã set manual

-- ────────────────────────────────────────────────────────────────
-- 3. Helper: should_cascade_bom_at_branch
-- ────────────────────────────────────────────────────────────────
-- Trả true nếu khi bán SKU tại branch này, hệ thống NÊN cascade BOM:
--   • branch.cascade_mode = 'production' VÀ có BOM (global hoặc branch-specific)
--     → cascade (vd Kho tổng bán sữa lon → cascade BOM trừ NVL).
--   • branch.cascade_mode = 'outlet' VÀ có BOM branch-specific cho branch này
--     → cascade (vd Quán A bán Bạc xỉu, có BOM riêng Quán A → cascade trừ SKU).
--   • Còn lại → false (outlet bán SKU đóng gói BOM global → KHÔNG cascade, trừ SKU thẳng).
create or replace function public.should_cascade_bom_at_branch(
  p_sku_id uuid,
  p_branch_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_cascade_mode text;
  v_has_branch_specific boolean;
  v_has_global boolean;
begin
  -- Lấy cascade_mode của branch (default outlet nếu null cho an toàn)
  select coalesce(cascade_mode, 'outlet') into v_cascade_mode
  from public.branches
  where id = p_branch_id;

  if v_cascade_mode is null then
    return false;  -- branch không tồn tại → không cascade
  end if;

  -- Check BOM branch-specific
  select exists (
    select 1 from public.bom
    where product_id = p_sku_id
      and branch_id = p_branch_id
      and is_active = true
  ) into v_has_branch_specific;

  -- Check BOM global (branch_id IS NULL)
  select exists (
    select 1 from public.bom
    where product_id = p_sku_id
      and branch_id is null
      and is_active = true
  ) into v_has_global;

  if v_cascade_mode = 'production' then
    -- Production branch: cascade nếu có BOM nào (branch-specific ưu tiên, fallback global)
    return v_has_branch_specific or v_has_global;
  else
    -- Outlet branch: chỉ cascade khi có BOM branch-specific riêng cho branch này
    -- (vd món pha chế tự thiết lập tại Quán). KHÔNG cascade BOM global (BOM
    -- global của SKU đóng gói thường tham chiếu NVL không tồn tại ở Quán).
    return v_has_branch_specific;
  end if;
end;
$$;

grant execute on function public.should_cascade_bom_at_branch(uuid, uuid) to authenticated;

comment on function public.should_cascade_bom_at_branch is
  'CEO 03/06/2026 — Sprint 3: kiểm tra branch có nên cascade BOM khi bán SKU không. Dùng trong pos/fnb/internal_sale RPCs.';

-- ────────────────────────────────────────────────────────────────
-- 4. UPDATE pos_complete_checkout_atomic v5 — check cascade_mode
-- ────────────────────────────────────────────────────────────────
create or replace function public.pos_complete_checkout_atomic(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_created_by uuid,
  p_customer_id uuid default null,
  p_customer_name text default 'Khách lẻ',
  p_items jsonb default '[]'::jsonb,
  p_payment_method text default 'cash',
  p_payment_breakdown jsonb default null,
  p_subtotal numeric default 0,
  p_discount_amount numeric default 0,
  p_total numeric default 0,
  p_paid numeric default 0,
  p_note text default null,
  p_source text default 'pos',
  p_shift_id uuid default null,
  p_promotion_id uuid default null,
  p_promotion_discount numeric default 0,
  p_promotion_free_value numeric default 0,
  p_client_session_id text default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_invoice_id uuid;
  v_invoice_code text;
  v_existing record;
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_unit text;
  v_qty numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_vat_rate numeric;
  v_vat_amt numeric;
  v_line_before_tax numeric;
  v_tax_total numeric := 0;
  v_session_id text := nullif(p_client_session_id, '');
  v_breakdown_item jsonb;
  v_method text;
  v_amount numeric;
  v_cash_code text;
  v_method_label text;
  v_has_bom boolean;
  v_should_cascade boolean;
  v_bom_result jsonb;
  v_bom_results jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'POS checkout requires at least one item';
  end if;

  if p_shift_id is not null and not exists (
    select 1 from public.shifts
    where id = p_shift_id and tenant_id = p_tenant_id
      and branch_id = p_branch_id and status = 'open'
  ) then
    raise exception 'Shift % is not open for this branch', p_shift_id;
  end if;

  if v_session_id is not null then
    select id, code, status into v_existing
    from public.invoices
    where tenant_id = p_tenant_id and client_session_id = v_session_id
    order by created_at desc limit 1;

    if found and v_existing.status = 'completed' then
      return jsonb_build_object(
        'invoice_id', v_existing.id,
        'invoice_code', v_existing.code,
        'idempotent', true
      );
    elsif found and v_existing.status = 'draft' then
      raise exception 'Invoice % is still draft; resume the draft instead', v_existing.code;
    end if;
  end if;

  v_invoice_code := public.next_code(p_tenant_id, 'invoice');
  if v_invoice_code is null or v_invoice_code = '' then
    v_invoice_code := 'HD' || extract(epoch from now())::bigint::text;
  end if;

  -- Pre-compute tax
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unitPrice')::numeric, 0);
    v_discount := coalesce((v_item->>'discount')::numeric, 0);
    v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
    v_line_before_tax := (v_qty * v_unit_price) - v_discount;
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);
    v_tax_total := v_tax_total + v_vat_amt;
  end loop;

  begin
    insert into public.invoices (
      tenant_id, branch_id, code, customer_id, customer_name, status,
      subtotal, discount_amount, tax_amount, total, paid, debt,
      payment_method, source, note, created_by, shift_id,
      promotion_id, promotion_discount, promotion_free_value,
      client_session_id, auto_saved
    ) values (
      p_tenant_id, p_branch_id, v_invoice_code,
      p_customer_id, coalesce(nullif(p_customer_name, ''), 'Khách lẻ'), 'completed',
      coalesce(p_subtotal, 0), coalesce(p_discount_amount, 0), v_tax_total,
      coalesce(p_total, 0), coalesce(p_paid, 0),
      greatest(0, coalesce(p_total, 0) - coalesce(p_paid, 0)),
      p_payment_method, coalesce(nullif(p_source, ''), 'pos'), p_note,
      p_created_by, p_shift_id,
      p_promotion_id, coalesce(p_promotion_discount, 0), coalesce(p_promotion_free_value, 0),
      v_session_id, false
    ) returning id into v_invoice_id;
  exception when unique_violation then
    if v_session_id is not null then
      select id, code, status into v_existing
      from public.invoices
      where tenant_id = p_tenant_id and client_session_id = v_session_id
      order by created_at desc limit 1;

      if found and v_existing.status = 'completed' then
        return jsonb_build_object(
          'invoice_id', v_existing.id,
          'invoice_code', v_existing.code,
          'idempotent', true
        );
      end if;
    end if;
    raise;
  end;

  -- Loop items: insert invoice_items + trừ tồn (theo has_bom + cascade_mode)
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'productId')::uuid;
    v_product_name := coalesce(nullif(v_item->>'productName', ''), 'Sản phẩm');
    v_unit := coalesce(nullif(v_item->>'unit', ''), 'Cái');
    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_unit_price := coalesce((v_item->>'unitPrice')::numeric, 0);
    v_discount := coalesce((v_item->>'discount')::numeric, 0);
    v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
    v_line_before_tax := (v_qty * v_unit_price) - v_discount;
    v_vat_amt := round(v_line_before_tax * v_vat_rate / 100);

    if v_product_id is null or v_qty <= 0 then
      raise exception 'Invalid POS item: %', v_item;
    end if;

    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit,
      quantity, unit_price, discount, vat_rate, vat_amount, total
    ) values (
      v_invoice_id, v_product_id, v_product_name, v_unit,
      v_qty, v_unit_price, v_discount, v_vat_rate, v_vat_amt, v_line_before_tax
    );

    -- ─── CEO 03/06/2026: cascade BOM theo cascade_mode ───
    select coalesce(has_bom, false) into v_has_bom
    from public.products where id = v_product_id;

    if v_has_bom then
      -- Check should cascade tại branch này
      v_should_cascade := public.should_cascade_bom_at_branch(v_product_id, p_branch_id);

      if v_should_cascade then
        -- Production branch HOẶC outlet có BOM riêng → cascade
        v_bom_result := public.consume_bom_for_sale(
          p_tenant_id, p_branch_id, v_product_id, v_qty, v_invoice_id, p_created_by, v_invoice_code
        );
        v_bom_results := v_bom_results || jsonb_build_object(
          'product_id', v_product_id,
          'product_name', v_product_name,
          'sale_qty', v_qty,
          'cascade', true,
          'result', v_bom_result
        );
      else
        -- Outlet branch + BOM global → trừ tồn SKU trực tiếp
        -- (vd Quán bán takeaway sữa lon, BOM "1 lon = 1 lon NVL" chỉ áp dụng tại Kho tổng)
        insert into public.stock_movements (
          tenant_id, branch_id, product_id, type, quantity,
          reference_type, reference_id, note, created_by
        ) values (
          p_tenant_id, p_branch_id, v_product_id, 'out', v_qty,
          'invoice', v_invoice_id,
          'POS bán hàng (outlet, không cascade) - ' || v_invoice_code, p_created_by
        );

        perform public.increment_product_stock(v_product_id, -v_qty);
        perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_product_id, -v_qty);

        begin
          perform public.allocate_lots_fifo(
            p_tenant_id, v_product_id, p_branch_id, v_qty, 'invoice', v_invoice_id
          );
        exception when others then null;
        end;

        v_bom_results := v_bom_results || jsonb_build_object(
          'product_id', v_product_id,
          'product_name', v_product_name,
          'sale_qty', v_qty,
          'cascade', false,
          'reason', 'outlet_no_branch_bom'
        );
      end if;
    else
      -- SP không có BOM: trừ tồn chính nó như cũ
      insert into public.stock_movements (
        tenant_id, branch_id, product_id, type, quantity,
        reference_type, reference_id, note, created_by
      ) values (
        p_tenant_id, p_branch_id, v_product_id, 'out', v_qty,
        'invoice', v_invoice_id, 'POS bán hàng - ' || v_invoice_code, p_created_by
      );

      perform public.increment_product_stock(v_product_id, -v_qty);
      perform public.upsert_branch_stock(p_tenant_id, p_branch_id, v_product_id, -v_qty);

      begin
        perform public.allocate_lots_fifo(
          p_tenant_id, v_product_id, p_branch_id, v_qty, 'invoice', v_invoice_id
        );
      exception when others then null;
      end;
    end if;
  end loop;

  -- Cash transactions (mixed support) — giữ logic v4
  if coalesce(p_paid, 0) > 0 then
    if p_payment_method = 'mixed' and p_payment_breakdown is not null
       and jsonb_typeof(p_payment_breakdown) = 'array'
       and jsonb_array_length(p_payment_breakdown) > 0 then
      for v_breakdown_item in select * from jsonb_array_elements(p_payment_breakdown) loop
        v_amount := coalesce((v_breakdown_item->>'amount')::numeric, 0);
        v_method := v_breakdown_item->>'method';
        if v_amount > 0 and v_method in ('cash', 'transfer', 'card') then
          v_cash_code := public.next_code(p_tenant_id, 'cash_receipt');
          if v_cash_code is null or v_cash_code = '' then
            v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
          end if;
          v_method_label := case v_method
            when 'cash' then 'tiền mặt'
            when 'transfer' then 'chuyển khoản'
            when 'card' then 'thẻ' else v_method end;
          insert into public.cash_transactions (
            tenant_id, branch_id, code, type, category, amount,
            counterparty, payment_method, reference_type, reference_id,
            note, created_by, shift_id
          ) values (
            p_tenant_id, p_branch_id, v_cash_code, 'receipt', 'Bán hàng', v_amount,
            coalesce(nullif(p_customer_name, ''), 'Khách lẻ'), v_method,
            'invoice', v_invoice_id,
            'Thu tiền HĐ ' || v_invoice_code || ' (' || v_method_label || ')',
            p_created_by, p_shift_id
          );
        end if;
      end loop;
    else
      v_cash_code := public.next_code(p_tenant_id, 'cash_receipt');
      if v_cash_code is null or v_cash_code = '' then
        v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
      end if;
      insert into public.cash_transactions (
        tenant_id, branch_id, code, type, category, amount,
        counterparty, payment_method, reference_type, reference_id,
        note, created_by, shift_id
      ) values (
        p_tenant_id, p_branch_id, v_cash_code, 'receipt', 'Bán hàng', p_paid,
        coalesce(nullif(p_customer_name, ''), 'Khách lẻ'),
        case when p_payment_method = 'mixed' then 'cash' else p_payment_method end,
        'invoice', v_invoice_id, 'Thu tiền HĐ ' || v_invoice_code,
        p_created_by, p_shift_id
      );
    end if;
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_code', v_invoice_code,
    'total', p_total,
    'paid', p_paid,
    'debt', greatest(0, coalesce(p_total, 0) - coalesce(p_paid, 0)),
    'bom_consume_results', v_bom_results
  );
end;
$$;

comment on function public.pos_complete_checkout_atomic is
  'Atomic retail POS checkout v5 (CEO 03/06/2026): cascade BOM theo cascade_mode + BOM branch-specific. Outlet bán SKU has_bom=true mà không có BOM branch-specific → trừ tồn SKU trực tiếp.';

-- ────────────────────────────────────────────────────────────────
-- 5. UPDATE fnb_complete_payment_atomic v7 — check cascade_mode
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

  -- 3. Tính subtotal + tax (items + toppings)
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
    select product_id, product_name, variant_label, quantity, unit_price, toppings,
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

    select coalesce(has_bom, false) into v_has_bom
    from public.products where id = r.product_id;

    if v_has_bom then
      v_should_cascade := public.should_cascade_bom_at_branch(r.product_id, v_branch_id);

      if v_should_cascade then
        -- Cascade BOM (món pha chế tại Quán có BOM branch-specific, hoặc bất kỳ has_bom tại Kho)
        v_bom_result := public.consume_bom_for_sale(
          v_tenant_id, v_branch_id, r.product_id, r.quantity, v_invoice_id, p_created_by, v_invoice_code,
          r.modifier_selections
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
        -- (vd Quán bán takeaway lon sữa đóng gói nguyên)
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

        -- SP không cascade nhưng có modifier_selections → vẫn trừ topping NVL nếu có
        if r.modifier_selections is not null and jsonb_typeof(r.modifier_selections) = 'array' then
          v_bom_result := public.consume_bom_for_sale(
            v_tenant_id, v_branch_id, r.product_id, r.quantity, v_invoice_id, p_created_by, v_invoice_code,
            r.modifier_selections
          );
          -- BOM null nhưng modifier sẽ apply topping NVL
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

      if r.modifier_selections is not null and jsonb_typeof(r.modifier_selections) = 'array' then
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

    -- Topping cũ (FnbCartTopping JSONB) — giữ logic v6
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
                  v_invoice_id, p_created_by, v_invoice_code, null
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

  -- 7. Cash transactions (giữ logic v6)
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
  'FnB payment v7 (CEO 03/06/2026): cascade BOM theo cascade_mode + BOM branch-specific. Outlet bán SKU has_bom=true mà BOM chỉ global → trừ tồn SKU trực tiếp.';

-- ────────────────────────────────────────────────────────────────
-- 6. NEW RPC: internal_sale_apply_stock_out — fix bug G1
-- ────────────────────────────────────────────────────────────────
-- Khi tạo Internal Sale Retail → FnB, leg-OUT bên Retail cần cascade BOM
-- nếu SKU has_bom=true VÀ branch source là production. Service hiện gọi
-- applyManualStockMovement(type='out') → chỉ trừ branch_stock(SKU) = 0
-- (vì SKU has_bom không giữ tồn) → KHÔNG trừ NVL Retail → BUG G1.
--
-- RPC này thay applyManualStockMovement cho leg-OUT, atomic + cascade-aware.
create or replace function public.internal_sale_apply_stock_out(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reference_id uuid,
  p_reference_code text,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_has_bom boolean;
  v_should_cascade boolean;
  v_bom_result jsonb;
begin
  if p_tenant_id is null or p_branch_id is null or p_product_id is null then
    raise exception 'internal_sale_apply_stock_out: tenant/branch/product required';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'internal_sale_apply_stock_out: quantity must be > 0';
  end if;

  select coalesce(has_bom, false) into v_has_bom
  from public.products where id = p_product_id;

  if v_has_bom then
    v_should_cascade := public.should_cascade_bom_at_branch(p_product_id, p_branch_id);

    if v_should_cascade then
      -- Cascade BOM → trừ NVL gốc ở source branch
      v_bom_result := public.consume_bom_for_sale(
        p_tenant_id, p_branch_id, p_product_id, p_quantity,
        p_reference_id, p_created_by, p_reference_code, null
      );
      return jsonb_build_object(
        'method', 'cascade_bom',
        'product_id', p_product_id,
        'qty', p_quantity,
        'result', v_bom_result
      );
    end if;
  end if;

  -- Default: trừ tồn SKU trực tiếp (SP đơn giản, hoặc outlet không cascade)
  insert into public.stock_movements (
    tenant_id, branch_id, product_id, type, quantity,
    reference_type, reference_id, note, created_by
  ) values (
    p_tenant_id, p_branch_id, p_product_id, 'out', p_quantity,
    'internal_sale', p_reference_id,
    'Xuất nội bộ ' || coalesce(p_reference_code, p_reference_id::text),
    p_created_by
  );

  perform public.increment_product_stock(p_product_id, -p_quantity);
  perform public.upsert_branch_stock(p_tenant_id, p_branch_id, p_product_id, -p_quantity);

  begin
    perform public.allocate_lots_fifo(
      p_tenant_id, p_product_id, p_branch_id, p_quantity, 'internal_sale', p_reference_id
    );
  exception when others then null;
  end;

  return jsonb_build_object(
    'method', 'direct_sku',
    'product_id', p_product_id,
    'qty', p_quantity
  );
end;
$$;

grant execute on function public.internal_sale_apply_stock_out(uuid, uuid, uuid, numeric, uuid, text, uuid) to authenticated;

comment on function public.internal_sale_apply_stock_out is
  'CEO 03/06/2026 — Sprint 3 (fix G1): xử lý leg-OUT Internal Sale. Production branch + SKU has_bom → cascade BOM trừ NVL. Còn lại → trừ tồn SKU trực tiếp.';

-- ────────────────────────────────────────────────────────────────
-- 7. NEW RPC: get_bom_availability_batch — POS Retail G3
-- ────────────────────────────────────────────────────────────────
-- Cho mỗi SKU có has_bom=true tại branch production, tính khả dụng tối đa
-- có thể bán = MIN(NVL_stock / BOM_qty_per_unit) qua tất cả bom_items.
-- Trả về Record cho FE map vào tile POS. SKU không cascade (has_bom=false
-- hoặc outlet branch không có BOM specific) → trả null → FE dùng product.stock.
create or replace function public.get_bom_availability_batch(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sku_ids uuid[]
) returns table (
  sku_id uuid,
  available numeric,
  bottleneck_material_id uuid,
  bottleneck_material_name text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_sku uuid;
  v_should_cascade boolean;
  v_bom_id uuid;
  v_min_avail numeric;
  v_bottleneck_mat uuid;
  v_bottleneck_name text;
  v_item record;
  v_unit_consume numeric;
  v_mat_stock numeric;
  v_can_make numeric;
begin
  if p_sku_ids is null or array_length(p_sku_ids, 1) is null then
    return;
  end if;

  foreach v_sku in array p_sku_ids loop
    -- Chỉ tính cho SKU has_bom=true và branch cần cascade
    v_should_cascade := public.should_cascade_bom_at_branch(v_sku, p_branch_id);
    if not v_should_cascade then
      continue;
    end if;

    v_bom_id := public.get_active_bom_for_branch(v_sku, p_branch_id);
    if v_bom_id is null then
      continue;
    end if;

    v_min_avail := null;
    v_bottleneck_mat := null;
    v_bottleneck_name := null;

    for v_item in
      select
        bi.material_id,
        bi.quantity,
        coalesce(bi.waste_percent, 0) as waste_percent,
        p.name as material_name
      from public.bom_items bi
        left join public.products p on p.id = bi.material_id
      where bi.bom_id = v_bom_id
    loop
      -- consume_qty cho 1 đơn vị SKU = quantity × (1 + waste/100)
      v_unit_consume := v_item.quantity * (1 + v_item.waste_percent / 100);
      if v_unit_consume <= 0 then continue; end if;

      select coalesce(sum(quantity), 0) into v_mat_stock
      from public.branch_stock
      where product_id = v_item.material_id
        and branch_id = p_branch_id
        and variant_id is null;

      v_can_make := floor(v_mat_stock / v_unit_consume);

      if v_min_avail is null or v_can_make < v_min_avail then
        v_min_avail := v_can_make;
        v_bottleneck_mat := v_item.material_id;
        v_bottleneck_name := v_item.material_name;
      end if;
    end loop;

    if v_min_avail is not null then
      sku_id := v_sku;
      available := greatest(0, v_min_avail);
      bottleneck_material_id := v_bottleneck_mat;
      bottleneck_material_name := v_bottleneck_name;
      return next;
    end if;
  end loop;
end;
$$;

grant execute on function public.get_bom_availability_batch(uuid, uuid, uuid[]) to authenticated;

comment on function public.get_bom_availability_batch is
  'CEO 03/06/2026 — Sprint 3 (G3): tính khả dụng theo BOM cho list SKU has_bom=true tại branch production. Trả số đơn vị bán tối đa = min(NVL stock / qty).';

-- ────────────────────────────────────────────────────────────────
-- 8. Reload schema
-- ────────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY (sau khi apply migration, CEO chạy):
--
-- 1. Check cascade_mode đã set đúng:
--    select id, name, branch_type, cascade_mode from public.branches
--    where tenant_id = '<your-tenant>';
--    → Kỳ vọng: warehouse/factory = production, store/office = outlet.
--
-- 2. Test should_cascade_bom_at_branch:
--    select public.should_cascade_bom_at_branch('<sku_id>', '<branch_id>');
--
-- 3. (Optional) Manual override cascade_mode nếu có nhu cầu:
--    UPDATE branches SET cascade_mode = 'production' WHERE id = '<branch_id>';
-- ============================================================
