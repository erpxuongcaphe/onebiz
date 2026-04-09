-- ============================================================
-- OneBiz ERP — Seed Data v4
-- Categories (NVL/SKU/KH/NCC) + Pipelines + Price Tiers + Sequences
-- ============================================================
-- NOTE: Seed chạy qua RLS bypass (migration). Tenant-specific data
-- sẽ được tạo bởi handle_new_user() trigger hoặc app logic.
-- File này tạo TEMPLATE data cho tenant mới.

-- ============================================================
-- 1. Seed function: tạo foundation data cho 1 tenant
-- ============================================================
create or replace function public.seed_tenant_foundation(p_tenant_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_cat_id uuid;
  v_pipe_id uuid;
  v_stage_ids uuid[];
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid; v_s5 uuid; v_s6 uuid;
begin

  -- ============================================================
  -- 1.1 NVL Categories (13 nhóm)
  -- ============================================================
  insert into public.categories (tenant_id, name, code, scope, sort_order) values
    (p_tenant_id, 'Bao bì', 'BAO', 'nvl', 1),
    (p_tenant_id, 'Bột', 'BOT', 'nvl', 2),
    (p_tenant_id, 'Cà phê hạt', 'CPH', 'nvl', 3),
    (p_tenant_id, 'Dụng cụ', 'DCU', 'nvl', 4),
    (p_tenant_id, 'Dụng cụ pha', 'DCV', 'nvl', 5),
    (p_tenant_id, 'Khác hàng kho', 'KHO', 'nvl', 6),
    (p_tenant_id, 'Lon/Thùng/Túi', 'LTT', 'nvl', 7),
    (p_tenant_id, 'Syrup/Sốt', 'SST', 'nvl', 8),
    (p_tenant_id, 'Sữa', 'SUA', 'nvl', 9),
    (p_tenant_id, 'Trà cà phê chế biến', 'TCA', 'nvl', 10),
    (p_tenant_id, 'Topping', 'TOP', 'nvl', 11),
    (p_tenant_id, 'Trà nguyên liệu', 'TRA', 'nvl', 12),
    (p_tenant_id, 'Văn phòng phẩm', 'VPP', 'nvl', 13);

  -- ============================================================
  -- 1.2 SKU Categories (9 nhóm)
  -- ============================================================
  insert into public.categories (tenant_id, name, code, scope, sort_order) values
    (p_tenant_id, 'Cà phê chai', 'CPC', 'sku', 1),
    (p_tenant_id, 'Rang xay đóng gói', 'RXA', 'sku', 2),
    (p_tenant_id, 'Cốt nguyên liệu', 'COT', 'sku', 3),
    (p_tenant_id, 'Trà đóng gói', 'TRB', 'sku', 4),
    (p_tenant_id, 'Bột đóng gói', 'BOD', 'sku', 5),
    (p_tenant_id, 'Sữa bán lại', 'SBL', 'sku', 6),
    (p_tenant_id, 'Syrup bán lại', 'SYR', 'sku', 7),
    (p_tenant_id, 'Phụ kiện bán lại', 'PHU', 'sku', 8),
    (p_tenant_id, 'Combo/Kit', 'KIT', 'sku', 9);

  -- ============================================================
  -- 1.3 Supplier Categories (nhóm NCC theo loại hàng)
  -- ============================================================
  insert into public.categories (tenant_id, name, code, scope, sort_order) values
    (p_tenant_id, 'NCC Cà phê', 'CPH', 'supplier', 1),
    (p_tenant_id, 'NCC Sữa', 'SUA', 'supplier', 2),
    (p_tenant_id, 'NCC Bao bì', 'BAO', 'supplier', 3),
    (p_tenant_id, 'NCC Syrup/Sốt', 'SST', 'supplier', 4),
    (p_tenant_id, 'NCC Trà', 'TRA', 'supplier', 5),
    (p_tenant_id, 'NCC Bột', 'BOT', 'supplier', 6),
    (p_tenant_id, 'NCC Topping', 'TOP', 'supplier', 7),
    (p_tenant_id, 'NCC Dụng cụ', 'DCU', 'supplier', 8),
    (p_tenant_id, 'NCC Khác', 'KHA', 'supplier', 9);

  -- ============================================================
  -- 1.4 Customer Groups → dùng customer_groups đã có
  -- KSI = Khách sỉ, KLE = Khách lẻ, KDN = Khách doanh nghiệp,
  -- NBO = Nhà bán online, VLA = Vãng lai
  -- ============================================================
  insert into public.customer_groups (tenant_id, name, discount_percent, note) values
    (p_tenant_id, 'Khách sỉ', 10, 'KSI - Đại lý, mua số lượng lớn'),
    (p_tenant_id, 'Khách lẻ', 0, 'KLE - Quán nhỏ, mua ít'),
    (p_tenant_id, 'Khách doanh nghiệp', 8, 'KDN - Công ty, chuỗi quán'),
    (p_tenant_id, 'Nhà bán online', 5, 'NBO - Bán trên Shopee, Lazada'),
    (p_tenant_id, 'Vãng lai', 0, 'VLA - Khách mua 1 lần, dùng chung');

  -- ============================================================
  -- 1.5 Price Tiers (Bảng giá sỉ)
  -- ============================================================
  insert into public.price_tiers (tenant_id, name, code, description, priority) values
    (p_tenant_id, 'Giá đại lý', 'DAI_LY', 'Giá cho đại lý lớn, mua SL lớn', 1),
    (p_tenant_id, 'Giá quán', 'QUAN', 'Giá cho quán cà phê, nhà hàng', 2),
    (p_tenant_id, 'Giá lẻ', 'LE', 'Giá bán lẻ mặc định', 3);

  -- ============================================================
  -- 1.6 Group Code Sequences (NVL counters khởi tạo)
  -- ============================================================
  -- NVL sequences (start at 0, sẽ increment khi tạo SP)
  insert into public.group_code_sequences (tenant_id, prefix, group_code, current_number, padding) values
    (p_tenant_id, 'NVL', 'BAO', 0, 3), (p_tenant_id, 'NVL', 'BOT', 0, 3),
    (p_tenant_id, 'NVL', 'CPH', 0, 3), (p_tenant_id, 'NVL', 'DCU', 0, 3),
    (p_tenant_id, 'NVL', 'DCV', 0, 3), (p_tenant_id, 'NVL', 'KHO', 0, 3),
    (p_tenant_id, 'NVL', 'LTT', 0, 3), (p_tenant_id, 'NVL', 'SST', 0, 3),
    (p_tenant_id, 'NVL', 'SUA', 0, 3), (p_tenant_id, 'NVL', 'TCA', 0, 3),
    (p_tenant_id, 'NVL', 'TOP', 0, 3), (p_tenant_id, 'NVL', 'TRA', 0, 3),
    (p_tenant_id, 'NVL', 'VPP', 0, 3);
  -- SKU sequences
  insert into public.group_code_sequences (tenant_id, prefix, group_code, current_number, padding) values
    (p_tenant_id, 'SKU', 'CPC', 0, 3), (p_tenant_id, 'SKU', 'RXA', 0, 3),
    (p_tenant_id, 'SKU', 'COT', 0, 3), (p_tenant_id, 'SKU', 'TRB', 0, 3),
    (p_tenant_id, 'SKU', 'BOD', 0, 3), (p_tenant_id, 'SKU', 'SBL', 0, 3),
    (p_tenant_id, 'SKU', 'SYR', 0, 3), (p_tenant_id, 'SKU', 'PHU', 0, 3),
    (p_tenant_id, 'SKU', 'KIT', 0, 3);
  -- BOM sequences
  insert into public.group_code_sequences (tenant_id, prefix, group_code, current_number, padding) values
    (p_tenant_id, 'BOM', 'CPC', 0, 3), (p_tenant_id, 'BOM', 'RXA', 0, 3),
    (p_tenant_id, 'BOM', 'COT', 0, 3), (p_tenant_id, 'BOM', 'TRB', 0, 3),
    (p_tenant_id, 'BOM', 'BOD', 0, 3), (p_tenant_id, 'BOM', 'KIT', 0, 3);
  -- NCC sequences
  insert into public.group_code_sequences (tenant_id, prefix, group_code, current_number, padding) values
    (p_tenant_id, 'NCC', 'CPH', 0, 3), (p_tenant_id, 'NCC', 'SUA', 0, 3),
    (p_tenant_id, 'NCC', 'BAO', 0, 3), (p_tenant_id, 'NCC', 'SST', 0, 3),
    (p_tenant_id, 'NCC', 'TRA', 0, 3), (p_tenant_id, 'NCC', 'BOT', 0, 3),
    (p_tenant_id, 'NCC', 'TOP', 0, 3), (p_tenant_id, 'NCC', 'DCU', 0, 3),
    (p_tenant_id, 'NCC', 'KHA', 0, 3);
  -- KHA (khách hàng) sequences
  insert into public.group_code_sequences (tenant_id, prefix, group_code, current_number, padding) values
    (p_tenant_id, 'KHA', 'KSI', 0, 3), (p_tenant_id, 'KHA', 'KLE', 0, 3),
    (p_tenant_id, 'KHA', 'KDN', 0, 3), (p_tenant_id, 'KHA', 'NBO', 0, 3),
    (p_tenant_id, 'KHA', 'VLA', 0, 3);

  -- ============================================================
  -- 1.7 PIPELINES (11 pipelines)
  -- ============================================================

  -- Pipeline 1: Đơn bán sỉ (invoice)
  insert into public.pipelines (tenant_id, entity_type, name, description)
  values (p_tenant_id, 'invoice', 'Đơn bán sỉ', 'Quy trình đơn hàng bán sỉ B2B')
  returning id into v_pipe_id;

  insert into public.pipeline_stages (pipeline_id, code, name, color, sort_order, is_initial, is_final) values
    (v_pipe_id, 'draft', 'Phiếu tạm', '#9CA3AF', 0, true, false),
    (v_pipe_id, 'confirmed', 'Đã xác nhận', '#3B82F6', 1, false, false),
    (v_pipe_id, 'completed', 'Hoàn thành', '#22C55E', 2, false, true),
    (v_pipe_id, 'cancelled', 'Đã hủy', '#EF4444', 3, false, true)
  ;
  select array(select id from public.pipeline_stages where pipeline_id = v_pipe_id order by sort_order) into v_stage_ids;
  v_s1 := v_stage_ids[1]; v_s2 := v_stage_ids[2]; v_s3 := v_stage_ids[3]; v_s4 := v_stage_ids[4];

  insert into public.pipeline_transitions (pipeline_id, from_stage_id, to_stage_id, name) values
    (v_pipe_id, v_s1, v_s2, 'Xác nhận đơn'),
    (v_pipe_id, v_s2, v_s3, 'Hoàn thành'),
    (v_pipe_id, v_s1, v_s4, 'Hủy đơn'),
    (v_pipe_id, v_s2, v_s4, 'Hủy đơn');

  -- Pipeline 2: Đặt hàng nhập (purchase_order)
  insert into public.pipelines (tenant_id, entity_type, name, description)
  values (p_tenant_id, 'purchase_order', 'Đặt hàng nhập', 'Quy trình đặt hàng từ NCC')
  returning id into v_pipe_id;

  insert into public.pipeline_stages (pipeline_id, code, name, color, sort_order, is_initial, is_final) values
    (v_pipe_id, 'draft', 'Phiếu tạm', '#9CA3AF', 0, true, false),
    (v_pipe_id, 'approved', 'Đã duyệt', '#3B82F6', 1, false, false),
    (v_pipe_id, 'ordered', 'Đã đặt', '#8B5CF6', 2, false, false),
    (v_pipe_id, 'partial', 'Nhận 1 phần', '#F59E0B', 3, false, false),
    (v_pipe_id, 'completed', 'Hoàn thành', '#22C55E', 4, false, true),
    (v_pipe_id, 'cancelled', 'Đã hủy', '#EF4444', 5, false, true)
  ;
  select array(select id from public.pipeline_stages where pipeline_id = v_pipe_id order by sort_order) into v_stage_ids;
  v_s1 := v_stage_ids[1]; v_s2 := v_stage_ids[2]; v_s3 := v_stage_ids[3]; v_s4 := v_stage_ids[4]; v_s5 := v_stage_ids[5]; v_s6 := v_stage_ids[6];

  insert into public.pipeline_transitions (pipeline_id, from_stage_id, to_stage_id, name) values
    (v_pipe_id, v_s1, v_s2, 'Duyệt'),
    (v_pipe_id, v_s2, v_s3, 'Đã đặt NCC'),
    (v_pipe_id, v_s3, v_s4, 'Nhận 1 phần'),
    (v_pipe_id, v_s3, v_s5, 'Nhận đủ'),
    (v_pipe_id, v_s4, v_s5, 'Nhận đủ'),
    (v_pipe_id, v_s1, v_s6, 'Hủy'),
    (v_pipe_id, v_s2, v_s6, 'Hủy');

  -- Pipeline 3: Nhập kho (stock_receipt)
  insert into public.pipelines (tenant_id, entity_type, name, description)
  values (p_tenant_id, 'stock_receipt', 'Nhập kho', 'Quy trình nhập kho hàng hóa')
  returning id into v_pipe_id;

  insert into public.pipeline_stages (pipeline_id, code, name, color, sort_order, is_initial, is_final) values
    (v_pipe_id, 'pending', 'Chờ nhập', '#9CA3AF', 0, true, false),
    (v_pipe_id, 'checking', 'Đang kiểm', '#F59E0B', 1, false, false),
    (v_pipe_id, 'confirmed', 'Đã xác nhận', '#3B82F6', 2, false, false),
    (v_pipe_id, 'shelved', 'Đã lên kệ', '#22C55E', 3, false, true)
  ;
  select array(select id from public.pipeline_stages where pipeline_id = v_pipe_id order by sort_order) into v_stage_ids;
  v_s1 := v_stage_ids[1]; v_s2 := v_stage_ids[2]; v_s3 := v_stage_ids[3]; v_s4 := v_stage_ids[4];

  insert into public.pipeline_transitions (pipeline_id, from_stage_id, to_stage_id, name) values
    (v_pipe_id, v_s1, v_s2, 'Bắt đầu kiểm'),
    (v_pipe_id, v_s2, v_s3, 'Xác nhận OK'),
    (v_pipe_id, v_s3, v_s4, 'Lên kệ xong');

  -- Pipeline 4: Trả hàng (sales_return)
  insert into public.pipelines (tenant_id, entity_type, name, description)
  values (p_tenant_id, 'sales_return', 'Trả hàng', 'Quy trình trả hàng từ khách')
  returning id into v_pipe_id;

  insert into public.pipeline_stages (pipeline_id, code, name, color, sort_order, is_initial, is_final) values
    (v_pipe_id, 'draft', 'Phiếu tạm', '#9CA3AF', 0, true, false),
    (v_pipe_id, 'confirmed', 'Đã xác nhận', '#3B82F6', 1, false, false),
    (v_pipe_id, 'refunded', 'Đã hoàn tiền', '#F59E0B', 2, false, false),
    (v_pipe_id, 'completed', 'Hoàn thành', '#22C55E', 3, false, true)
  ;
  select array(select id from public.pipeline_stages where pipeline_id = v_pipe_id order by sort_order) into v_stage_ids;
  v_s1 := v_stage_ids[1]; v_s2 := v_stage_ids[2]; v_s3 := v_stage_ids[3]; v_s4 := v_stage_ids[4];

  insert into public.pipeline_transitions (pipeline_id, from_stage_id, to_stage_id, name) values
    (v_pipe_id, v_s1, v_s2, 'Xác nhận trả'),
    (v_pipe_id, v_s2, v_s3, 'Hoàn tiền'),
    (v_pipe_id, v_s3, v_s4, 'Hoàn tất');

  -- Pipeline 5: Vận chuyển (shipping)
  insert into public.pipelines (tenant_id, entity_type, name, description)
  values (p_tenant_id, 'shipping', 'Vận chuyển', 'Quy trình giao hàng')
  returning id into v_pipe_id;

  insert into public.pipeline_stages (pipeline_id, code, name, color, sort_order, is_initial, is_final) values
    (v_pipe_id, 'pending', 'Chờ lấy', '#9CA3AF', 0, true, false),
    (v_pipe_id, 'picked_up', 'Đã lấy', '#3B82F6', 1, false, false),
    (v_pipe_id, 'in_transit', 'Đang giao', '#F59E0B', 2, false, false),
    (v_pipe_id, 'delivered', 'Đã giao', '#22C55E', 3, false, true),
    (v_pipe_id, 'returned', 'Trả lại', '#EF4444', 4, false, true)
  ;
  select array(select id from public.pipeline_stages where pipeline_id = v_pipe_id order by sort_order) into v_stage_ids;
  v_s1 := v_stage_ids[1]; v_s2 := v_stage_ids[2]; v_s3 := v_stage_ids[3]; v_s4 := v_stage_ids[4]; v_s5 := v_stage_ids[5];

  insert into public.pipeline_transitions (pipeline_id, from_stage_id, to_stage_id, name) values
    (v_pipe_id, v_s1, v_s2, 'Lấy hàng'),
    (v_pipe_id, v_s2, v_s3, 'Đang giao'),
    (v_pipe_id, v_s3, v_s4, 'Giao thành công'),
    (v_pipe_id, v_s3, v_s5, 'Trả lại'),
    (v_pipe_id, v_s2, v_s5, 'Trả lại');

  -- Pipeline 6: Đơn online (online_order)
  insert into public.pipelines (tenant_id, entity_type, name, description)
  values (p_tenant_id, 'online_order', 'Đơn online', 'Quy trình đơn hàng online')
  returning id into v_pipe_id;

  insert into public.pipeline_stages (pipeline_id, code, name, color, sort_order, is_initial, is_final) values
    (v_pipe_id, 'pending', 'Chờ xác nhận', '#9CA3AF', 0, true, false),
    (v_pipe_id, 'confirmed', 'Đã xác nhận', '#3B82F6', 1, false, false),
    (v_pipe_id, 'preparing', 'Đang chuẩn bị', '#F59E0B', 2, false, false),
    (v_pipe_id, 'shipping', 'Đang giao', '#8B5CF6', 3, false, false),
    (v_pipe_id, 'completed', 'Hoàn thành', '#22C55E', 4, false, true),
    (v_pipe_id, 'cancelled', 'Đã hủy', '#EF4444', 5, false, true)
  ;
  select array(select id from public.pipeline_stages where pipeline_id = v_pipe_id order by sort_order) into v_stage_ids;
  v_s1 := v_stage_ids[1]; v_s2 := v_stage_ids[2]; v_s3 := v_stage_ids[3]; v_s4 := v_stage_ids[4]; v_s5 := v_stage_ids[5]; v_s6 := v_stage_ids[6];

  insert into public.pipeline_transitions (pipeline_id, from_stage_id, to_stage_id, name) values
    (v_pipe_id, v_s1, v_s2, 'Xác nhận'),
    (v_pipe_id, v_s2, v_s3, 'Chuẩn bị hàng'),
    (v_pipe_id, v_s3, v_s4, 'Giao hàng'),
    (v_pipe_id, v_s4, v_s5, 'Hoàn thành'),
    (v_pipe_id, v_s1, v_s6, 'Hủy'),
    (v_pipe_id, v_s2, v_s6, 'Hủy');

  -- Pipeline 7: Kiểm kho (inventory_check)
  insert into public.pipelines (tenant_id, entity_type, name, description)
  values (p_tenant_id, 'inventory_check', 'Kiểm kho', 'Quy trình kiểm kê hàng hóa')
  returning id into v_pipe_id;

  insert into public.pipeline_stages (pipeline_id, code, name, color, sort_order, is_initial, is_final) values
    (v_pipe_id, 'draft', 'Phiếu tạm', '#9CA3AF', 0, true, false),
    (v_pipe_id, 'in_progress', 'Đang kiểm', '#F59E0B', 1, false, false),
    (v_pipe_id, 'balanced', 'Đã cân bằng', '#22C55E', 2, false, true)
  ;
  select array(select id from public.pipeline_stages where pipeline_id = v_pipe_id order by sort_order) into v_stage_ids;
  v_s1 := v_stage_ids[1]; v_s2 := v_stage_ids[2]; v_s3 := v_stage_ids[3];

  insert into public.pipeline_transitions (pipeline_id, from_stage_id, to_stage_id, name) values
    (v_pipe_id, v_s1, v_s2, 'Bắt đầu kiểm'),
    (v_pipe_id, v_s2, v_s3, 'Cân bằng xong');

  -- Pipeline 8: Chuyển kho (stock_transfer)
  insert into public.pipelines (tenant_id, entity_type, name, description)
  values (p_tenant_id, 'stock_transfer', 'Chuyển kho', 'Quy trình chuyển hàng giữa kho/CN')
  returning id into v_pipe_id;

  insert into public.pipeline_stages (pipeline_id, code, name, color, sort_order, is_initial, is_final) values
    (v_pipe_id, 'requested', 'Yêu cầu', '#9CA3AF', 0, true, false),
    (v_pipe_id, 'approved', 'Đã duyệt', '#3B82F6', 1, false, false),
    (v_pipe_id, 'in_transit', 'Đang chuyển', '#F59E0B', 2, false, false),
    (v_pipe_id, 'received', 'Đã nhận', '#22C55E', 3, false, true)
  ;
  select array(select id from public.pipeline_stages where pipeline_id = v_pipe_id order by sort_order) into v_stage_ids;
  v_s1 := v_stage_ids[1]; v_s2 := v_stage_ids[2]; v_s3 := v_stage_ids[3]; v_s4 := v_stage_ids[4];

  insert into public.pipeline_transitions (pipeline_id, from_stage_id, to_stage_id, name) values
    (v_pipe_id, v_s1, v_s2, 'Duyệt'),
    (v_pipe_id, v_s2, v_s3, 'Xuất kho'),
    (v_pipe_id, v_s3, v_s4, 'Nhận hàng');

  -- Pipeline 9: CRM Deal (crm_deal)
  insert into public.pipelines (tenant_id, entity_type, name, description)
  values (p_tenant_id, 'crm_deal', 'CRM Deal', 'Quy trình chăm sóc khách hàng B2B')
  returning id into v_pipe_id;

  insert into public.pipeline_stages (pipeline_id, code, name, color, sort_order, is_initial, is_final) values
    (v_pipe_id, 'lead', 'Tiềm năng', '#9CA3AF', 0, true, false),
    (v_pipe_id, 'qualified', 'Đủ điều kiện', '#3B82F6', 1, false, false),
    (v_pipe_id, 'proposal', 'Báo giá', '#F59E0B', 2, false, false),
    (v_pipe_id, 'negotiation', 'Thương lượng', '#8B5CF6', 3, false, false),
    (v_pipe_id, 'won', 'Thắng', '#22C55E', 4, false, true),
    (v_pipe_id, 'lost', 'Thua', '#EF4444', 5, false, true)
  ;
  select array(select id from public.pipeline_stages where pipeline_id = v_pipe_id order by sort_order) into v_stage_ids;
  v_s1 := v_stage_ids[1]; v_s2 := v_stage_ids[2]; v_s3 := v_stage_ids[3]; v_s4 := v_stage_ids[4]; v_s5 := v_stage_ids[5]; v_s6 := v_stage_ids[6];

  insert into public.pipeline_transitions (pipeline_id, from_stage_id, to_stage_id, name) values
    (v_pipe_id, v_s1, v_s2, 'Qualify'),
    (v_pipe_id, v_s2, v_s3, 'Gửi báo giá'),
    (v_pipe_id, v_s3, v_s4, 'Thương lượng'),
    (v_pipe_id, v_s4, v_s5, 'Chốt deal'),
    (v_pipe_id, v_s1, v_s6, 'Mất'),
    (v_pipe_id, v_s2, v_s6, 'Mất'),
    (v_pipe_id, v_s3, v_s6, 'Mất'),
    (v_pipe_id, v_s4, v_s6, 'Mất');

  -- Pipeline 10: Vòng đời KH (customer_lifecycle)
  insert into public.pipelines (tenant_id, entity_type, name, description)
  values (p_tenant_id, 'customer_lifecycle', 'Vòng đời KH', 'Quản lý vòng đời khách hàng')
  returning id into v_pipe_id;

  insert into public.pipeline_stages (pipeline_id, code, name, color, sort_order, is_initial, is_final) values
    (v_pipe_id, 'new', 'Mới', '#9CA3AF', 0, true, false),
    (v_pipe_id, 'active', 'Hoạt động', '#3B82F6', 1, false, false),
    (v_pipe_id, 'loyal', 'Trung thành', '#22C55E', 2, false, false),
    (v_pipe_id, 'vip', 'VIP', '#F59E0B', 3, false, false),
    (v_pipe_id, 'churned', 'Ngưng mua', '#EF4444', 4, false, true)
  ;
  select array(select id from public.pipeline_stages where pipeline_id = v_pipe_id order by sort_order) into v_stage_ids;
  v_s1 := v_stage_ids[1]; v_s2 := v_stage_ids[2]; v_s3 := v_stage_ids[3]; v_s4 := v_stage_ids[4]; v_s5 := v_stage_ids[5];

  insert into public.pipeline_transitions (pipeline_id, from_stage_id, to_stage_id, name) values
    (v_pipe_id, v_s1, v_s2, 'Kích hoạt'),
    (v_pipe_id, v_s2, v_s3, 'Nâng hạng trung thành'),
    (v_pipe_id, v_s3, v_s4, 'Nâng VIP'),
    (v_pipe_id, v_s2, v_s5, 'Ngưng mua'),
    (v_pipe_id, v_s3, v_s5, 'Ngưng mua'),
    (v_pipe_id, v_s4, v_s5, 'Ngưng mua');

  -- Pipeline 11: Lệnh sản xuất (production_order)
  insert into public.pipelines (tenant_id, entity_type, name, description)
  values (p_tenant_id, 'production_order', 'Lệnh sản xuất', 'Quy trình sản xuất hàng hóa')
  returning id into v_pipe_id;

  insert into public.pipeline_stages (pipeline_id, code, name, color, sort_order, is_initial, is_final) values
    (v_pipe_id, 'planned', 'Đã lên kế hoạch', '#9CA3AF', 0, true, false),
    (v_pipe_id, 'material_check', 'Kiểm NVL', '#F59E0B', 1, false, false),
    (v_pipe_id, 'in_production', 'Đang sản xuất', '#3B82F6', 2, false, false),
    (v_pipe_id, 'quality_check', 'Kiểm tra CL', '#8B5CF6', 3, false, false),
    (v_pipe_id, 'completed', 'Hoàn thành', '#22C55E', 4, false, true),
    (v_pipe_id, 'cancelled', 'Đã hủy', '#EF4444', 5, false, true)
  ;
  select array(select id from public.pipeline_stages where pipeline_id = v_pipe_id order by sort_order) into v_stage_ids;
  v_s1 := v_stage_ids[1]; v_s2 := v_stage_ids[2]; v_s3 := v_stage_ids[3]; v_s4 := v_stage_ids[4]; v_s5 := v_stage_ids[5]; v_s6 := v_stage_ids[6];

  insert into public.pipeline_transitions (pipeline_id, from_stage_id, to_stage_id, name) values
    (v_pipe_id, v_s1, v_s2, 'Kiểm NVL'),
    (v_pipe_id, v_s2, v_s3, 'Bắt đầu SX'),
    (v_pipe_id, v_s3, v_s4, 'Kiểm tra chất lượng'),
    (v_pipe_id, v_s4, v_s5, 'Hoàn thành'),
    (v_pipe_id, v_s1, v_s6, 'Hủy'),
    (v_pipe_id, v_s2, v_s6, 'Hủy');

end;
$$;

-- ============================================================
-- 2. Update handle_new_user() to call seed_tenant_foundation
-- ============================================================
-- Modify the existing trigger to also seed foundation data
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

  -- Create code sequences (existing ones)
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

  -- Seed foundation data (NEW: categories, pipelines, price tiers, sequences)
  perform seed_tenant_foundation(v_tenant_id);

  return new;
end;
$$;
