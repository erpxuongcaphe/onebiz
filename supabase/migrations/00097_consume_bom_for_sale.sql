-- ============================================================
-- 00097: consume_bom_for_sale — RPC trừ NVL theo BOM khi bán SKU
-- (CEO 18/05/2026)
--
-- Khi bán 1 ly Bạc xỉu trên POS FnB, RPC này được gọi để:
--   1. Lookup BOM cho (sku_id, branch_id) — ưu tiên branch-specific
--   2. Nếu không có BOM → log warning + return (không trừ NVL)
--   3. Loop bom_items: trừ branch_stock của NVL theo qty × effective (waste)
--   4. Record stock_movements type='bom_consume' với reference_id = invoice_id
--   5. Validate stock NVL đủ — tuân theo setting `allow_negative_stock`:
--      - false → reject nếu thiếu NVL bất kỳ
--      - true  → cho phép âm + ghi warning vào audit log
--
-- Return jsonb:
--   {
--     success: true,
--     bom_id: uuid | null (nếu SKU không có BOM),
--     consumed: [{ material_id, material_name, qty, unit }],
--     warnings: [{ material_id, reason }]   // khi allow_negative + còn thiếu
--   }
-- ============================================================

create or replace function public.consume_bom_for_sale(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sku_id uuid,
  p_qty numeric,
  p_invoice_id uuid,
  p_created_by uuid,
  p_invoice_code text default null
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
begin
  if p_tenant_id is null or p_branch_id is null or p_sku_id is null then
    raise exception 'consume_bom_for_sale: tenant_id, branch_id, sku_id are required';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'consume_bom_for_sale: qty must be > 0';
  end if;

  -- ─── 1. Lookup BOM (branch-specific ưu tiên, fallback global) ───
  v_bom_id := public.get_active_bom_for_branch(p_sku_id, p_branch_id);

  if v_bom_id is null then
    -- SKU chưa setup BOM → return early, không trừ NVL nhưng không fail
    return jsonb_build_object(
      'success', true,
      'bom_id', null,
      'consumed', '[]'::jsonb,
      'warnings', jsonb_build_array(jsonb_build_object(
        'reason', 'SKU chưa có BOM — không trừ NVL. Vui lòng setup BOM trong /hang-hoa/cong-thuc.'
      ))
    );
  end if;

  -- ─── 2. Get setting allow_negative_stock ───
  v_allow_negative := coalesce(
    (public.get_tenant_setting(p_tenant_id, 'allow_negative_stock', 'true'::jsonb))::boolean,
    true
  );

  -- ─── 3. Load BOM metadata để dùng cho note ───
  select b.id, b.name, b.code into v_bom
  from public.bom b
  where b.id = v_bom_id;

  v_note := format(
    'Tiêu hao NVL theo BOM [%s] — HĐ %s',
    coalesce(v_bom.code, v_bom.name, 'BOM'),
    coalesce(p_invoice_code, p_invoice_id::text)
  );

  -- ─── 4. Loop từng bom_item: trừ NVL ───
  for v_item in
    select
      bi.material_id,
      bi.unit,
      bi.quantity,
      coalesce(bi.waste_percent, 0) as waste_percent,
      -- effective_qty = quantity × (1 + waste_percent/100) × p_qty
      round(
        (bi.quantity * (1 + coalesce(bi.waste_percent, 0) / 100) * p_qty)::numeric,
        4
      ) as consume_qty,
      p.code as material_code,
      p.name as material_name
    from public.bom_items bi
      left join public.products p on p.id = bi.material_id
    where bi.bom_id = v_bom_id
    order by bi.sort_order, bi.id
  loop
    v_consume_qty := v_item.consume_qty;

    if v_consume_qty <= 0 then
      continue;
    end if;

    -- Check stock NVL available
    select coalesce(sum(quantity), 0) into v_available
    from public.branch_stock
    where product_id = v_item.material_id
      and branch_id = p_branch_id
      and variant_id is null;

    if v_available < v_consume_qty then
      if not v_allow_negative then
        -- Strict mode: reject toàn bộ
        raise exception 'NVL_INSUFFICIENT: NVL "%" tại chi nhánh thiếu — còn %, cần % (cho %s × %s)',
          coalesce(v_item.material_name, v_item.material_code, v_item.material_id::text),
          v_available, v_consume_qty,
          p_qty, coalesce(v_bom.name, 'BOM');
      else
        -- Loose mode: warning + tiếp tục trừ (cho phép âm)
        v_warnings := v_warnings || jsonb_build_object(
          'material_id', v_item.material_id,
          'material_code', v_item.material_code,
          'material_name', v_item.material_name,
          'available', v_available,
          'required', v_consume_qty,
          'reason', format(
            'NVL "%s" còn %s nhưng cần %s — tồn kho sẽ âm (admin cân đối sau)',
            coalesce(v_item.material_name, v_item.material_code), v_available, v_consume_qty
          )
        );
      end if;
    end if;

    -- ─── Trừ branch_stock ───
    perform public.upsert_branch_stock(
      p_tenant_id, p_branch_id, v_item.material_id, -v_consume_qty
    );

    -- ─── Record stock_movements (audit trail) ───
    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_branch_id, v_item.material_id, 'out', v_consume_qty,
      'bom_consume', p_invoice_id,
      v_note || format(' [%s × %s]', p_qty, coalesce(v_item.material_name, 'NVL')),
      p_created_by
    );

    -- ─── Add to consumed list ───
    v_consumed := v_consumed || jsonb_build_object(
      'material_id', v_item.material_id,
      'material_code', v_item.material_code,
      'material_name', v_item.material_name,
      'qty', v_consume_qty,
      'unit', v_item.unit
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'bom_id', v_bom_id,
    'bom_name', v_bom.name,
    'consumed', v_consumed,
    'warnings', v_warnings,
    'allow_negative', v_allow_negative
  );
end;
$$;

grant execute on function public.consume_bom_for_sale(uuid, uuid, uuid, numeric, uuid, uuid, text) to authenticated;

comment on function public.consume_bom_for_sale is
  'Trừ NVL theo BOM khi bán SKU. Tôn trọng setting allow_negative_stock. CEO 18/05/2026.';

notify pgrst, 'reload schema';
