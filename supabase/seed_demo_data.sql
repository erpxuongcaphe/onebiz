-- ============================================================
-- OneBiz ERP — COMPREHENSIVE DEMO SEED
-- ============================================================
-- Dữ liệu mẫu đầy đủ cho demo: 1 xưởng + 1 kho + 3 quán FnB
-- Bao gồm: menu FnB, bàn, khách hàng, NCC, tồn kho, BOM,
-- lệnh SX, hoá đơn 3 tháng, ca làm, sổ quỹ, bán nội bộ,
-- loyalty, coupons, promotions.
--
-- Idempotent: Chạy lại nhiều lần không duplicate.
-- Target user: toandqq@xuongcaphe.com (9799bce2-7cbd-4be7-b72e-387a5166a48c)
--
-- CÁCH CHẠY:
--   1. Vào Supabase Dashboard → SQL Editor
--   2. Paste toàn bộ file này vào
--   3. Chạy (có thể mất 30-60 giây vì có 3 tháng giao dịch)
--   4. Kiểm tra NOTICE ở cuối để xem tenant_id + số liệu thống kê
--
-- GỠ DỮ LIỆU SAU KHI TEST XONG:
--   DELETE FROM tenants WHERE slug = '9799bce2-7cbd-4be7-b72e-387a5166a48c';
--   → Cascade sẽ xoá hết mọi thứ gắn với tenant này
-- ============================================================

DO $seed$
DECLARE
  v_user_id     uuid := '9799bce2-7cbd-4be7-b72e-387a5166a48c';
  v_tenant_id   uuid;
  v_factory_id  uuid;  -- Xưởng rang
  v_warehouse_id uuid; -- Kho tổng
  v_store1_id   uuid;  -- Quán Q1 (default branch)
  v_store2_id   uuid;  -- Quán Thủ Đức
  v_store3_id   uuid;  -- Quán Bình Thạnh

  v_cat_fca uuid; v_cat_ftr uuid; v_cat_fsv uuid; v_cat_fda uuid;
  v_cat_fne uuid; v_cat_fbg uuid; v_cat_fan uuid; v_cat_fkm uuid;

  v_prod_id uuid;
  v_bom_id uuid;
  v_po_id uuid;
  v_invoice_id uuid;
  v_shift_id uuid;
  v_kitchen_id uuid;
  v_table_id uuid;
  v_cust_id uuid;
  v_supp_id uuid;

  v_day date;
  v_created_by uuid;

  -- Loyalty tier ids
  v_tier_tv uuid; v_tier_tt uuid; v_tier_vip uuid;

  -- Sample pricing for a day's invoice
  v_sample_order_count int;
  v_invoice_count int := 0;
  v_item_count int := 0;

  -- Array of menu product ids for sampling in historical invoices
  v_menu_ids uuid[];
  v_menu_prices numeric[];
  v_menu_names text[];

  -- iterate helpers
  v_i int;
  v_j int;
  v_branch_ids uuid[];
  v_b uuid;
  v_has_history boolean;
  v_has_kds boolean;

  -- Product code counters
  v_qty numeric;
  v_price numeric;
  v_subtotal numeric;
  v_total numeric;
BEGIN
  -- ============================================================
  -- PART 1: Bootstrap tenant (nếu chưa có)
  -- ============================================================
  RAISE NOTICE '=== PART 1: Bootstrap tenant ===';

  -- Tìm tenant hiện tại qua profile
  SELECT tenant_id INTO v_tenant_id
    FROM public.profiles WHERE id = v_user_id;

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE 'Chưa có tenant cho user %, đang tạo mới...', v_user_id;

    -- Tạo tenant
    INSERT INTO public.tenants (name, slug)
    VALUES ('OneBiz Coffee Demo', v_user_id::text)
    RETURNING id INTO v_tenant_id;

    -- Tạo branch mặc định (sẽ dùng làm quán Q1)
    INSERT INTO public.branches (tenant_id, name, is_default, branch_type, code, address, phone, is_active)
    VALUES (v_tenant_id, 'Quán Cà Phê Quận 1', true, 'store', 'CN-Q1',
            '123 Nguyễn Huệ, Quận 1, TP.HCM', '0901234567', true)
    RETURNING id INTO v_store1_id;

    -- Tạo profile
    INSERT INTO public.profiles (id, tenant_id, branch_id, full_name, email, role, is_active)
    SELECT v_user_id, v_tenant_id, v_store1_id, 'Đoàn Quốc Toàn', u.email, 'owner', true
    FROM auth.users u WHERE u.id = v_user_id
    ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, branch_id = EXCLUDED.branch_id;

    -- Code sequences
    INSERT INTO public.code_sequences (tenant_id, entity_type, prefix, current_number, padding) VALUES
      (v_tenant_id, 'invoice', 'HD', 0, 6),
      (v_tenant_id, 'purchase_order', 'PO', 0, 6),
      (v_tenant_id, 'stock_movement', 'SM', 0, 6),
      (v_tenant_id, 'customer', 'KH', 0, 6),
      (v_tenant_id, 'supplier', 'NCC', 0, 6),
      (v_tenant_id, 'product', 'SP', 0, 6),
      (v_tenant_id, 'sales_return', 'TH', 0, 6),
      (v_tenant_id, 'shipping_order', 'VD', 0, 6),
      (v_tenant_id, 'inventory_check', 'KK', 0, 6),
      (v_tenant_id, 'cash_transaction', 'SQ', 0, 6),
      (v_tenant_id, 'online_order', 'OL', 0, 6),
      (v_tenant_id, 'production_order', 'SX', 0, 6),
      (v_tenant_id, 'kitchen_order', 'KB', 0, 6),
      (v_tenant_id, 'internal_sale', 'NB', 0, 6)
    ON CONFLICT (tenant_id, entity_type) DO NOTHING;

    -- Foundation (categories, pipelines, price tiers, sequences)
    PERFORM public.seed_tenant_foundation(v_tenant_id);

    -- 30 sản phẩm cà phê retail/wholesale mẫu
    PERFORM public.seed_demo_products(v_tenant_id);
  ELSE
    RAISE NOTICE 'Tenant đã tồn tại: %', v_tenant_id;
    -- Lấy store1 = default branch hoặc store đầu tiên
    SELECT id INTO v_store1_id FROM public.branches
      WHERE tenant_id = v_tenant_id AND is_active = true
      ORDER BY is_default DESC, created_at ASC LIMIT 1;
    -- Nếu branch default không phải store, update nó thành store
    UPDATE public.branches
      SET branch_type = 'store',
          name = 'Quán Cà Phê Quận 1',
          code = 'CN-Q1',
          address = '123 Nguyễn Huệ, Quận 1, TP.HCM',
          phone = '0901234567'
      WHERE id = v_store1_id AND branch_type <> 'store';
  END IF;

  v_created_by := COALESCE(
    (SELECT id FROM public.profiles WHERE id = v_user_id),
    (SELECT id FROM public.profiles WHERE role IN ('admin','owner') AND is_active = true ORDER BY created_at LIMIT 1),
    (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1)
  );
  -- Redirect any remaining v_user_id usage (cashier_id, etc.) to the valid profile
  v_user_id := v_created_by;

  -- ============================================================
  -- PART 2: Thêm branches: Factory + Warehouse + 2 stores
  -- ============================================================
  RAISE NOTICE '=== PART 2: Thêm 4 branches (factory, warehouse, Q2, Q3) ===';

  -- Xưởng rang
  SELECT id INTO v_factory_id FROM public.branches
    WHERE tenant_id = v_tenant_id AND code = 'CN-XR';
  IF v_factory_id IS NULL THEN
    INSERT INTO public.branches (tenant_id, name, branch_type, code, address, phone, is_default, is_active)
    VALUES (v_tenant_id, 'Xưởng Rang Cà Phê', 'factory', 'CN-XR',
            '45 Đường Lê Thị Riêng, Tân Phú, TP.HCM', '0281234567', false, true)
    RETURNING id INTO v_factory_id;
  END IF;

  -- Kho tổng
  SELECT id INTO v_warehouse_id FROM public.branches
    WHERE tenant_id = v_tenant_id AND code = 'CN-KT';
  IF v_warehouse_id IS NULL THEN
    INSERT INTO public.branches (tenant_id, name, branch_type, code, address, phone, is_default, is_active)
    VALUES (v_tenant_id, 'Kho Tổng', 'warehouse', 'CN-KT',
            '88 Quốc Lộ 1A, Bình Tân, TP.HCM', '0287654321', false, true)
    RETURNING id INTO v_warehouse_id;
  END IF;

  -- Quán Thủ Đức
  SELECT id INTO v_store2_id FROM public.branches
    WHERE tenant_id = v_tenant_id AND code = 'CN-Q2';
  IF v_store2_id IS NULL THEN
    INSERT INTO public.branches (tenant_id, name, branch_type, code, address, phone, is_default, is_active)
    VALUES (v_tenant_id, 'Quán Cà Phê Thủ Đức', 'store', 'CN-Q2',
            '456 Võ Văn Ngân, Thủ Đức, TP.HCM', '0902345678', false, true)
    RETURNING id INTO v_store2_id;
  END IF;

  -- Quán Bình Thạnh
  SELECT id INTO v_store3_id FROM public.branches
    WHERE tenant_id = v_tenant_id AND code = 'CN-Q3';
  IF v_store3_id IS NULL THEN
    INSERT INTO public.branches (tenant_id, name, branch_type, code, address, phone, is_default, is_active)
    VALUES (v_tenant_id, 'Quán Cà Phê Bình Thạnh', 'store', 'CN-Q3',
            '789 Xô Viết Nghệ Tĩnh, Bình Thạnh, TP.HCM', '0903456789', false, true)
    RETURNING id INTO v_store3_id;
  END IF;

  -- Seed internal customers/suppliers cho các branch (chỉ nếu đã apply Phase 1 migration)
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'seed_internal_entities'
  ) THEN
    PERFORM public.seed_internal_entities(v_tenant_id);
  ELSE
    RAISE NOTICE 'seed_internal_entities() chua ton tai — bo qua (Phase 1 chua ap dung)';
  END IF;

  RAISE NOTICE 'Branches: factory=%, warehouse=%, store1=%, store2=%, store3=%',
    v_factory_id, v_warehouse_id, v_store1_id, v_store2_id, v_store3_id;

  -- ============================================================
  -- PART 3: Thêm FnB categories (scope='sku') cho menu quán
  -- ============================================================
  RAISE NOTICE '=== PART 3: FnB categories + products ===';

  INSERT INTO public.categories (tenant_id, name, code, scope, sort_order) VALUES
    (v_tenant_id, 'Cà phê pha máy',  'FCA', 'sku', 101),
    (v_tenant_id, 'Trà & Trà sữa',   'FTR', 'sku', 102),
    (v_tenant_id, 'Sinh tố & Đá xay','FSV', 'sku', 103),
    (v_tenant_id, 'Đá xay Frappe',   'FDA', 'sku', 104),
    (v_tenant_id, 'Nước ép tươi',    'FNE', 'sku', 105),
    (v_tenant_id, 'Bánh ngọt',       'FBG', 'sku', 106),
    (v_tenant_id, 'Đồ ăn nhẹ',       'FAN', 'sku', 107),
    (v_tenant_id, 'Combo khuyến mãi','FKM', 'sku', 108)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_cat_fca FROM public.categories WHERE tenant_id = v_tenant_id AND code = 'FCA' AND scope = 'sku';
  SELECT id INTO v_cat_ftr FROM public.categories WHERE tenant_id = v_tenant_id AND code = 'FTR' AND scope = 'sku';
  SELECT id INTO v_cat_fsv FROM public.categories WHERE tenant_id = v_tenant_id AND code = 'FSV' AND scope = 'sku';
  SELECT id INTO v_cat_fda FROM public.categories WHERE tenant_id = v_tenant_id AND code = 'FDA' AND scope = 'sku';
  SELECT id INTO v_cat_fne FROM public.categories WHERE tenant_id = v_tenant_id AND code = 'FNE' AND scope = 'sku';
  SELECT id INTO v_cat_fbg FROM public.categories WHERE tenant_id = v_tenant_id AND code = 'FBG' AND scope = 'sku';
  SELECT id INTO v_cat_fan FROM public.categories WHERE tenant_id = v_tenant_id AND code = 'FAN' AND scope = 'sku';
  SELECT id INTO v_cat_fkm FROM public.categories WHERE tenant_id = v_tenant_id AND code = 'FKM' AND scope = 'sku';

  -- ============================================================
  -- PART 4: FnB Menu (50 sản phẩm bán tại quán)
  -- Tất cả product_type='sku', allow_sale=true để hiện trong POS FnB
  -- ============================================================
  INSERT INTO public.products
    (tenant_id, code, name, category_id, product_type, has_bom, unit, purchase_unit, stock_unit, sell_unit,
     cost_price, sell_price, stock, min_stock, max_stock, group_code, is_active, allow_sale)
  VALUES
    -- Cà phê pha máy (FCA) — 12 items
    (v_tenant_id, 'FCA-001', 'Cà Phê Đen Đá',                 v_cat_fca, 'sku', true, 'Ly','Ly','Ly','Ly', 8000,  25000, 0,0,0, 'FCA', true, true),
    (v_tenant_id, 'FCA-002', 'Cà Phê Sữa Đá',                 v_cat_fca, 'sku', true, 'Ly','Ly','Ly','Ly', 10000, 29000, 0,0,0, 'FCA', true, true),
    (v_tenant_id, 'FCA-003', 'Bạc Xỉu',                       v_cat_fca, 'sku', true, 'Ly','Ly','Ly','Ly', 11000, 32000, 0,0,0, 'FCA', true, true),
    (v_tenant_id, 'FCA-004', 'Espresso',                      v_cat_fca, 'sku', true, 'Ly','Ly','Ly','Ly', 9000,  35000, 0,0,0, 'FCA', true, true),
    (v_tenant_id, 'FCA-005', 'Americano',                     v_cat_fca, 'sku', true, 'Ly','Ly','Ly','Ly', 9000,  35000, 0,0,0, 'FCA', true, true),
    (v_tenant_id, 'FCA-006', 'Cappuccino',                    v_cat_fca, 'sku', true, 'Ly','Ly','Ly','Ly', 13000, 45000, 0,0,0, 'FCA', true, true),
    (v_tenant_id, 'FCA-007', 'Latte',                         v_cat_fca, 'sku', true, 'Ly','Ly','Ly','Ly', 13000, 45000, 0,0,0, 'FCA', true, true),
    (v_tenant_id, 'FCA-008', 'Mocha',                         v_cat_fca, 'sku', true, 'Ly','Ly','Ly','Ly', 14000, 49000, 0,0,0, 'FCA', true, true),
    (v_tenant_id, 'FCA-009', 'Caramel Macchiato',             v_cat_fca, 'sku', true, 'Ly','Ly','Ly','Ly', 14000, 55000, 0,0,0, 'FCA', true, true),
    (v_tenant_id, 'FCA-010', 'Coldbrew Đen',                  v_cat_fca, 'sku', true, 'Ly','Ly','Ly','Ly', 12000, 42000, 0,0,0, 'FCA', true, true),
    (v_tenant_id, 'FCA-011', 'Coldbrew Sữa Dừa',              v_cat_fca, 'sku', true, 'Ly','Ly','Ly','Ly', 14000, 48000, 0,0,0, 'FCA', true, true),
    (v_tenant_id, 'FCA-012', 'Cà Phê Trứng',                  v_cat_fca, 'sku', true, 'Ly','Ly','Ly','Ly', 13000, 45000, 0,0,0, 'FCA', true, true),

    -- Trà & Trà sữa (FTR) — 10 items
    (v_tenant_id, 'FTR-001', 'Trà Đào Cam Sả',                v_cat_ftr, 'sku', true, 'Ly','Ly','Ly','Ly', 12000, 42000, 0,0,0, 'FTR', true, true),
    (v_tenant_id, 'FTR-002', 'Trà Vải Hoa Hồng',              v_cat_ftr, 'sku', true, 'Ly','Ly','Ly','Ly', 12000, 42000, 0,0,0, 'FTR', true, true),
    (v_tenant_id, 'FTR-003', 'Trà Sen Vàng',                  v_cat_ftr, 'sku', true, 'Ly','Ly','Ly','Ly', 11000, 39000, 0,0,0, 'FTR', true, true),
    (v_tenant_id, 'FTR-004', 'Hồng Trà Sữa Trân Châu',        v_cat_ftr, 'sku', true, 'Ly','Ly','Ly','Ly', 13000, 45000, 0,0,0, 'FTR', true, true),
    (v_tenant_id, 'FTR-005', 'Ô Long Sữa Kem Phô Mai',        v_cat_ftr, 'sku', true, 'Ly','Ly','Ly','Ly', 15000, 52000, 0,0,0, 'FTR', true, true),
    (v_tenant_id, 'FTR-006', 'Trà Xanh Matcha Đá Xay',        v_cat_ftr, 'sku', true, 'Ly','Ly','Ly','Ly', 16000, 58000, 0,0,0, 'FTR', true, true),
    (v_tenant_id, 'FTR-007', 'Trà Thái Xanh',                 v_cat_ftr, 'sku', true, 'Ly','Ly','Ly','Ly', 11000, 38000, 0,0,0, 'FTR', true, true),
    (v_tenant_id, 'FTR-008', 'Trà Gừng Nóng',                 v_cat_ftr, 'sku', true, 'Ly','Ly','Ly','Ly', 8000,  29000, 0,0,0, 'FTR', true, true),
    (v_tenant_id, 'FTR-009', 'Trà Sữa Truyền Thống',          v_cat_ftr, 'sku', true, 'Ly','Ly','Ly','Ly', 12000, 39000, 0,0,0, 'FTR', true, true),
    (v_tenant_id, 'FTR-010', 'Trà Tắc',                       v_cat_ftr, 'sku', true, 'Ly','Ly','Ly','Ly', 7000,  25000, 0,0,0, 'FTR', true, true),

    -- Sinh tố & Đá xay (FSV) — 6 items
    (v_tenant_id, 'FSV-001', 'Sinh Tố Bơ',                    v_cat_fsv, 'sku', true, 'Ly','Ly','Ly','Ly', 14000, 45000, 0,0,0, 'FSV', true, true),
    (v_tenant_id, 'FSV-002', 'Sinh Tố Xoài',                  v_cat_fsv, 'sku', true, 'Ly','Ly','Ly','Ly', 13000, 42000, 0,0,0, 'FSV', true, true),
    (v_tenant_id, 'FSV-003', 'Sinh Tố Dâu',                   v_cat_fsv, 'sku', true, 'Ly','Ly','Ly','Ly', 14000, 45000, 0,0,0, 'FSV', true, true),
    (v_tenant_id, 'FSV-004', 'Sinh Tố Chuối Bơ',              v_cat_fsv, 'sku', true, 'Ly','Ly','Ly','Ly', 14000, 45000, 0,0,0, 'FSV', true, true),
    (v_tenant_id, 'FSV-005', 'Yaourt Việt Quất',              v_cat_fsv, 'sku', true, 'Ly','Ly','Ly','Ly', 15000, 48000, 0,0,0, 'FSV', true, true),
    (v_tenant_id, 'FSV-006', 'Yaourt Đá Dâu',                 v_cat_fsv, 'sku', true, 'Ly','Ly','Ly','Ly', 14000, 45000, 0,0,0, 'FSV', true, true),

    -- Đá xay Frappe (FDA) — 5 items
    (v_tenant_id, 'FDA-001', 'Cà Phê Đá Xay Kem',             v_cat_fda, 'sku', true, 'Ly','Ly','Ly','Ly', 16000, 55000, 0,0,0, 'FDA', true, true),
    (v_tenant_id, 'FDA-002', 'Chocolate Đá Xay',              v_cat_fda, 'sku', true, 'Ly','Ly','Ly','Ly', 15000, 52000, 0,0,0, 'FDA', true, true),
    (v_tenant_id, 'FDA-003', 'Matcha Đá Xay',                 v_cat_fda, 'sku', true, 'Ly','Ly','Ly','Ly', 16000, 58000, 0,0,0, 'FDA', true, true),
    (v_tenant_id, 'FDA-004', 'Coffee Oreo Đá Xay',            v_cat_fda, 'sku', true, 'Ly','Ly','Ly','Ly', 17000, 59000, 0,0,0, 'FDA', true, true),
    (v_tenant_id, 'FDA-005', 'Dâu Đá Xay',                    v_cat_fda, 'sku', true, 'Ly','Ly','Ly','Ly', 15000, 52000, 0,0,0, 'FDA', true, true),

    -- Nước ép tươi (FNE) — 5 items
    (v_tenant_id, 'FNE-001', 'Nước Ép Cam',                   v_cat_fne, 'sku', false,'Ly','Ly','Ly','Ly', 12000, 38000, 0,0,0, 'FNE', true, true),
    (v_tenant_id, 'FNE-002', 'Nước Ép Dứa',                   v_cat_fne, 'sku', false,'Ly','Ly','Ly','Ly', 10000, 35000, 0,0,0, 'FNE', true, true),
    (v_tenant_id, 'FNE-003', 'Nước Ép Dưa Hấu',               v_cat_fne, 'sku', false,'Ly','Ly','Ly','Ly', 10000, 35000, 0,0,0, 'FNE', true, true),
    (v_tenant_id, 'FNE-004', 'Nước Ép Cà Rốt Táo',            v_cat_fne, 'sku', false,'Ly','Ly','Ly','Ly', 11000, 38000, 0,0,0, 'FNE', true, true),
    (v_tenant_id, 'FNE-005', 'Nước Ép Detox Xanh',            v_cat_fne, 'sku', false,'Ly','Ly','Ly','Ly', 14000, 45000, 0,0,0, 'FNE', true, true),

    -- Bánh ngọt (FBG) — 6 items
    (v_tenant_id, 'FBG-001', 'Bánh Tiramisu',                 v_cat_fbg, 'sku', false,'Cái','Cái','Cái','Cái', 18000, 45000, 0,0,0, 'FBG', true, true),
    (v_tenant_id, 'FBG-002', 'Bánh Mousse Chanh Dây',         v_cat_fbg, 'sku', false,'Cái','Cái','Cái','Cái', 17000, 42000, 0,0,0, 'FBG', true, true),
    (v_tenant_id, 'FBG-003', 'Bánh Chocolate Lava',           v_cat_fbg, 'sku', false,'Cái','Cái','Cái','Cái', 19000, 48000, 0,0,0, 'FBG', true, true),
    (v_tenant_id, 'FBG-004', 'Croissant Bơ',                  v_cat_fbg, 'sku', false,'Cái','Cái','Cái','Cái', 12000, 32000, 0,0,0, 'FBG', true, true),
    (v_tenant_id, 'FBG-005', 'Muffin Việt Quất',              v_cat_fbg, 'sku', false,'Cái','Cái','Cái','Cái', 13000, 35000, 0,0,0, 'FBG', true, true),
    (v_tenant_id, 'FBG-006', 'Cookies Chocolate Chip',        v_cat_fbg, 'sku', false,'Cái','Cái','Cái','Cái', 8000,  22000, 0,0,0, 'FBG', true, true),

    -- Đồ ăn nhẹ (FAN) — 4 items
    (v_tenant_id, 'FAN-001', 'Bánh Mì Trứng Ốp La',           v_cat_fan, 'sku', false,'Cái','Cái','Cái','Cái', 15000, 35000, 0,0,0, 'FAN', true, true),
    (v_tenant_id, 'FAN-002', 'Mì Ý Sốt Bò Bằm',               v_cat_fan, 'sku', false,'Phần','Phần','Phần','Phần', 35000, 79000, 0,0,0, 'FAN', true, true),
    (v_tenant_id, 'FAN-003', 'Khoai Tây Chiên',               v_cat_fan, 'sku', false,'Phần','Phần','Phần','Phần', 12000, 35000, 0,0,0, 'FAN', true, true),
    (v_tenant_id, 'FAN-004', 'Gà Nướng BBQ + Cơm',            v_cat_fan, 'sku', false,'Phần','Phần','Phần','Phần', 45000, 89000, 0,0,0, 'FAN', true, true),

    -- Combo khuyến mãi (FKM) — 3 items
    (v_tenant_id, 'FKM-001', 'Combo Sáng (Cà Phê + Bánh Mì)', v_cat_fkm, 'sku', false,'Combo','Combo','Combo','Combo', 22000, 55000, 0,0,0, 'FKM', true, true),
    (v_tenant_id, 'FKM-002', 'Combo Chiều (2 Cà Phê)',        v_cat_fkm, 'sku', false,'Combo','Combo','Combo','Combo', 18000, 49000, 0,0,0, 'FKM', true, true),
    (v_tenant_id, 'FKM-003', 'Combo Đôi Bạn',                 v_cat_fkm, 'sku', false,'Combo','Combo','Combo','Combo', 28000, 79000, 0,0,0, 'FKM', true, true)

  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- Gắn channel='fnb' cho toàn bộ menu FnB vừa insert (code bắt đầu F*).
  -- Khớp với migration 00024: SKU có category code F* → channel='fnb'.
  UPDATE public.products
    SET channel = 'fnb'
    WHERE tenant_id = v_tenant_id
      AND product_type = 'sku'
      AND code LIKE 'F%'
      AND channel IS NULL;

  -- ============================================================
  -- PART 5: Thêm Toppings (product_type='nvl', code NVL-TOP%) với allow_sale=true
  -- FnB POS query: .eq("is_active", true).ilike("code", "NVL-TOP%")
  -- ============================================================
  -- Update trân châu đã có thành allow_sale=true
  UPDATE public.products
    SET allow_sale = true, sell_price = 8000
    WHERE tenant_id = v_tenant_id AND code IN ('NVL-TOP-001','NVL-TOP-002');

  INSERT INTO public.products
    (tenant_id, code, name, category_id, product_type, has_bom, unit, purchase_unit, stock_unit, sell_unit,
     cost_price, sell_price, stock, min_stock, max_stock, group_code, is_active, allow_sale)
  SELECT v_tenant_id, code, name, cat_id, 'nvl', false, 'Phần', 'Phần', 'Phần', 'Phần',
         cost, price, 0, 0, 0, 'TOP', true, true
  FROM (VALUES
    ('NVL-TOP-003', 'Trân châu trắng',       3000,  8000),
    ('NVL-TOP-004', 'Thạch củ năng',         3000,  8000),
    ('NVL-TOP-005', 'Thạch phô mai',         4000, 10000),
    ('NVL-TOP-006', 'Kem phô mai macchiato', 5000, 12000),
    ('NVL-TOP-007', 'Sương sáo',             3000,  8000),
    ('NVL-TOP-008', 'Pudding trứng',         4000, 10000),
    ('NVL-TOP-009', 'Hạt đác',               3000,  8000),
    ('NVL-TOP-010', 'Thạch dừa',             3000,  8000)
  ) t(code, name, cost, price)
  CROSS JOIN (SELECT id AS cat_id FROM public.categories WHERE tenant_id = v_tenant_id AND scope = 'nvl' AND code = 'TOP' LIMIT 1) c
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- ============================================================
  -- PART 6: Restaurant tables — 15 bàn cho mỗi quán
  -- ============================================================
  RAISE NOTICE '=== PART 6: Restaurant tables ===';

  FOREACH v_b IN ARRAY ARRAY[v_store1_id, v_store2_id, v_store3_id]
  LOOP
    -- Skip nếu quán này đã có bàn
    IF EXISTS (SELECT 1 FROM public.restaurant_tables WHERE tenant_id = v_tenant_id AND branch_id = v_b LIMIT 1) THEN
      CONTINUE;
    END IF;

    -- Tầng 1: 6 bàn
    INSERT INTO public.restaurant_tables (tenant_id, branch_id, table_number, name, zone, capacity, sort_order, status)
    VALUES
      (v_tenant_id, v_b,  1, 'Bàn 1',  'Tầng 1', 2,  1, 'available'),
      (v_tenant_id, v_b,  2, 'Bàn 2',  'Tầng 1', 4,  2, 'available'),
      (v_tenant_id, v_b,  3, 'Bàn 3',  'Tầng 1', 4,  3, 'available'),
      (v_tenant_id, v_b,  4, 'Bàn 4',  'Tầng 1', 6,  4, 'available'),
      (v_tenant_id, v_b,  5, 'Bàn 5',  'Tầng 1', 2,  5, 'available'),
      (v_tenant_id, v_b,  6, 'Bàn 6',  'Tầng 1', 4,  6, 'available'),
      -- Tầng 2: 5 bàn
      (v_tenant_id, v_b, 11, 'Bàn 11', 'Tầng 2', 4, 11, 'available'),
      (v_tenant_id, v_b, 12, 'Bàn 12', 'Tầng 2', 4, 12, 'available'),
      (v_tenant_id, v_b, 13, 'Bàn 13', 'Tầng 2', 6, 13, 'available'),
      (v_tenant_id, v_b, 14, 'Bàn 14', 'Tầng 2', 2, 14, 'available'),
      (v_tenant_id, v_b, 15, 'Bàn 15', 'Tầng 2', 8, 15, 'available'),
      -- Ngoài trời: 4 bàn
      (v_tenant_id, v_b, 21, 'Sân 1',  'Ngoài trời', 4, 21, 'available'),
      (v_tenant_id, v_b, 22, 'Sân 2',  'Ngoài trời', 4, 22, 'available'),
      (v_tenant_id, v_b, 23, 'Sân 3',  'Ngoài trời', 2, 23, 'available'),
      (v_tenant_id, v_b, 24, 'Sân 4',  'Ngoài trời', 6, 24, 'available')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ============================================================
  -- PART 7: Customers (20 KH mẫu)
  -- ============================================================
  RAISE NOTICE '=== PART 7: Customers ===';

  INSERT INTO public.customers (tenant_id, code, name, phone, email, address, customer_type, gender, is_active,
                                 loyalty_points, total_spent, total_orders)
  VALUES
    (v_tenant_id, 'KH-001', 'Nguyễn Văn An',       '0901111111', 'an.nguyen@mail.com',    '123 Lê Lợi, Q1',     'individual', 'male',   true, 250,  2500000, 15),
    (v_tenant_id, 'KH-002', 'Trần Thị Bình',       '0901111112', 'binh.tran@mail.com',    '456 Hai Bà Trưng, Q3', 'individual', 'female', true, 520,  5200000, 42),
    (v_tenant_id, 'KH-003', 'Lê Văn Cường',        '0901111113', 'cuong.le@mail.com',     '789 Nguyễn Thị Minh Khai, Q3', 'individual', 'male',   true, 180,  1800000, 11),
    (v_tenant_id, 'KH-004', 'Phạm Thị Dung',       '0901111114', 'dung.pham@mail.com',    '12 Võ Thị Sáu, Q3',  'individual', 'female', true, 1250, 12500000, 85),
    (v_tenant_id, 'KH-005', 'Hoàng Minh Em',       '0901111115', 'em.hoang@mail.com',     '34 Trần Hưng Đạo, Q5', 'individual', 'male',   true, 90,   900000,  6),
    (v_tenant_id, 'KH-006', 'Vũ Thị Phượng',       '0901111116', 'phuong.vu@mail.com',    '56 Cách Mạng Tháng 8, Q10', 'individual', 'female', true, 340,  3400000, 22),
    (v_tenant_id, 'KH-007', 'Đặng Văn Giang',      '0901111117', 'giang.dang@mail.com',   '78 Lý Thường Kiệt, Q10', 'individual', 'male',   true, 410,  4100000, 28),
    (v_tenant_id, 'KH-008', 'Bùi Thị Hồng',        '0901111118', 'hong.bui@mail.com',     '90 Nguyễn Văn Cừ, Q5', 'individual', 'female', true, 680,  6800000, 51),
    (v_tenant_id, 'KH-009', 'Công ty TNHH ABC',    '0287000001', 'contact@abc.vn',        'Tòa nhà ABC, Q1',    'company',    null,     true, 0,    8500000, 12),
    (v_tenant_id, 'KH-010', 'Công ty CP XYZ',      '0287000002', 'sales@xyz.vn',          'Tòa nhà XYZ, Q7',    'company',    null,     true, 0,    12000000, 18),
    (v_tenant_id, 'KH-011', 'Quán Coffee Kite',    '0287000003', 'order@kite.cafe',       '22 Lê Thánh Tôn, Q1', 'company',    null,     true, 0,    18500000, 45),
    (v_tenant_id, 'KH-012', 'Ngô Thị Kim',         '0901111119', 'kim.ngo@mail.com',      '11 Pasteur, Q1',     'individual', 'female', true, 55,   550000,  4),
    (v_tenant_id, 'KH-013', 'Lý Văn Long',         '0901111120', 'long.ly@mail.com',      '33 Điện Biên Phủ, Q3', 'individual', 'male',   true, 210,  2100000, 14),
    (v_tenant_id, 'KH-014', 'Trương Thị Mai',      '0901111121', 'mai.truong@mail.com',   '55 Nguyễn Trãi, Q1', 'individual', 'female', true, 175,  1750000, 12),
    (v_tenant_id, 'KH-015', 'Đỗ Văn Nam',          '0901111122', 'nam.do@mail.com',       '77 Nam Kỳ Khởi Nghĩa, Q3', 'individual', 'male',   true, 320,  3200000, 21),
    (v_tenant_id, 'KH-016', 'Cafe Reading Room',   '0287000004', 'hello@reading.vn',      '99 Phan Đình Phùng, PN', 'company',    null,     true, 0,    22000000, 55),
    (v_tenant_id, 'KH-017', 'Vũ Quang Oanh',       '0901111123', 'oanh.vu@mail.com',      '111 Võ Văn Tần, Q3', 'individual', 'female', true, 88,   880000,  7),
    (v_tenant_id, 'KH-018', 'Hồ Thị Phi',          '0901111124', 'phi.ho@mail.com',       '222 Nguyễn Đình Chiểu, Q3', 'individual', 'female', true, 145,  1450000, 10),
    (v_tenant_id, 'KH-019', 'Văn phòng Hiệp Phước','0287000005', 'office@hp.com.vn',      'KCN Hiệp Phước, Nhà Bè', 'company',    null,     true, 0,    6200000, 9),
    (v_tenant_id, 'KH-020', 'Khách Lẻ',            null,         null,                    null,                 'individual', null,     true, 0,    0,       0)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- ============================================================
  -- PART 8: Suppliers (12 NCC mẫu)
  -- ============================================================
  RAISE NOTICE '=== PART 8: Suppliers ===';

  INSERT INTO public.suppliers (tenant_id, code, name, phone, email, address, tax_code, is_active)
  VALUES
    (v_tenant_id, 'NCC-CPH-001', 'NCC Cà Phê Cầu Đất',       '0261345678', 'ceo@caudat.coffee',     'Đà Lạt, Lâm Đồng',      '5400123456', true),
    (v_tenant_id, 'NCC-CPH-002', 'NCC Cà Phê Buôn Ma Thuột', '0262456789', 'sales@bmt-coffee.vn',   'Buôn Ma Thuột, Đắk Lắk','5400234567', true),
    (v_tenant_id, 'NCC-SUA-001', 'NCC Sữa TH True Milk',     '0243123456', 'hcm@thmilk.com.vn',     '88 Nguyễn Đình Chiểu',  '0100123321', true),
    (v_tenant_id, 'NCC-SUA-002', 'NCC Sữa Vinamilk',         '0283456789', 'wholesale@vinamilk.com.vn','Tòa nhà Vinamilk, Q7','0100456123', true),
    (v_tenant_id, 'NCC-BAO-001', 'NCC Bao Bì Tấn Phát',      '0289876543', 'order@tpbao.com',       'KCN Vĩnh Lộc, Bình Chánh','0315123456', true),
    (v_tenant_id, 'NCC-SST-001', 'NCC Monin Việt Nam',       '0283345678', 'hn@monin.com.vn',       '10 Nguyễn Huệ, Q1',     '0100789456', true),
    (v_tenant_id, 'NCC-SST-002', 'NCC Torani Wholesale',     '0283445567', 'vn@torani.com',         'KCN Tân Thuận, Q7',     '0100654321', true),
    (v_tenant_id, 'NCC-TRA-001', 'NCC Trà Thái Nguyên',      '0208123456', 'sales@thai-tea.vn',     'TP. Thái Nguyên',       '4600123456', true),
    (v_tenant_id, 'NCC-BOT-001', 'NCC Bột Matcha Nhật',      '0283123446', 'japan@matcha-vn.com',   '20 Lê Duẩn, Q1',        '0100321654', true),
    (v_tenant_id, 'NCC-TOP-001', 'NCC Trân Châu Đài Loan',   '0287654321', 'tw@pearl.com.vn',       'KCN Tân Bình, TB',      '0100987654', true),
    (v_tenant_id, 'NCC-DCU-001', 'NCC Dụng Cụ HoReCa',       '0287778899', 'sales@horeca.vn',       '30 Điện Biên Phủ, Q3',  '0100111222', true),
    (v_tenant_id, 'NCC-KHA-001', 'NCC Tổng Hợp Miền Nam',    '0283001122', 'info@mienb.vn',         'Chợ An Đông, Q5',       '0100333444', true)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- ============================================================
  -- PART 9: Branch Stock — phân tồn kho hợp lý giữa các chi nhánh
  -- ============================================================
  RAISE NOTICE '=== PART 9: Branch stock ===';

  -- Factory (xưởng rang): có nhiều NVL cà phê
  INSERT INTO public.branch_stock (tenant_id, branch_id, product_id, quantity)
  SELECT v_tenant_id, v_factory_id, p.id,
         CASE p.group_code
           WHEN 'CPH' THEN 500  -- hạt cà phê thô
           WHEN 'BAO' THEN 80
           ELSE 20
         END
    FROM public.products p
   WHERE p.tenant_id = v_tenant_id
     AND p.product_type = 'nvl'
     AND p.group_code IN ('CPH', 'BAO')
  ON CONFLICT (branch_id, product_id, variant_id) DO UPDATE
    SET quantity = EXCLUDED.quantity;

  -- Factory cũng giữ 1 số thành phẩm rang xay vừa làm
  INSERT INTO public.branch_stock (tenant_id, branch_id, product_id, quantity)
  SELECT v_tenant_id, v_factory_id, p.id, 100
    FROM public.products p
   WHERE p.tenant_id = v_tenant_id
     AND p.group_code = 'RXA'
  ON CONFLICT (branch_id, product_id, variant_id) DO UPDATE
    SET quantity = EXCLUDED.quantity;

  -- Warehouse (kho tổng): có tất cả NVL ở mức trung bình cao + SKU retail
  INSERT INTO public.branch_stock (tenant_id, branch_id, product_id, quantity)
  SELECT v_tenant_id, v_warehouse_id, p.id,
         CASE
           WHEN p.product_type = 'nvl' THEN 200
           WHEN p.group_code = 'RXA' THEN 300
           ELSE 150
         END
    FROM public.products p
   WHERE p.tenant_id = v_tenant_id
     AND (p.product_type = 'nvl' OR p.group_code IN ('RXA','CPC','TRB','BOD','PHU','KIT'))
  ON CONFLICT (branch_id, product_id, variant_id) DO UPDATE
    SET quantity = EXCLUDED.quantity;

  -- Stores (3 quán): mỗi quán có NVL pha chế + topping
  -- Xoá branch_stock cũ của stores để tránh duplicate khi variant_id IS NULL (NULLS DISTINCT)
  DELETE FROM public.branch_stock
   WHERE tenant_id = v_tenant_id
     AND branch_id IN (v_store1_id, v_store2_id, v_store3_id)
     AND variant_id IS NULL;

  FOREACH v_b IN ARRAY ARRAY[v_store1_id, v_store2_id, v_store3_id]
  LOOP
    INSERT INTO public.branch_stock (tenant_id, branch_id, product_id, quantity)
    SELECT v_tenant_id, v_b, p.id,
           CASE
             WHEN p.group_code = 'TOP' THEN 30  -- topping
             WHEN p.group_code = 'CPH' THEN 15  -- hạt cà phê
             WHEN p.group_code = 'SUA' THEN 25  -- sữa
             WHEN p.group_code = 'SST' THEN 12  -- syrup
             WHEN p.group_code = 'BOT' THEN 8   -- bột
             WHEN p.group_code = 'TRA' THEN 10  -- trà
             WHEN p.group_code = 'BAO' THEN 20
             WHEN p.product_type = 'sku' AND p.category_id IN (v_cat_fca, v_cat_ftr, v_cat_fsv, v_cat_fda, v_cat_fne, v_cat_fbg, v_cat_fan, v_cat_fkm) THEN 999 -- menu items don't track stock
             ELSE 0
           END
      FROM public.products p
     WHERE p.tenant_id = v_tenant_id
    ON CONFLICT (branch_id, product_id, variant_id) DO UPDATE
      SET quantity = EXCLUDED.quantity;
  END LOOP;

  -- ============================================================
  -- PART 10: BOMs (3 công thức sản xuất mẫu)
  -- ============================================================
  RAISE NOTICE '=== PART 10: BOMs + production orders ===';

  -- BOM 1: Cà phê Phin 250g (rang từ NVL-CPH-002)
  SELECT id INTO v_prod_id FROM public.products WHERE tenant_id = v_tenant_id AND code = 'SKU-RXA-001';
  IF v_prod_id IS NOT NULL THEN
    INSERT INTO public.bom (tenant_id, product_id, code, name, batch_size, yield_qty, yield_unit, is_active)
    VALUES (v_tenant_id, v_prod_id, 'BOM-RXA-001', 'Phin Truyền Thống 250g — Rang Robusta', 1, 1, 'túi', true)
    ON CONFLICT (tenant_id, code) DO NOTHING
    RETURNING id INTO v_bom_id;

    IF v_bom_id IS NOT NULL THEN
      INSERT INTO public.bom_items (bom_id, material_id, quantity, unit, sort_order)
      SELECT v_bom_id, id, 0.28, 'Kg', 1 FROM public.products WHERE tenant_id = v_tenant_id AND code = 'NVL-CPH-002';

      INSERT INTO public.bom_items (bom_id, material_id, quantity, unit, sort_order)
      SELECT v_bom_id, id, 1, 'Lốc', 2 FROM public.products WHERE tenant_id = v_tenant_id AND code = 'NVL-BAO-001';
    END IF;
  END IF;

  -- BOM 2: Espresso Blend 500g
  SELECT id INTO v_prod_id FROM public.products WHERE tenant_id = v_tenant_id AND code = 'SKU-RXA-002';
  IF v_prod_id IS NOT NULL THEN
    INSERT INTO public.bom (tenant_id, product_id, code, name, batch_size, yield_qty, yield_unit, is_active)
    VALUES (v_tenant_id, v_prod_id, 'BOM-RXA-002', 'Espresso Blend 500g — Arabica + Robusta', 1, 1, 'túi', true)
    ON CONFLICT (tenant_id, code) DO NOTHING
    RETURNING id INTO v_bom_id;

    IF v_bom_id IS NOT NULL THEN
      INSERT INTO public.bom_items (bom_id, material_id, quantity, unit, sort_order)
      SELECT v_bom_id, id, 0.30, 'Kg', 1 FROM public.products WHERE tenant_id = v_tenant_id AND code = 'NVL-CPH-001';
      INSERT INTO public.bom_items (bom_id, material_id, quantity, unit, sort_order)
      SELECT v_bom_id, id, 0.25, 'Kg', 2 FROM public.products WHERE tenant_id = v_tenant_id AND code = 'NVL-CPH-002';
    END IF;
  END IF;

  -- BOM 3: Cà Phê Sữa Đá Chai 350ml
  SELECT id INTO v_prod_id FROM public.products WHERE tenant_id = v_tenant_id AND code = 'SKU-CPC-001';
  IF v_prod_id IS NOT NULL THEN
    INSERT INTO public.bom (tenant_id, product_id, code, name, batch_size, yield_qty, yield_unit, is_active)
    VALUES (v_tenant_id, v_prod_id, 'BOM-CPC-001', 'Cà Phê Sữa Đá Chai 350ml', 1, 1, 'chai', true)
    ON CONFLICT (tenant_id, code) DO NOTHING
    RETURNING id INTO v_bom_id;

    IF v_bom_id IS NOT NULL THEN
      INSERT INTO public.bom_items (bom_id, material_id, quantity, unit, sort_order)
      SELECT v_bom_id, id, 0.025, 'Kg', 1 FROM public.products WHERE tenant_id = v_tenant_id AND code = 'NVL-CPH-002';
      INSERT INTO public.bom_items (bom_id, material_id, quantity, unit, sort_order)
      SELECT v_bom_id, id, 0.08, 'Lon', 2 FROM public.products WHERE tenant_id = v_tenant_id AND code = 'NVL-SUA-001';
    END IF;
  END IF;

  -- ============================================================
  -- PART 11: Production orders (3 lệnh SX — 2 completed, 1 active)
  -- ============================================================
  -- Lệnh 1: Completed 7 ngày trước
  SELECT b.id, p.id INTO v_bom_id, v_prod_id
    FROM public.bom b
    JOIN public.products p ON p.id = b.product_id
   WHERE b.tenant_id = v_tenant_id AND b.code = 'BOM-RXA-001' LIMIT 1;

  IF v_bom_id IS NOT NULL THEN
    INSERT INTO public.production_orders
      (tenant_id, code, branch_id, bom_id, product_id, planned_qty, completed_qty, status,
       lot_number, planned_start, planned_end, actual_start, actual_end, created_by)
    VALUES
      (v_tenant_id, 'SX-000001', v_factory_id, v_bom_id, v_prod_id, 200, 198, 'completed',
       'LOT-RXA-' || to_char(current_date - 7, 'YYMMDD'), current_date - 8, current_date - 7,
       (current_date - 8)::timestamptz + interval '8 hours', (current_date - 7)::timestamptz + interval '14 hours', v_created_by)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  END IF;

  -- Lệnh 2: Completed 3 ngày trước (Espresso)
  SELECT b.id, p.id INTO v_bom_id, v_prod_id
    FROM public.bom b
    JOIN public.products p ON p.id = b.product_id
   WHERE b.tenant_id = v_tenant_id AND b.code = 'BOM-RXA-002' LIMIT 1;

  IF v_bom_id IS NOT NULL THEN
    INSERT INTO public.production_orders
      (tenant_id, code, branch_id, bom_id, product_id, planned_qty, completed_qty, status,
       lot_number, planned_start, planned_end, actual_start, actual_end, created_by)
    VALUES
      (v_tenant_id, 'SX-000002', v_factory_id, v_bom_id, v_prod_id, 150, 150, 'completed',
       'LOT-ESP-' || to_char(current_date - 3, 'YYMMDD'), current_date - 4, current_date - 3,
       (current_date - 4)::timestamptz + interval '7 hours', (current_date - 3)::timestamptz + interval '16 hours', v_created_by)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  END IF;

  -- Lệnh 3: In_production (đang chạy hôm nay)
  SELECT b.id, p.id INTO v_bom_id, v_prod_id
    FROM public.bom b
    JOIN public.products p ON p.id = b.product_id
   WHERE b.tenant_id = v_tenant_id AND b.code = 'BOM-RXA-001' LIMIT 1;

  IF v_bom_id IS NOT NULL THEN
    INSERT INTO public.production_orders
      (tenant_id, code, branch_id, bom_id, product_id, planned_qty, completed_qty, status,
       lot_number, planned_start, planned_end, actual_start, created_by)
    VALUES
      (v_tenant_id, 'SX-000003', v_factory_id, v_bom_id, v_prod_id, 250, 120, 'in_production',
       'LOT-RXA-' || to_char(current_date, 'YYMMDD'), current_date, current_date + 1,
       current_date::timestamptz + interval '8 hours', v_created_by)
    ON CONFLICT (tenant_id, code) DO NOTHING;
  END IF;

  -- ============================================================
  -- PART 12: Product Lots (ghi nhận lot cho production đã hoàn thành)
  -- ============================================================
  SELECT id INTO v_prod_id FROM public.products WHERE tenant_id = v_tenant_id AND code = 'SKU-RXA-001';
  IF v_prod_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.product_lots WHERE tenant_id = v_tenant_id AND product_id = v_prod_id) THEN
    INSERT INTO public.product_lots
      (tenant_id, product_id, lot_number, source_type, manufactured_date, expiry_date,
       received_date, initial_qty, current_qty, branch_id, status)
    VALUES
      (v_tenant_id, v_prod_id, 'LOT-RXA-' || to_char(current_date - 7, 'YYMMDD'), 'production',
       current_date - 7, current_date + 180, current_date - 7, 198, 180, v_factory_id, 'active');
  END IF;

  SELECT id INTO v_prod_id FROM public.products WHERE tenant_id = v_tenant_id AND code = 'SKU-RXA-002';
  IF v_prod_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.product_lots WHERE tenant_id = v_tenant_id AND product_id = v_prod_id) THEN
    INSERT INTO public.product_lots
      (tenant_id, product_id, lot_number, source_type, manufactured_date, expiry_date,
       received_date, initial_qty, current_qty, branch_id, status)
    VALUES
      (v_tenant_id, v_prod_id, 'LOT-ESP-' || to_char(current_date - 3, 'YYMMDD'), 'production',
       current_date - 3, current_date + 180, current_date - 3, 150, 145, v_factory_id, 'active');
  END IF;

  -- ============================================================
  -- PART 13: Loyalty (settings + 3 tiers)
  -- ============================================================
  RAISE NOTICE '=== PART 13: Loyalty settings + tiers ===';

  INSERT INTO public.loyalty_settings
    (tenant_id, is_enabled, points_per_amount, amount_per_point, redemption_points, redemption_value, max_redemption_percent)
  VALUES
    (v_tenant_id, true, 1, 10000, 100, 10000, 50)
  ON CONFLICT (tenant_id) DO UPDATE SET is_enabled = true;

  -- Tiers (idempotent via EXISTS check)
  IF NOT EXISTS (SELECT 1 FROM public.loyalty_tiers WHERE tenant_id = v_tenant_id LIMIT 1) THEN
    INSERT INTO public.loyalty_tiers (tenant_id, name, min_points, discount_percent, sort_order, is_active)
    VALUES
      (v_tenant_id, 'Thành viên',  0,    0,  1, true),
      (v_tenant_id, 'Thân thiết',  200,  5,  2, true),
      (v_tenant_id, 'VIP Kim cương', 1000, 10, 3, true);
  END IF;

  SELECT id INTO v_tier_tv  FROM public.loyalty_tiers WHERE tenant_id = v_tenant_id AND name = 'Thành viên'    LIMIT 1;
  SELECT id INTO v_tier_tt  FROM public.loyalty_tiers WHERE tenant_id = v_tenant_id AND name = 'Thân thiết'    LIMIT 1;
  SELECT id INTO v_tier_vip FROM public.loyalty_tiers WHERE tenant_id = v_tenant_id AND name = 'VIP Kim cương' LIMIT 1;

  -- Gán tier cho customer theo điểm
  UPDATE public.customers SET loyalty_tier_id = v_tier_vip
    WHERE tenant_id = v_tenant_id AND loyalty_points >= 1000;
  UPDATE public.customers SET loyalty_tier_id = v_tier_tt
    WHERE tenant_id = v_tenant_id AND loyalty_points >= 200 AND loyalty_points < 1000;
  UPDATE public.customers SET loyalty_tier_id = v_tier_tv
    WHERE tenant_id = v_tenant_id AND loyalty_points < 200 AND customer_type = 'individual';

  -- ============================================================
  -- PART 14: Coupons + Promotions
  -- ============================================================
  RAISE NOTICE '=== PART 14: Coupons + Promotions ===';

  INSERT INTO public.coupons (tenant_id, code, name, description, type, value,
                              min_order_amount, max_discount_amount, max_uses, used_count,
                              max_uses_per_customer, start_date, end_date, is_active, applies_to)
  VALUES
    (v_tenant_id, 'FREESHIP', 'Miễn phí giao hàng', 'Giảm 20k phí ship', 'fixed', 20000,
     100000, null, 1000, 42, 1, now() - interval '30 days', now() + interval '60 days', true, 'all'),
    (v_tenant_id, 'GIAM10', 'Giảm 10%', 'Giảm 10% toàn bộ đơn hàng', 'percent', 10,
     50000, 50000, 500, 38, 2, now() - interval '15 days', now() + interval '45 days', true, 'all'),
    (v_tenant_id, 'VIP20', 'VIP giảm 20%', 'Dành riêng cho KH VIP', 'percent', 20,
     100000, 100000, 200, 15, 1, now() - interval '10 days', now() + interval '80 days', true, 'all'),
    (v_tenant_id, 'HAPPYHOUR', 'Happy Hour 15%', 'Giảm 15% từ 14h-17h', 'percent', 15,
     0, 30000, null, 120, 5, now() - interval '20 days', now() + interval '100 days', true, 'all')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM public.promotions WHERE tenant_id = v_tenant_id LIMIT 1) THEN
    INSERT INTO public.promotions
      (tenant_id, name, description, type, value, min_order_amount, start_date, end_date,
       is_active, auto_apply, priority)
    VALUES
      (v_tenant_id, 'Mua 2 tặng 1 Combo Đôi', 'Mua 2 Combo Đôi Bạn tặng 1 bánh',
       'buy_x_get_y', 0, 0, now() - interval '7 days', now() + interval '30 days', true, true, 10),
      (v_tenant_id, 'Giảm 25% Cà Phê Đá Xay', 'Áp dụng riêng nhóm Đá xay Frappe',
       'discount_percent', 25, 0, now() - interval '5 days', now() + interval '20 days', true, true, 5),
      (v_tenant_id, 'Đồng Giá 25k Trà Tắc', 'Mỗi ngày T2-T4', 'discount_fixed', 5000, 0,
       now() - interval '14 days', now() + interval '56 days', true, false, 3);
  END IF;

  -- Update buy_x_get_y fields for first promotion
  UPDATE public.promotions SET buy_quantity = 2, get_quantity = 1
    WHERE tenant_id = v_tenant_id AND type = 'buy_x_get_y';

  -- ============================================================
  -- PART 15: Build menu arrays for historical sampling
  -- ============================================================
  RAISE NOTICE '=== PART 15: Chuẩn bị menu arrays cho historical ===';

  SELECT
    array_agg(id ORDER BY code),
    array_agg(sell_price ORDER BY code),
    array_agg(name ORDER BY code)
  INTO v_menu_ids, v_menu_prices, v_menu_names
  FROM public.products
  WHERE tenant_id = v_tenant_id
    AND product_type = 'sku'
    AND code LIKE 'F%-%'
    AND is_active = true;

  IF v_menu_ids IS NULL OR array_length(v_menu_ids, 1) IS NULL THEN
    RAISE NOTICE 'Không có menu FnB để sample, bỏ qua historical invoices';
  ELSE
    RAISE NOTICE 'Menu có % sản phẩm để sample', array_length(v_menu_ids, 1);

    -- Check if historical invoices already exist for this tenant (idempotent)
    SELECT EXISTS (
      SELECT 1 FROM public.invoices
       WHERE tenant_id = v_tenant_id AND source = 'fnb'
       LIMIT 1
    ) INTO v_has_history;

    IF v_has_history THEN
      RAISE NOTICE 'Đã có historical invoices (source=fnb), bỏ qua để tránh duplicate';
    ELSE

    -- ============================================================
    -- PART 16: Historical invoices — 90 ngày × 3 quán × ~4 hoá đơn/ngày
    -- = ~1080 hoá đơn cho demo analytics
    -- ============================================================
    RAISE NOTICE '=== PART 16: Historical invoices (90 ngày) ===';

    v_branch_ids := ARRAY[v_store1_id, v_store2_id, v_store3_id];

    FOR v_day IN
      SELECT generate_series(current_date - 89, current_date - 1, interval '1 day')::date
    LOOP
      FOREACH v_b IN ARRAY v_branch_ids
      LOOP
        -- Shift cho ngày này (1 ca sáng cho mỗi quán)
        INSERT INTO public.shifts
          (tenant_id, branch_id, cashier_id, status, opened_at, closed_at,
           starting_cash, expected_cash, actual_cash, cash_difference, total_sales, total_orders,
           sales_by_method)
        VALUES
          (v_tenant_id, v_b, v_user_id, 'closed',
           v_day::timestamptz + interval '7 hours',
           v_day::timestamptz + interval '22 hours',
           500000, 500000 + 1200000, 500000 + 1180000, -20000, 1200000, 40,
           jsonb_build_object('cash', 750000, 'transfer', 400000, 'card', 50000))
        RETURNING id INTO v_shift_id;

        -- Sinh 3-5 hoá đơn trong ngày
        FOR v_i IN 1..(3 + (random() * 3)::int)
        LOOP
          v_subtotal := 0;
          v_total := 0;

          -- Tạo invoice (dùng next_code)
          INSERT INTO public.invoices
            (tenant_id, branch_id, code, customer_name, status, subtotal, discount_amount, total,
             paid, debt, payment_method, source, shift_id, created_by, created_at, updated_at)
          VALUES
            (v_tenant_id, v_b, public.next_code(v_tenant_id, 'invoice'),
             CASE WHEN random() > 0.85 THEN 'Nguyễn Văn An' ELSE 'Khách lẻ' END,
             'completed', 0, 0, 0, 0, 0,
             (ARRAY['cash','cash','cash','transfer','card'])[1 + (random() * 4)::int],
             'fnb', v_shift_id, v_created_by,
             v_day::timestamptz + interval '7 hours' + (random() * interval '14 hours'),
             v_day::timestamptz + interval '7 hours' + (random() * interval '14 hours'))
          RETURNING id INTO v_invoice_id;

          v_invoice_count := v_invoice_count + 1;

          -- Add 2-4 items (dùng v_j để không shadow outer v_i)
          FOR v_j IN 1..(2 + (random() * 2)::int)
          LOOP
            DECLARE
              v_idx int := 1 + (random() * (array_length(v_menu_ids,1) - 1))::int;
              v_item_qty int := 1 + (random() * 2)::int;
              v_item_price numeric := v_menu_prices[v_idx];
            BEGIN
              v_qty := v_item_qty;
              v_price := v_item_price;

              INSERT INTO public.invoice_items
                (invoice_id, product_id, product_name, unit, quantity, unit_price, discount, total)
              VALUES
                (v_invoice_id, v_menu_ids[v_idx], v_menu_names[v_idx], 'Ly',
                 v_qty, v_price, 0, v_qty * v_price);

              v_subtotal := v_subtotal + (v_qty * v_price);
              v_item_count := v_item_count + 1;
            END;
          END LOOP;

          v_total := v_subtotal;

          UPDATE public.invoices
            SET subtotal = v_subtotal, total = v_total, paid = v_total
            WHERE id = v_invoice_id;

          -- Cash transaction đi kèm
          INSERT INTO public.cash_transactions
            (tenant_id, branch_id, code, type, category, amount, counterparty,
             payment_method, reference_type, reference_id, created_by, created_at)
          VALUES
            (v_tenant_id, v_b, public.next_code(v_tenant_id, 'cash_transaction'),
             'receipt', 'sale', v_total, 'Khách lẻ',
             'cash', 'invoice', v_invoice_id, v_created_by,
             v_day::timestamptz + interval '7 hours' + (random() * interval '14 hours'));
        END LOOP;
      END LOOP;
    END LOOP;

    END IF;  -- end v_has_history check
  END IF;

  -- ============================================================
  -- PART 17: Shift mở hôm nay cho mỗi quán (để POS dùng)
  -- ============================================================
  RAISE NOTICE '=== PART 17: Ca mở hôm nay ===';

  FOREACH v_b IN ARRAY ARRAY[v_store1_id, v_store2_id, v_store3_id]
  LOOP
    -- Đóng tất cả ca open đã tồn tại của user này (để không vi phạm unique index)
    UPDATE public.shifts
      SET status = 'closed', closed_at = now(), actual_cash = starting_cash
      WHERE tenant_id = v_tenant_id AND branch_id = v_b AND cashier_id = v_user_id AND status = 'open';

    -- Đã close mọi open shift phía trên, giờ insert ca mới
    INSERT INTO public.shifts
      (tenant_id, branch_id, cashier_id, status, starting_cash, opened_at)
    VALUES
      (v_tenant_id, v_b, v_user_id, 'open', 500000, now() - interval '2 hours');
  END LOOP;

  -- ============================================================
  -- PART 18: Active kitchen orders (để KDS hiện đơn)
  -- ============================================================
  RAISE NOTICE '=== PART 18: Active kitchen orders cho KDS ===';

  SELECT EXISTS (
    SELECT 1 FROM public.kitchen_orders
     WHERE tenant_id = v_tenant_id AND status IN ('pending','preparing','ready')
     LIMIT 1
  ) INTO v_has_kds;

  IF v_has_kds THEN
    RAISE NOTICE 'Đã có active kitchen orders, bỏ qua';
  ELSE

  -- Cho mỗi quán, tạo 2 đơn pending + 1 đơn preparing + 1 đơn ready
  FOREACH v_b IN ARRAY ARRAY[v_store1_id, v_store2_id, v_store3_id]
  LOOP
    -- Lấy vài bàn
    FOR v_i IN 1..4 LOOP
      SELECT id INTO v_table_id FROM public.restaurant_tables
        WHERE tenant_id = v_tenant_id AND branch_id = v_b
        ORDER BY random() LIMIT 1;

      INSERT INTO public.kitchen_orders
        (tenant_id, branch_id, table_id, order_number, order_type, status, created_by, created_at)
      VALUES
        (v_tenant_id, v_b, v_table_id,
         public.next_code(v_tenant_id, 'kitchen_order'),
         'dine_in',
         CASE v_i WHEN 1 THEN 'pending' WHEN 2 THEN 'pending' WHEN 3 THEN 'preparing' ELSE 'ready' END,
         v_created_by,
         now() - (v_i * interval '7 minutes'))
      RETURNING id INTO v_kitchen_id;

      -- Cập nhật bàn
      UPDATE public.restaurant_tables SET status = 'occupied', current_order_id = v_kitchen_id
        WHERE id = v_table_id;

      -- Add 2-3 items cho kitchen order
      INSERT INTO public.kitchen_order_items
        (kitchen_order_id, product_id, product_name, quantity, unit_price, status)
      SELECT v_kitchen_id, p.id, p.name,
             1 + (random() * 2)::int,
             p.sell_price,
             (ARRAY['pending','pending','preparing'])[1 + (random() * 2)::int]
        FROM (
          SELECT id, name, sell_price FROM public.products
            WHERE tenant_id = v_tenant_id AND product_type = 'sku' AND code LIKE 'F%-%'
            ORDER BY random() LIMIT 2 + (random() * 1)::int
        ) p;
    END LOOP;
  END LOOP;

  END IF;  -- end v_has_kds check

  -- ============================================================
  -- PART 19: Internal sales (Factory → Warehouse, Warehouse → Stores)
  -- ============================================================
  RAISE NOTICE '=== PART 19: Internal sales ===';

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'internal_sales'
  ) THEN
    RAISE NOTICE 'internal_sales table chua ton tai — bo qua PART 19 (Phase 1 chua ap dung)';
  ELSIF NOT EXISTS (SELECT 1 FROM public.internal_sales WHERE tenant_id = v_tenant_id LIMIT 1) THEN

  -- IS #1: Factory bán Phin 250g cho Warehouse (cách đây 5 ngày)
  DECLARE
    v_from_cust uuid;
    v_to_supp uuid;
    v_input_inv uuid;
    v_cost numeric;
  BEGIN
    SELECT id INTO v_from_cust FROM public.customers
      WHERE tenant_id = v_tenant_id AND is_internal = true AND branch_id = v_warehouse_id LIMIT 1;
    SELECT id INTO v_to_supp FROM public.suppliers
      WHERE tenant_id = v_tenant_id AND is_internal = true AND branch_id = v_factory_id LIMIT 1;

    IF v_from_cust IS NOT NULL AND v_to_supp IS NOT NULL THEN
      -- Invoice (factory bán)
      INSERT INTO public.invoices
        (tenant_id, branch_id, code, customer_id, customer_name, status, subtotal, total, paid, source, created_by, created_at)
      VALUES
        (v_tenant_id, v_factory_id, public.next_code(v_tenant_id, 'invoice'),
         v_from_cust, 'NB: Kho Tổng', 'completed', 20000000, 20000000, 20000000, 'internal',
         v_created_by, now() - interval '5 days')
      RETURNING id INTO v_invoice_id;

      INSERT INTO public.invoice_items
        (invoice_id, product_id, product_name, unit, quantity, unit_price, total)
      SELECT v_invoice_id, id, name, 'Túi', 200, 100000, 20000000
        FROM public.products WHERE tenant_id = v_tenant_id AND code = 'SKU-RXA-001';

      -- Input invoice (warehouse mua)
      INSERT INTO public.input_invoices
        (tenant_id, branch_id, code, supplier_id, supplier_name, total_amount, status, created_by, created_at)
      VALUES
        (v_tenant_id, v_warehouse_id, 'IIN-' || to_char(now(), 'YYMMDD-HH24MI'),
         v_to_supp, 'NB: Xưởng Rang', 20000000, 'recorded', v_created_by, now() - interval '5 days')
      RETURNING id INTO v_input_inv;

      -- Internal sale header
      INSERT INTO public.internal_sales
        (tenant_id, code, from_branch_id, to_branch_id, invoice_id, input_invoice_id,
         status, subtotal, total, created_by, created_at)
      VALUES
        (v_tenant_id, public.next_code(v_tenant_id, 'internal_sale'),
         v_factory_id, v_warehouse_id, v_invoice_id, v_input_inv,
         'completed', 20000000, 20000000, v_created_by, now() - interval '5 days');
    END IF;
  END;

  -- IS #2: Warehouse bán syrup + topping cho Quán Q1 (cách đây 2 ngày)
  DECLARE
    v_from_cust uuid;
    v_to_supp uuid;
    v_input_inv uuid;
  BEGIN
    SELECT id INTO v_from_cust FROM public.customers
      WHERE tenant_id = v_tenant_id AND is_internal = true AND branch_id = v_store1_id LIMIT 1;
    SELECT id INTO v_to_supp FROM public.suppliers
      WHERE tenant_id = v_tenant_id AND is_internal = true AND branch_id = v_warehouse_id LIMIT 1;

    IF v_from_cust IS NOT NULL AND v_to_supp IS NOT NULL THEN
      INSERT INTO public.invoices
        (tenant_id, branch_id, code, customer_id, customer_name, status, subtotal, total, paid, source, created_by, created_at)
      VALUES
        (v_tenant_id, v_warehouse_id, public.next_code(v_tenant_id, 'invoice'),
         v_from_cust, 'NB: Quán Q1', 'completed', 3500000, 3500000, 3500000, 'internal',
         v_created_by, now() - interval '2 days')
      RETURNING id INTO v_invoice_id;

      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, unit, quantity, unit_price, total)
      SELECT v_invoice_id, id, name, 'Chai', 10, 200000, 2000000
        FROM public.products WHERE tenant_id = v_tenant_id AND code = 'NVL-SST-001';
      INSERT INTO public.invoice_items (invoice_id, product_id, product_name, unit, quantity, unit_price, total)
      SELECT v_invoice_id, id, name, 'Túi', 10, 150000, 1500000
        FROM public.products WHERE tenant_id = v_tenant_id AND code = 'NVL-TOP-001';

      INSERT INTO public.input_invoices
        (tenant_id, branch_id, code, supplier_id, supplier_name, total_amount, status, created_by, created_at)
      VALUES
        (v_tenant_id, v_store1_id, 'IIN-' || to_char(now(), 'YYMMDD-HH24MI') || '-S1',
         v_to_supp, 'NB: Kho Tổng', 3500000, 'recorded', v_created_by, now() - interval '2 days')
      RETURNING id INTO v_input_inv;

      INSERT INTO public.internal_sales
        (tenant_id, code, from_branch_id, to_branch_id, invoice_id, input_invoice_id,
         status, subtotal, total, created_by, created_at)
      VALUES
        (v_tenant_id, public.next_code(v_tenant_id, 'internal_sale'),
         v_warehouse_id, v_store1_id, v_invoice_id, v_input_inv,
         'completed', 3500000, 3500000, v_created_by, now() - interval '2 days');
    END IF;
  END;

  ELSE
    RAISE NOTICE 'Đã có internal_sales, bỏ qua';
  END IF;

  -- ============================================================
  -- PART 20: Purchase orders (3 PO — 2 completed + 1 draft)
  -- ============================================================
  RAISE NOTICE '=== PART 20: Purchase orders + input invoices ===';

  IF NOT EXISTS (SELECT 1 FROM public.purchase_orders WHERE tenant_id = v_tenant_id LIMIT 1) THEN

  -- PO #1: Warehouse nhập hạt cà phê từ NCC Cầu Đất (completed)
  SELECT id INTO v_supp_id FROM public.suppliers WHERE tenant_id = v_tenant_id AND code = 'NCC-CPH-001';
  IF v_supp_id IS NOT NULL THEN
    INSERT INTO public.purchase_orders
      (tenant_id, branch_id, code, supplier_id, supplier_name, status,
       subtotal, total, paid, created_by, created_at)
    VALUES
      (v_tenant_id, v_warehouse_id, public.next_code(v_tenant_id, 'purchase_order'),
       v_supp_id, 'NCC Cà Phê Cầu Đất', 'completed',
       28000000, 28000000, 28000000, v_created_by, now() - interval '20 days')
    RETURNING id INTO v_po_id;

    INSERT INTO public.purchase_order_items
      (purchase_order_id, product_id, product_name, unit, quantity, received_quantity, unit_price, total)
    SELECT v_po_id, id, name, 'Kg', 100, 100, 280000, 28000000
      FROM public.products WHERE tenant_id = v_tenant_id AND code = 'NVL-CPH-001';

    INSERT INTO public.input_invoices
      (tenant_id, branch_id, code, supplier_id, supplier_name, total_amount, status,
       purchase_order_id, created_by, created_at)
    VALUES
      (v_tenant_id, v_warehouse_id, 'IIN-CPH-' || to_char(now() - interval '20 days', 'YYMMDD'),
       v_supp_id, 'NCC Cà Phê Cầu Đất', 28000000, 'recorded', v_po_id,
       v_created_by, now() - interval '20 days');
  END IF;

  -- PO #2: Warehouse nhập sữa + syrup (completed)
  SELECT id INTO v_supp_id FROM public.suppliers WHERE tenant_id = v_tenant_id AND code = 'NCC-SUA-001';
  IF v_supp_id IS NOT NULL THEN
    INSERT INTO public.purchase_orders
      (tenant_id, branch_id, code, supplier_id, supplier_name, status,
       subtotal, total, paid, created_by, created_at)
    VALUES
      (v_tenant_id, v_warehouse_id, public.next_code(v_tenant_id, 'purchase_order'),
       v_supp_id, 'NCC Sữa TH True Milk', 'completed',
       8400000, 8400000, 8400000, v_created_by, now() - interval '10 days')
    RETURNING id INTO v_po_id;

    INSERT INTO public.purchase_order_items
      (purchase_order_id, product_id, product_name, unit, quantity, received_quantity, unit_price, total)
    SELECT v_po_id, id, name, 'Lon', 300, 300, 28000, 8400000
      FROM public.products WHERE tenant_id = v_tenant_id AND code = 'NVL-SUA-001';
  END IF;

  -- PO #3: Warehouse đặt trân châu (draft — chưa nhận)
  SELECT id INTO v_supp_id FROM public.suppliers WHERE tenant_id = v_tenant_id AND code = 'NCC-TOP-001';
  IF v_supp_id IS NOT NULL THEN
    INSERT INTO public.purchase_orders
      (tenant_id, branch_id, code, supplier_id, supplier_name, status,
       subtotal, total, paid, debt, created_by, created_at)
    VALUES
      (v_tenant_id, v_warehouse_id, public.next_code(v_tenant_id, 'purchase_order'),
       v_supp_id, 'NCC Trân Châu Đài Loan', 'ordered',
       5500000, 5500000, 0, 5500000, v_created_by, now() - interval '1 day')
    RETURNING id INTO v_po_id;

    INSERT INTO public.purchase_order_items
      (purchase_order_id, product_id, product_name, unit, quantity, received_quantity, unit_price, total)
    SELECT v_po_id, id, name, 'Túi', 50, 0, 110000, 5500000
      FROM public.products WHERE tenant_id = v_tenant_id AND code = 'NVL-TOP-001';
  END IF;

  ELSE
    RAISE NOTICE 'Đã có purchase_orders, bỏ qua';
  END IF;  -- end purchase_orders idempotency

  -- ============================================================
  -- PART 21: Thông kê cuối cùng
  -- ============================================================
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'SEED HOÀN TẤT cho tenant: %', v_tenant_id;
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Branches: 5 (1 xưởng, 1 kho, 3 quán)';
  RAISE NOTICE '  - Xưởng rang:   %', v_factory_id;
  RAISE NOTICE '  - Kho tổng:     %', v_warehouse_id;
  RAISE NOTICE '  - Quán Q1:      %', v_store1_id;
  RAISE NOTICE '  - Quán TĐ:      %', v_store2_id;
  RAISE NOTICE '  - Quán BT:      %', v_store3_id;
  RAISE NOTICE 'Products: % (NVL + SKU + FnB menu)',
    (SELECT count(*) FROM public.products WHERE tenant_id = v_tenant_id);
  RAISE NOTICE 'Customers: %',
    (SELECT count(*) FROM public.customers WHERE tenant_id = v_tenant_id);
  RAISE NOTICE 'Suppliers: %',
    (SELECT count(*) FROM public.suppliers WHERE tenant_id = v_tenant_id);
  RAISE NOTICE 'Restaurant tables: %',
    (SELECT count(*) FROM public.restaurant_tables WHERE tenant_id = v_tenant_id);
  RAISE NOTICE 'Historical invoices: %',
    (SELECT count(*) FROM public.invoices WHERE tenant_id = v_tenant_id);
  RAISE NOTICE 'Historical invoice items: %',
    (SELECT count(*) FROM public.invoice_items ii JOIN public.invoices i ON i.id = ii.invoice_id WHERE i.tenant_id = v_tenant_id);
  RAISE NOTICE 'Shifts: %',
    (SELECT count(*) FROM public.shifts WHERE tenant_id = v_tenant_id);
  RAISE NOTICE 'Cash transactions: %',
    (SELECT count(*) FROM public.cash_transactions WHERE tenant_id = v_tenant_id);
  RAISE NOTICE 'Active kitchen orders: %',
    (SELECT count(*) FROM public.kitchen_orders WHERE tenant_id = v_tenant_id AND status IN ('pending','preparing','ready'));
  RAISE NOTICE 'Production orders: %',
    (SELECT count(*) FROM public.production_orders WHERE tenant_id = v_tenant_id);
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'internal_sales'
  ) THEN
    RAISE NOTICE 'Internal sales: %',
      (SELECT count(*) FROM public.internal_sales WHERE tenant_id = v_tenant_id);
  END IF;
  RAISE NOTICE 'Coupons: %',
    (SELECT count(*) FROM public.coupons WHERE tenant_id = v_tenant_id);
  RAISE NOTICE 'Promotions: %',
    (SELECT count(*) FROM public.promotions WHERE tenant_id = v_tenant_id);
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'XONG! Vào app.onebiz.com.vn hoặc fnb.onebiz.com.vn để xem.';
  RAISE NOTICE '============================================================';

END $seed$;

-- ============================================================
-- VERIFY (chạy riêng để check)
-- ============================================================
SELECT
  (SELECT count(*) FROM tenants WHERE slug = '9799bce2-7cbd-4be7-b72e-387a5166a48c')  AS tenants,
  (SELECT count(*) FROM branches b JOIN tenants t ON t.id = b.tenant_id WHERE t.slug = '9799bce2-7cbd-4be7-b72e-387a5166a48c') AS branches,
  (SELECT count(*) FROM products p JOIN tenants t ON t.id = p.tenant_id WHERE t.slug = '9799bce2-7cbd-4be7-b72e-387a5166a48c') AS products,
  (SELECT count(*) FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE t.slug = '9799bce2-7cbd-4be7-b72e-387a5166a48c') AS invoices,
  (SELECT count(*) FROM customers c JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = '9799bce2-7cbd-4be7-b72e-387a5166a48c') AS customers,
  (SELECT count(*) FROM restaurant_tables rt JOIN tenants t ON t.id = rt.tenant_id WHERE t.slug = '9799bce2-7cbd-4be7-b72e-387a5166a48c') AS tables;
