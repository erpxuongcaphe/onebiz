-- ============================================================
-- 00144: FIX luồng trả hàng — BOM-aware revert + chống trả vượt
-- (CEO BATCH 3R, 13/06/2026)
--
-- VẤN ĐỀ HIỆN TẠI (returns-completion.ts completeReturn):
--   Dùng applyManualStockMovement(type='in') cộng tồn vào CHÍNH SKU cho MỌI
--   sản phẩm trả, KHÔNG phân biệt has_bom. Hậu quả với SKU có BOM (cà phê
--   rang xay đóng gói bán bằng consume_bom_for_sale — trừ NVL, KHÔNG trừ tồn
--   SKU):
--     - Cộng tồn ẢO vào SKU (lúc bán không trừ tồn SKU) → POS hiển thị tồn
--       theo BOM availability nên tồn ảo này KHÔNG bao giờ bán được → drift.
--     - KHÔNG hồi NVL đã tiêu hao → tồn NVL thiếu dần.
--   = Ngược hoàn toàn forward logic. Tồn kho sai dần qua mỗi lần trả.
--
-- CHUẨN NGÀNH (research Square/KiotViet/Sapo): trả hàng KHÔNG đổi status HĐ
-- gốc, tạo phiếu trả riêng (sales_returns đã có). Migration này KHÔNG đụng
-- invoices.status — chỉ sửa side-effect kho cho đúng + thêm guard chống trả
-- vượt số đã mua.
--
-- THAY ĐỔI:
--   1. invoice_items.returned_qty — track SL đã trả tích lũy per line (chống
--      over-refund khi trả nhiều lần + suy ra badge "Đã trả 1 phần").
--   2. RPC restore_bom_for_return — mirror consume_bom_for_sale với dấu DƯƠNG
--      (hồi NVL theo BOM hiện hành × qty). Semantics "un-make" giống void RPC
--      00117. Chỉ dùng cho SKU has_bom. Modifier scale = 1 (retail không có
--      modifier; FnB drink hiếm khi trả).
--
-- KHÔNG đổi schema sales_returns/invoices.status → 0 rủi ro báo cáo doanh thu.
-- Service completeReturn sẽ phân nhánh has_bom để gọi RPC này.
-- ============================================================

-- ── 1. Cột returned_qty (over-refund guard + badge derivation) ──
alter table public.invoice_items
  add column if not exists returned_qty numeric not null default 0;

comment on column public.invoice_items.returned_qty is
  'SL đã trả tích lũy (cộng dồn qua các phiếu trả). Chống trả vượt SL mua + '
  'suy ra badge "Đã trả 1 phần"/"Đã trả hết". CEO BATCH 3R 13/06/2026.';

-- ── 2. RPC restore_bom_for_return — mirror consume_bom_for_sale (+) ──
-- Hồi NVL theo BOM hiện hành cho SKU has_bom khi trả hàng. Bảo toàn giá trị
-- tồn (giống void RPC: trả = un-make → NVL về kho, SKU finished coi như rã).
create or replace function public.restore_bom_for_return(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sku_id uuid,
  p_qty numeric,
  p_reference_id uuid,
  p_created_by uuid,
  p_ref_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bom_id uuid;
  v_bom record;
  v_item record;
  v_restored jsonb := '[]'::jsonb;
  v_restore_qty numeric;
  v_note text;
begin
  if p_tenant_id is null or p_branch_id is null or p_sku_id is null then
    raise exception 'restore_bom_for_return: tenant_id, branch_id, sku_id are required';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'restore_bom_for_return: qty must be > 0';
  end if;

  v_bom_id := public.get_active_bom_for_branch(p_sku_id, p_branch_id);

  -- SKU has_bom nhưng chưa setup BOM tại branch → không có NVL để hồi.
  -- Trả về rỗng (caller có thể fallback cộng tồn SKU hoặc bỏ qua).
  if v_bom_id is null then
    return jsonb_build_object('restored', v_restored, 'bom_found', false);
  end if;

  select b.id, b.name, b.code into v_bom from public.bom b where b.id = v_bom_id;

  v_note := format(
    'Hồi NVL trả hàng theo BOM [%s] — %s',
    coalesce(v_bom.code, v_bom.name, 'BOM'),
    coalesce(p_ref_code, p_reference_id::text)
  );

  for v_item in
    select
      bi.material_id,
      bi.quantity,
      coalesce(bi.waste_percent, 0) as waste_percent,
      p.name as material_name
    from public.bom_items bi
      left join public.products p on p.id = bi.material_id
    where bi.bom_id = v_bom_id
    order by bi.sort_order, bi.id
  loop
    -- GUARD self-BOM (giống consume 00135): material trùng chính SKU → bỏ qua.
    if v_item.material_id = p_sku_id then
      continue;
    end if;

    -- Mirror consume: qty = bom_qty × (1 + waste%) × refund_qty. Modifier
    -- scale = 1 (retail không modifier). Dấu DƯƠNG để HỒI lại.
    v_restore_qty := round(
      (v_item.quantity * (1 + v_item.waste_percent / 100) * p_qty)::numeric, 4
    );
    if v_restore_qty <= 0 then
      continue;
    end if;

    perform public.upsert_branch_stock(
      p_tenant_id, p_branch_id, v_item.material_id, v_restore_qty
    );
    perform public.increment_product_stock(v_item.material_id, v_restore_qty);

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      p_tenant_id, p_branch_id, v_item.material_id, 'in', v_restore_qty,
      'return_bom_restore', p_reference_id,
      v_note || format(' [%s × %s]', p_qty, coalesce(v_item.material_name, 'NVL')),
      p_created_by
    );

    v_restored := v_restored || jsonb_build_object(
      'material_id', v_item.material_id,
      'material_name', v_item.material_name,
      'qty', v_restore_qty
    );
  end loop;

  return jsonb_build_object('restored', v_restored, 'bom_found', true);
end;
$$;

comment on function public.restore_bom_for_return(uuid, uuid, uuid, numeric, uuid, uuid, text) is
  'Hồi NVL theo BOM khi trả hàng SKU has_bom (mirror consume_bom_for_sale dấu dương). '
  'Semantics un-make giống void RPC 00117. CEO BATCH 3R 13/06/2026.';

grant execute on function public.restore_bom_for_return(uuid, uuid, uuid, numeric, uuid, uuid, text) to authenticated;

-- ── 3. RPC increment_returned_qty — cộng dồn returned_qty atomic per line ──
create or replace function public.increment_returned_qty(
  p_invoice_item_id uuid,
  p_delta numeric
) returns void
language sql
security definer
set search_path = public, extensions
as $$
  update public.invoice_items
  set returned_qty = coalesce(returned_qty, 0) + p_delta
  where id = p_invoice_item_id;
$$;

comment on function public.increment_returned_qty(uuid, numeric) is
  'Cộng dồn invoice_items.returned_qty atomic khi trả hàng. CEO BATCH 3R 13/06/2026.';

grant execute on function public.increment_returned_qty(uuid, numeric) to authenticated;
