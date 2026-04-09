-- ============================================================
-- OneBiz ERP — Seed Demo Products v1
-- 30 sản phẩm cà phê NVL/SKU bám theo thiết kế mock data
-- ============================================================
--
-- Yêu cầu trước:
--   • 00001 ... 00007 đã chạy (bảng products + categories + RLS đã có)
--   • 00008_seed.sql đã chạy (categories NVL/SKU đã được seed cho tenant)
--
-- Cấu trúc:
--   1. Function seed_demo_products(p_tenant_id uuid)
--      - Insert 15 NVL + 15 SKU
--      - Lookup category_id qua (tenant_id, scope, code) — KHÔNG hard-code UUID
--      - 5 SKU có has_bom = true (Phin, Espresso, Coldbrew, Sữa Đá Chai, Bạc Xỉu)
--      - 3 SP is_active = false để test filter "Trạng thái"
--      - ON CONFLICT (tenant_id, code) DO NOTHING → idempotent (chạy lại không lỗi)
--   2. DO block gọi function cho tất cả tenants hiện có
--   3. Patch handle_new_user() để tenant mới signup cũng tự seed demo products
--
-- Dữ liệu là sản phẩm cà phê thực tế (Cầu Đất, Đắk Lắk, Honey, Washed,
-- cacao Hà Lan, matcha Nhật, sữa Ông Thọ, kem Anchor, syrup Monin, ...)
-- ============================================================

create or replace function public.seed_demo_products(p_tenant_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  -- NVL category ids
  v_cat_cph uuid; v_cat_bot uuid; v_cat_tra uuid; v_cat_sua uuid;
  v_cat_sst uuid; v_cat_top uuid; v_cat_bao uuid;
  -- SKU category ids
  v_cat_rxa uuid; v_cat_cpc uuid; v_cat_trb uuid;
  v_cat_bod uuid; v_cat_phu uuid; v_cat_kit uuid;
begin
  -- ============================================================
  -- Lookup category ids cho tenant này
  -- ============================================================
  select id into v_cat_cph from public.categories where tenant_id = p_tenant_id and scope = 'nvl' and code = 'CPH';
  select id into v_cat_bot from public.categories where tenant_id = p_tenant_id and scope = 'nvl' and code = 'BOT';
  select id into v_cat_tra from public.categories where tenant_id = p_tenant_id and scope = 'nvl' and code = 'TRA';
  select id into v_cat_sua from public.categories where tenant_id = p_tenant_id and scope = 'nvl' and code = 'SUA';
  select id into v_cat_sst from public.categories where tenant_id = p_tenant_id and scope = 'nvl' and code = 'SST';
  select id into v_cat_top from public.categories where tenant_id = p_tenant_id and scope = 'nvl' and code = 'TOP';
  select id into v_cat_bao from public.categories where tenant_id = p_tenant_id and scope = 'nvl' and code = 'BAO';

  select id into v_cat_rxa from public.categories where tenant_id = p_tenant_id and scope = 'sku' and code = 'RXA';
  select id into v_cat_cpc from public.categories where tenant_id = p_tenant_id and scope = 'sku' and code = 'CPC';
  select id into v_cat_trb from public.categories where tenant_id = p_tenant_id and scope = 'sku' and code = 'TRB';
  select id into v_cat_bod from public.categories where tenant_id = p_tenant_id and scope = 'sku' and code = 'BOD';
  select id into v_cat_phu from public.categories where tenant_id = p_tenant_id and scope = 'sku' and code = 'PHU';
  select id into v_cat_kit from public.categories where tenant_id = p_tenant_id and scope = 'sku' and code = 'KIT';

  -- Nếu chưa seed foundation (categories null) → bỏ qua, không bỏ exception
  if v_cat_cph is null then
    raise notice 'seed_demo_products: tenant % chưa có categories foundation, bỏ qua', p_tenant_id;
    return;
  end if;

  -- ============================================================
  -- 15 NVL — Nguyên vật liệu pha chế
  -- ============================================================
  insert into public.products
    (tenant_id, code, name, category_id, product_type, has_bom, unit, purchase_unit, stock_unit, sell_unit,
     cost_price, sell_price, stock, min_stock, max_stock, group_code, is_active, allow_sale)
  values
    -- Cà phê hạt thô (CPH)
    (p_tenant_id, 'NVL-CPH-001', 'Cà phê Arabica Cầu Đất 1kg',     v_cat_cph, 'nvl', false, 'Kg',  'Kg', 'Kg', 'Kg',  280000, 0,  120, 20, 500, 'CPH', true, false),
    (p_tenant_id, 'NVL-CPH-002', 'Cà phê Robusta Đắk Lắk 1kg',      v_cat_cph, 'nvl', false, 'Kg',  'Kg', 'Kg', 'Kg',  180000, 0,  240, 30, 800, 'CPH', true, false),
    (p_tenant_id, 'NVL-CPH-003', 'Cà phê Honey Process 500g',       v_cat_cph, 'nvl', false, 'Túi', 'Túi','Túi','Túi', 165000, 0,   80, 15, 300, 'CPH', true, false),
    (p_tenant_id, 'NVL-CPH-004', 'Cà phê Washed Arabica 500g',      v_cat_cph, 'nvl', false, 'Túi', 'Túi','Túi','Túi', 175000, 0,   95, 15, 300, 'CPH', true, false),
    -- Bột (BOT)
    (p_tenant_id, 'NVL-BOT-001', 'Bột cacao nguyên chất Hà Lan 1kg',v_cat_bot, 'nvl', false, 'Kg',  'Kg', 'Kg', 'Kg',  390000, 0,   45, 10, 200, 'BOT', true, false),
    (p_tenant_id, 'NVL-BOT-002', 'Bột Matcha Nhật Bản loại 1 100g', v_cat_bot, 'nvl', false, 'Hộp', 'Hộp','Hộp','Hộp', 520000, 0,   28,  5, 100, 'BOT', true, false),
    -- Trà nguyên liệu (TRA)
    (p_tenant_id, 'NVL-TRA-001', 'Trà sen vàng Premium 200g',       v_cat_tra, 'nvl', false, 'Túi', 'Túi','Túi','Túi', 240000, 0,   62, 10, 200, 'TRA', true, false),
    (p_tenant_id, 'NVL-TRA-002', 'Trà ô long đặc biệt 200g',        v_cat_tra, 'nvl', false, 'Túi', 'Túi','Túi','Túi', 320000, 0,   18,  5, 100, 'TRA', false, false), -- INACTIVE
    -- Sữa (SUA)
    (p_tenant_id, 'NVL-SUA-001', 'Sữa đặc Ông Thọ 380g',            v_cat_sua, 'nvl', false, 'Lon', 'Lon','Lon','Lon',  28000, 0,  340, 50,1000, 'SUA', true, false),
    (p_tenant_id, 'NVL-SUA-002', 'Kem béo Anchor 1L',               v_cat_sua, 'nvl', false, 'Hộp', 'Hộp','Hộp','Hộp', 165000, 0,  180, 30, 600, 'SUA', true, false),
    -- Syrup/Sốt (SST)
    (p_tenant_id, 'NVL-SST-001', 'Syrup vani Monin 750ml',          v_cat_sst, 'nvl', false, 'Chai','Chai','Chai','Chai',195000, 0, 78, 15, 200, 'SST', true, false),
    (p_tenant_id, 'NVL-SST-002', 'Syrup caramel Monin 750ml',       v_cat_sst, 'nvl', false, 'Chai','Chai','Chai','Chai',195000, 0, 65, 15, 200, 'SST', true, false),
    -- Topping (TOP)
    (p_tenant_id, 'NVL-TOP-001', 'Trân châu đen Đài Loan 1kg',      v_cat_top, 'nvl', false, 'Túi', 'Túi','Túi','Túi', 110000, 0,  140, 20, 400, 'TOP', true, false),
    (p_tenant_id, 'NVL-TOP-002', 'Hạnh nhân lát rang 500g',         v_cat_top, 'nvl', false, 'Túi', 'Túi','Túi','Túi', 145000, 0,   85, 15, 300, 'TOP', true, false),
    -- Bao bì (BAO)
    (p_tenant_id, 'NVL-BAO-001', 'Túi đựng cà phê valve 1kg (lốc 100c)', v_cat_bao, 'nvl', false, 'Lốc','Lốc','Lốc','Lốc', 320000, 0, 22, 5, 80, 'BAO', true, false)
  on conflict (tenant_id, code) do nothing;

  -- ============================================================
  -- 15 SKU — Thành phẩm bán
  -- ============================================================
  insert into public.products
    (tenant_id, code, name, category_id, product_type, has_bom, unit, purchase_unit, stock_unit, sell_unit,
     cost_price, sell_price, stock, min_stock, max_stock, group_code, is_active, allow_sale)
  values
    -- Rang xay đóng gói (RXA) — 2 BOM
    (p_tenant_id, 'SKU-RXA-001', 'Cà phê Phin Truyền Thống 250g',   v_cat_rxa, 'sku', true,  'Túi', 'Túi','Túi','Túi',  85000, 145000,  240, 30, 800, 'RXA', true, true),
    (p_tenant_id, 'SKU-RXA-002', 'Espresso Blend Signature 500g',   v_cat_rxa, 'sku', true,  'Túi', 'Túi','Túi','Túi', 165000, 285000,  165, 25, 600, 'RXA', true, true),
    (p_tenant_id, 'SKU-RXA-003', 'Cà phê rang xay Robusta 250g',    v_cat_rxa, 'sku', false, 'Túi', 'Túi','Túi','Túi',  62000, 105000,  310, 40,1000, 'RXA', true, true),
    -- Cà phê chai (CPC) — 3 BOM
    (p_tenant_id, 'SKU-CPC-001', 'Cà phê Sữa Đá Chai 350ml',        v_cat_cpc, 'sku', true,  'Chai','Chai','Chai','Chai', 18000,  35000, 480, 60,1500, 'CPC', true, true),
    (p_tenant_id, 'SKU-CPC-002', 'Bạc Xỉu Chai 350ml',              v_cat_cpc, 'sku', true,  'Chai','Chai','Chai','Chai', 19500,  38000, 420, 60,1500, 'CPC', true, true),
    (p_tenant_id, 'SKU-CPC-003', 'Coldbrew Túi Lọc 250ml',          v_cat_cpc, 'sku', true,  'Chai','Chai','Chai','Chai', 22000,  45000, 280, 40, 800, 'CPC', true, true),
    -- Trà đóng gói (TRB)
    (p_tenant_id, 'SKU-TRB-001', 'Trà sen vàng túi lọc hộp 50g',    v_cat_trb, 'sku', false, 'Hộp', 'Hộp','Hộp','Hộp',  45000,  85000, 220, 30, 600, 'TRB', true, true),
    (p_tenant_id, 'SKU-TRB-002', 'Trà ô long túi lọc hộp 50g',      v_cat_trb, 'sku', false, 'Hộp', 'Hộp','Hộp','Hộp',  62000, 115000, 180, 25, 500, 'TRB', true, true),
    -- Bột đóng gói (BOD)
    (p_tenant_id, 'SKU-BOD-001', 'Bột cacao đóng gói 200g',         v_cat_bod, 'sku', false, 'Hộp', 'Hộp','Hộp','Hộp',  85000, 145000, 145, 20, 400, 'BOD', true, true),
    -- Phụ kiện bán lại (PHU)
    (p_tenant_id, 'SKU-PHU-001', 'Phin pha cà phê inox 304',        v_cat_phu, 'sku', false, 'Cái', 'Cái','Cái','Cái',  65000, 125000, 95,  15, 300, 'PHU', true, true),
    (p_tenant_id, 'SKU-PHU-002', 'Cốc giấy 12oz (lốc 50)',          v_cat_phu, 'sku', false, 'Lốc', 'Lốc','Lốc','Lốc',  55000,  95000, 320, 50, 800, 'PHU', true, true),
    (p_tenant_id, 'SKU-PHU-003', 'Bình giữ nhiệt 500ml inox',       v_cat_phu, 'sku', false, 'Cái', 'Cái','Cái','Cái', 145000, 245000, 14,   5, 100, 'PHU', false, true), -- INACTIVE
    (p_tenant_id, 'SKU-PHU-004', 'Túi zip đựng cà phê 250g (lốc)',  v_cat_phu, 'sku', false, 'Lốc', 'Lốc','Lốc','Lốc',  35000,  68000, 0,   10, 200, 'PHU', false, true), -- INACTIVE
    -- Combo/Kit (KIT)
    (p_tenant_id, 'SKU-KIT-001', 'Combo Pha Phin Tại Gia',          v_cat_kit, 'sku', false, 'Bộ',  'Bộ', 'Bộ', 'Bộ', 175000, 295000, 48,   8, 150, 'KIT', true, true),
    (p_tenant_id, 'SKU-KIT-002', 'Hộp Quà Cà Phê Premium',          v_cat_kit, 'sku', false, 'Hộp', 'Hộp','Hộp','Hộp', 320000, 545000, 32,   5, 120, 'KIT', true, true)
  on conflict (tenant_id, code) do nothing;

  -- ============================================================
  -- Update group_code_sequences để mã tự sinh tiếp theo không trùng
  -- (NVL sequences đã được seed = 0 ở 00008 → cập nhật theo số lượng vừa insert)
  -- ============================================================
  update public.group_code_sequences set current_number = greatest(current_number, 4) where tenant_id = p_tenant_id and prefix = 'NVL' and group_code = 'CPH';
  update public.group_code_sequences set current_number = greatest(current_number, 2) where tenant_id = p_tenant_id and prefix = 'NVL' and group_code = 'BOT';
  update public.group_code_sequences set current_number = greatest(current_number, 2) where tenant_id = p_tenant_id and prefix = 'NVL' and group_code = 'TRA';
  update public.group_code_sequences set current_number = greatest(current_number, 2) where tenant_id = p_tenant_id and prefix = 'NVL' and group_code = 'SUA';
  update public.group_code_sequences set current_number = greatest(current_number, 2) where tenant_id = p_tenant_id and prefix = 'NVL' and group_code = 'SST';
  update public.group_code_sequences set current_number = greatest(current_number, 2) where tenant_id = p_tenant_id and prefix = 'NVL' and group_code = 'TOP';
  update public.group_code_sequences set current_number = greatest(current_number, 1) where tenant_id = p_tenant_id and prefix = 'NVL' and group_code = 'BAO';

  update public.group_code_sequences set current_number = greatest(current_number, 3) where tenant_id = p_tenant_id and prefix = 'SKU' and group_code = 'RXA';
  update public.group_code_sequences set current_number = greatest(current_number, 3) where tenant_id = p_tenant_id and prefix = 'SKU' and group_code = 'CPC';
  update public.group_code_sequences set current_number = greatest(current_number, 2) where tenant_id = p_tenant_id and prefix = 'SKU' and group_code = 'TRB';
  update public.group_code_sequences set current_number = greatest(current_number, 1) where tenant_id = p_tenant_id and prefix = 'SKU' and group_code = 'BOD';
  update public.group_code_sequences set current_number = greatest(current_number, 4) where tenant_id = p_tenant_id and prefix = 'SKU' and group_code = 'PHU';
  update public.group_code_sequences set current_number = greatest(current_number, 2) where tenant_id = p_tenant_id and prefix = 'SKU' and group_code = 'KIT';

  raise notice 'seed_demo_products: đã seed 30 sản phẩm demo cho tenant %', p_tenant_id;
end;
$$;

-- ============================================================
-- 2. Apply cho tất cả tenants hiện có
-- ============================================================
do $$
declare
  v_tenant record;
begin
  for v_tenant in select id from public.tenants loop
    perform public.seed_demo_products(v_tenant.id);
  end loop;
end $$;

-- ============================================================
-- 3. Patch handle_new_user để tenant mới signup cũng tự seed demo products
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
begin
  -- Create tenant
  insert into public.tenants (name, slug)
  values (
    coalesce(new.raw_user_meta_data->>'full_name', 'Doanh nghiệp mới'),
    new.id::text
  )
  returning id into v_tenant_id;

  -- Create default branch
  insert into public.branches (tenant_id, name, is_default, branch_type, code)
  values (v_tenant_id, 'Chi nhánh mặc định', true, 'store', 'CNH-MAC')
  returning id into v_branch_id;

  -- Create profile
  insert into public.profiles (id, tenant_id, branch_id, full_name, email, role)
  values (
    new.id,
    v_tenant_id,
    v_branch_id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    'owner'
  );

  -- Create code sequences
  insert into public.code_sequences (tenant_id, entity_type, prefix, current_number, padding) values
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
    (v_tenant_id, 'production_order', 'SX', 0, 6);

  -- Seed foundation data (categories, pipelines, price tiers, sequences)
  perform seed_tenant_foundation(v_tenant_id);

  -- NEW: Seed demo products (30 sản phẩm cà phê)
  perform seed_demo_products(v_tenant_id);

  return new;
end;
$$;
