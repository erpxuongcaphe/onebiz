-- ============================================================
-- Migration 00147 — CÔNG THỨC THEO SIZE (Pha 1-2): variant-aware BOM lookup
-- ============================================================
-- Mục tiêu: cho phép mỗi SIZE (product_variant) dùng CÔNG THỨC (BOM) riêng
-- của nó khi trừ kho, thay vì luôn dùng BOM của SP cha.
--
-- Cơ chế: thêm tham số optional p_variant_id (DEFAULT NULL) vào 2 RPC nền tảng.
--   - get_active_bom_for_branch: nếu có variant + variant.bom_code → ưu tiên BOM
--     của size đó; variant CHƯA có bom_code → KẾ THỪA BOM cha (auto-inherit);
--     không variant → như cũ.
--   - consume_bom_for_sale: nhận p_variant_id, truyền xuống get_active_bom_for_branch.
--
-- AN TOÀN / BACKWARD-COMPAT 100%:
--   - p_variant_id DEFAULT NULL → mọi caller cũ (truyền đúng số tham số như trước)
--     chạy y hệt hôm nay (variant = null → logic SP cha).
--   - Sau migration NÀY, fnb_complete_payment_atomic VẪN gọi 9 tham số cũ
--     (chưa truyền variant) → KHÔNG đổi 1 byte hành vi. Việc kích hoạt thật nằm ở
--     migration 00148.
--   - CHỐNG LẪN: lookup variant yêu cầu variant.product_id = p_product_id; lệch SP
--     → coi như không có variant → kế thừa BOM cha (an toàn, không trừ bừa).
--   - KHÔNG đụng POS Retail (Retail không truyền variant).
-- CEO 16/06/2026 — chỉ FnB.
-- ============================================================

-- ── 1. get_active_bom_for_branch: thêm p_variant_id ───────────────────────────
-- Drop bản 2 tham số cũ rồi tạo bản 3 tham số (tham số 3 có default → caller cũ
-- gọi 2 tham số vẫn match qua default).
drop function if exists public.get_active_bom_for_branch(uuid, uuid);

create or replace function public.get_active_bom_for_branch(
  p_product_id uuid,
  p_branch_id uuid,
  p_variant_id uuid default null
) returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_bom_id uuid;
  v_bom_code text;
  v_tenant_id uuid;
  v_variant_code text;
begin
  -- Đọc bom_code + tenant_id của SP cha
  select bom_code, tenant_id into v_bom_code, v_tenant_id
  from public.products
  where id = p_product_id;

  -- ─── PATH VARIANT (CÔNG THỨC THEO SIZE) ───
  -- Chỉ khi có variant_id. Yêu cầu variant thuộc ĐÚNG SP này (chống lẫn SP khác).
  if p_variant_id is not null then
    select bom_code into v_variant_code
    from public.product_variants
    where id = p_variant_id
      and product_id = p_product_id
      and tenant_id = v_tenant_id;

    if v_variant_code is not null and v_variant_code <> '' then
      -- Ưu tiên BOM của size theo branch (override)
      select id into v_bom_id
      from public.bom
      where tenant_id = v_tenant_id
        and code = v_variant_code
        and branch_id = p_branch_id
        and is_active = true
      order by version desc nulls last
      limit 1;
      if v_bom_id is not null then
        return v_bom_id;
      end if;

      -- Fallback: BOM của size global (branch_id null)
      select id into v_bom_id
      from public.bom
      where tenant_id = v_tenant_id
        and code = v_variant_code
        and branch_id is null
        and is_active = true
      order by version desc nulls last
      limit 1;
      if v_bom_id is not null then
        return v_bom_id;
      end if;

      -- variant có bom_code nhưng KHÔNG tìm thấy BOM nào (mã mồ côi)
      -- → return null để frontend báo lỗi rõ (KHÔNG âm thầm dùng BOM cha).
      return null;
    end if;
    -- variant KHÔNG có bom_code → AUTO-INHERIT: rơi xuống logic SP cha bên dưới.
  end if;

  -- ─── PATH SP CHA (như cũ) ───
  -- Nếu SP cha có bom_code → lookup BOM theo code
  if v_bom_code is not null then
    select id into v_bom_id
    from public.bom
    where tenant_id = v_tenant_id
      and code = v_bom_code
      and branch_id = p_branch_id
      and is_active = true
    order by version desc nulls last
    limit 1;
    if v_bom_id is not null then
      return v_bom_id;
    end if;

    select id into v_bom_id
    from public.bom
    where tenant_id = v_tenant_id
      and code = v_bom_code
      and branch_id is null
      and is_active = true
    order by version desc nulls last
    limit 1;
    if v_bom_id is not null then
      return v_bom_id;
    end if;
    return null;
  end if;

  -- PATH CŨ NHẤT (backward compat): tìm BOM theo product_id
  select id into v_bom_id
  from public.bom
  where product_id = p_product_id
    and branch_id = p_branch_id
    and is_active = true
  order by version desc nulls last
  limit 1;
  if v_bom_id is not null then
    return v_bom_id;
  end if;

  select id into v_bom_id
  from public.bom
  where product_id = p_product_id
    and branch_id is null
    and is_active = true
  order by version desc nulls last
  limit 1;

  return v_bom_id; -- có thể null
end;
$$;

comment on function public.get_active_bom_for_branch(uuid, uuid, uuid) is
  'CEO 16/06/2026 (công thức theo size): p_variant_id optional → ưu tiên BOM của variant (size). Variant chưa có bom_code → kế thừa BOM cha. Backward-compat: variant=null = logic cũ.';

-- Index hỗ trợ lookup BOM theo variant code (đã có idx_bom_code_branch_active ở 00105,
-- BOM của size cũng identify bằng code nên dùng chung index đó — không cần thêm).

-- ── 2. consume_bom_for_sale: thêm p_variant_id (truyền xuống get_active) ───────
drop function if exists public.consume_bom_for_sale(uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, boolean);

create or replace function public.consume_bom_for_sale(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sku_id uuid,
  p_qty numeric,
  p_invoice_id uuid,
  p_created_by uuid,
  p_invoice_code text default null,
  p_modifier_selections jsonb default null,
  p_skip_bom_consume boolean default false,
  p_variant_id uuid default null  -- CEO 16/06/2026 — công thức theo size
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

  -- ─── 1. Lookup BOM (chỉ khi không skip) — TRUYỀN p_variant_id ───
  if not p_skip_bom_consume then
    v_bom_id := public.get_active_bom_for_branch(p_sku_id, p_branch_id, p_variant_id);
  else
    v_bom_id := null;  -- skip BOM consume hoàn toàn
  end if;

  -- ─── 2. Get setting allow_negative_stock ───
  v_allow_negative := coalesce(
    (public.get_tenant_setting(p_tenant_id, 'allow_negative_stock', 'true'::jsonb))::boolean,
    true
  );

  -- ─── 3. BOM consume (nếu có BOM + không skip) ───
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
        bi.modifier_scale_target,
        p.code as material_code,
        p.name as material_name
      from public.bom_items bi
        left join public.products p on p.id = bi.material_id
      where bi.bom_id = v_bom_id
      order by bi.sort_order, bi.id
    loop
      -- GUARD: BOM tự-tham-chiếu (material trùng chính SKU) → bỏ qua.
      if v_item.material_id = p_sku_id then
        continue;
      end if;

      -- ─── Apply modifier scale nếu BOM item có modifier_scale_target ───
      v_modifier_scale := 1;
      if v_item.modifier_scale_target is not null
         and p_modifier_selections is not null
         and jsonb_typeof(p_modifier_selections) = 'array' then
        for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
          if (v_sel->>'groupId')::uuid = v_item.modifier_scale_target then
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

      v_consume_qty := round(
        (v_item.quantity * (1 + v_item.waste_percent / 100) * p_qty * v_modifier_scale)::numeric,
        4
      );

      if v_consume_qty <= 0 then
        continue;
      end if;

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
      perform public.increment_product_stock(v_item.material_id, -v_consume_qty);

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
  end if;  -- end if v_bom_id is not null

  -- ─── 4. Trừ tồn topping NVL theo linkedProductId (LUÔN CHẠY) ───
  if p_modifier_selections is not null
     and jsonb_typeof(p_modifier_selections) = 'array' then
    for v_sel in select * from jsonb_array_elements(p_modifier_selections) loop
      for v_opt in select * from jsonb_array_elements(v_sel->'options') loop
        if v_opt->>'linkedProductId' is not null
           and v_opt->>'linkedProductId' <> ''
           and v_opt->>'linkedProductId' <> 'null' then
          v_linked_id := (v_opt->>'linkedProductId')::uuid;
          v_topping_name := coalesce(v_opt->>'label', 'Topping');
          v_topping_qty := p_qty;

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
          perform public.increment_product_stock(v_linked_id, -v_topping_qty);

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
    'allow_negative', v_allow_negative,
    'skipped_bom', p_skip_bom_consume
  );
end;
$$;

grant execute on function public.consume_bom_for_sale(uuid, uuid, uuid, numeric, uuid, uuid, text, jsonb, boolean, uuid) to authenticated;

comment on function public.consume_bom_for_sale is
  'v5 (CEO 16/06/2026): + p_variant_id để dùng BOM theo size (variant). Backward-compat: variant=null = v4. Topping/modifier scale giữ nguyên.';

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY (chạy thủ công sau khi áp — KHÔNG bắt buộc):
--   -- bản 2 tham số cũ vẫn gọi được (qua default):
--   select public.get_active_bom_for_branch('<sku>'::uuid, '<branch>'::uuid);
--   -- bản 3 tham số:
--   select public.get_active_bom_for_branch('<sku>'::uuid, '<branch>'::uuid, '<variant>'::uuid);
-- ============================================================
