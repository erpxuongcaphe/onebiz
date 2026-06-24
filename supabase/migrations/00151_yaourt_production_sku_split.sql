-- ============================================================
-- 00151 — Tách đúng mô hình 2 mã cho Yaourt (sản xuất ↔ bán)
-- ============================================================
-- CEO 24/06/2026: Yaourt có 2 mã:
--   • NVL-SST-019 "Yaourt 500g/chai" (product_type=nvl, has_bom=false)
--     = THÀNH PHẨM tồn kho thật (chai yaourt trong kho).
--   • SKU-SST-019 "Yaourt 500g/chai" (product_type=sku, has_bom=true, retail)
--     = MÃ BÁN.
--
-- LỖI HIỆN TẠI:
--   • BOM sản xuất a655eeb6 SX ra SKU-SST-019 (mã bán) thay vì NVL-SST-019.
--   • SKU-SST-019 không có BOM bán riêng → khi bán, hệ trừ thẳng 3 NVL sữa
--     (công thức sản xuất) thay vì trừ tồn thành phẩm → tồn yaourt không bao
--     giờ giảm + nếu vừa sản xuất vừa bán thì trừ NVL sữa 2 lần.
--
-- MÔ HÌNH ĐÚNG (chuẩn kế toán sản xuất):
--   1) SẢN XUẤT: BOM a655eeb6 (3 NVL sữa) → ra NVL-SST-019 (thành phẩm).
--      Hoàn thành lệnh SX → trừ 3 sữa, CỘNG tồn NVL-SST-019, tạo lô.
--   2) BÁN: SKU-SST-019 có BOM bán = 1 SKU → 1 NVL-SST-019.
--      Bán SKU → trừ 1 tồn NVL-SST-019 (thành phẩm) → ghi âm được khi hết.
--   ⇒ KHÔNG trùng: sữa bị trừ 1 lần lúc SX; bán chỉ trừ thành phẩm.
--
-- Phạm vi: CHỈ Yaourt (pilot). 8 lệnh SX còn 'planned' (chưa tác động kho) nên
-- đổi product_id an toàn. Idempotent — chạy lại không hỏng.
-- ============================================================

do $$
declare
  v_tenant   uuid := '148e8ac5-b891-4de3-9055-cfa41f39ddb0';
  v_sku      uuid := '7249ef9f-da79-4b77-a23a-f316b5965ca4'; -- SKU-SST-019 (mã bán)
  v_nvl      uuid := '468e83b5-2398-49ee-9702-e80f29ac701b'; -- NVL-SST-019 (thành phẩm)
  v_prod_bom uuid := 'a655eeb6-7959-4901-9e94-6cc1cc2390ea'; -- BOM sản xuất (3 sữa)
  v_sale_bom uuid;
  v_nvl_unit text;
begin
  -- Guard: cả 2 mã + BOM phải tồn tại đúng tenant
  if not exists (select 1 from public.products where id = v_sku and tenant_id = v_tenant)
     or not exists (select 1 from public.products where id = v_nvl and tenant_id = v_tenant)
     or not exists (select 1 from public.bom where id = v_prod_bom and tenant_id = v_tenant) then
    raise notice '00151 SKIP: thiếu SKU/NVL/BOM Yaourt cho tenant này';
    return;
  end if;

  select coalesce(unit, 'Chai') into v_nvl_unit from public.products where id = v_nvl;

  -- ── 1. BOM sản xuất a655eeb6 → ra THÀNH PHẨM NVL-SST-019 ──
  update public.bom
     set product_id = v_nvl,
         name = 'Sản xuất Yaourt 500g/chai (thành phẩm)',
         updated_at = now()
   where id = v_prod_bom;

  -- ── 2. Vô hiệu mọi BOM active đang trỏ product_id = SKU (tránh tra nhầm khi bán) ──
  update public.bom
     set is_active = false, updated_at = now()
   where tenant_id = v_tenant and product_id = v_sku and is_active = true;

  -- ── 3. Tạo/khôi phục BOM BÁN cho SKU: 1 SKU = 1 NVL-SST-019 ──
  select id into v_sale_bom
    from public.bom
   where tenant_id = v_tenant and product_id = v_sku and code = 'BOM-SALE-SST-019'
   limit 1;

  if v_sale_bom is null then
    insert into public.bom (
      tenant_id, product_id, code, name, version, is_active,
      batch_size, yield_qty, yield_unit, branch_id, note
    ) values (
      v_tenant, v_sku, 'BOM-SALE-SST-019',
      'Bán Yaourt: 1 SKU = 1 chai thành phẩm (NVL-SST-019)', 1, true,
      1, 1, v_nvl_unit, null,
      'Tự tạo 00151: tách công thức bán khỏi công thức sản xuất'
    ) returning id into v_sale_bom;
  else
    update public.bom set is_active = true, updated_at = now() where id = v_sale_bom;
  end if;

  -- bom_items của BOM bán = đúng 1 × NVL-SST-019 (xoá-thêm để idempotent)
  delete from public.bom_items where bom_id = v_sale_bom;
  insert into public.bom_items (bom_id, material_id, quantity, unit, waste_percent, sort_order)
  values (v_sale_bom, v_nvl, 1, v_nvl_unit, 0, 1);

  -- ── 4. Lệnh SX (chưa hoàn thành) trỏ THÀNH PHẨM NVL-SST-019 ──
  --     production_order_materials (3 sữa) đã snapshot lúc tạo → giữ nguyên.
  update public.production_orders
     set product_id = v_nvl, updated_at = now()
   where tenant_id = v_tenant
     and product_id = v_sku
     and status in ('pending','planned','material_check','in_production','quality_check');

  raise notice '00151 OK: BOM sản xuất→NVL-SST-019, BOM bán SKU=1×NVL (%), lệnh SX→thành phẩm', v_sale_bom;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY sau khi áp:
--   -- BOM sản xuất giờ ra thành phẩm:
--   select code, name, product_id from public.bom where id='a655eeb6-7959-4901-9e94-6cc1cc2390ea';
--     → product_id = NVL-SST-019 (468e83b5...)
--   -- BOM bán SKU = 1 × NVL-SST-019:
--   select b.code, bi.material_id, bi.quantity from public.bom b
--     join public.bom_items bi on bi.bom_id=b.id
--    where b.code='BOM-SALE-SST-019';
--   -- Lệnh SX trỏ thành phẩm:
--   select code, product_id, status from public.production_orders where code like 'SX%';
--     → product_id = NVL-SST-019
--
-- LUỒNG ĐÚNG SAU MIGRATION:
--   • Hoàn thành SX000001 (7 chai): trừ 3 NVL sữa, +7 tồn NVL-SST-019, tạo lô.
--   • Bán SKU-SST-019 ×1: trừ 1 tồn NVL-SST-019 (ghi 'bom_consume') → tồn giảm,
--     hết thì âm. Sổ thẻ kho NVL-SST-019 đủ: SX nhập (in) + bán (out).
-- ============================================================
