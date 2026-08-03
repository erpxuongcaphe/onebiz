-- ============================================================
-- 00300: Tối ưu get_bom_availability_batch — set-based thay vòng lặp
--
-- VÌ SAO: pg_stat_statements 03/08 — hàm này 6.570 lần gọi nhưng đọc
-- 26,3 TRIỆU trang đệm (~31MB/lần gọi, gần bằng cả DB 37MB) = điểm nóng
-- CPU số 1 phía app. Nguyên nhân: thân hàm cũ (00123) LOOP từng SKU rồi
-- LOOP từng NVL, mỗi NVL bắn 1 câu SUM branch_stock riêng
-- (~147 SKU × 3 NVL ≈ 600 truy vấn con mỗi lần POS làm mới tồn).
--
-- CÁCH SỬA: gom phần đắt (bom_items × branch_stock) về MỘT truy vấn.
-- GIỮ NGUYÊN 2 helper đã kiểm chứng (không viết lại logic nghiệp vụ):
--   - should_cascade_bom_at_branch (bản 00165 — món F&B luôn cascade)
--   - get_active_bom_for_branch   (bản 00147 — variant-aware)
-- GIỮ NGUYÊN chữ ký hàm + kiểu trả về → client không đổi gì.
--
-- Khác biệt hành vi (chủ đích, vô hại):
--   - SKU trùng trong mảng đầu vào: cũ trả dòng trùng, mới khử trùng
--     (client dùng Map nên kết quả như nhau).
--   - Đồng hạng bottleneck (2 NVL cùng can_make min): cũ lấy theo thứ tự
--     quét ngẫu nhiên, mới tie-break theo material_id — ổn định hơn.
--
-- Chỉ đổi định nghĩa hàm. KHÔNG đụng dữ liệu.
-- ============================================================

begin;

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
language sql
stable
security definer
set search_path = public, extensions
as $$
  with sku_bom as (
    -- Giải BOM cho từng SKU qua helper chuẩn (cascade + active BOM theo CN)
    select s.sku,
           public.get_active_bom_for_branch(s.sku, p_branch_id) as bom_id
    from (
      select distinct u.sku
      from unnest(coalesce(p_sku_ids, '{}'::uuid[])) as u(sku)
    ) s
    where public.should_cascade_bom_at_branch(s.sku, p_branch_id)
  ),
  needed as (
    -- consume cho 1 đơn vị SKU = quantity × (1 + waste/100) — y hệt 00123
    select sb.sku,
           bi.material_id,
           bi.quantity * (1 + coalesce(bi.waste_percent, 0) / 100) as unit_consume
    from sku_bom sb
    join public.bom_items bi on bi.bom_id = sb.bom_id
    where sb.bom_id is not null
  ),
  mat_stock as (
    -- MỘT lần quét tồn NVL tại chi nhánh cho toàn bộ NVL liên quan
    -- (thay cho ~600 câu SUM riêng lẻ của bản cũ)
    select bs.product_id, sum(bs.quantity) as stock
    from public.branch_stock bs
    where bs.branch_id = p_branch_id
      and bs.variant_id is null
      and bs.product_id in (select distinct n.material_id from needed n)
    group by bs.product_id
  ),
  per_material as (
    -- NVL không có dòng tồn → coalesce 0 → can_make 0 (y hệt bản cũ)
    -- unit_consume <= 0 bị loại (bản cũ: continue)
    select n.sku,
           n.material_id,
           floor(coalesce(ms.stock, 0) / n.unit_consume) as can_make
    from needed n
    left join mat_stock ms on ms.product_id = n.material_id
    where n.unit_consume > 0
  ),
  ranked as (
    select pm.sku, pm.material_id, pm.can_make,
           row_number() over (
             partition by pm.sku
             order by pm.can_make asc, pm.material_id
           ) as rn
    from per_material pm
  )
  -- SKU không có dòng NVL hợp lệ → không trả dòng (y hệt bản cũ)
  select r.sku,
         greatest(0, r.can_make)::numeric,
         r.material_id,
         p.name
  from ranked r
  left join public.products p on p.id = r.material_id
  where r.rn = 1;
$$;

grant execute on function public.get_bom_availability_batch(uuid, uuid, uuid[]) to authenticated;

comment on function public.get_bom_availability_batch is
  '00300 — bản set-based (1 truy vấn gộp thay ~600 truy vấn con/lần). Logic nghiệp vụ giữ nguyên 00123 + helper 00147/00165. Trả số đơn vị bán tối đa = min(floor(tồn NVL / định mức)) + NVL nghẽn cổ chai.';

commit;

notify pgrst, 'reload schema';

-- ============================================================
-- KIỂM SAU KHI CHẠY (CEO chạy từng câu, chỉ đọc):
--
-- 1. Hàm trả kết quả bình thường (thay <tenant>/<branch> Kho Tổng):
--    select * from public.get_bom_availability_batch(
--      '<tenant_id>'::uuid, '<branch_id>'::uuid,
--      (select array_agg(id) from products
--       where tenant_id='<tenant_id>' and has_bom = true limit 200)
--    ) limit 10;
--    → Kỳ vọng: có dòng, số "available" trùng số khả dụng đang thấy trên POS.
--
-- 2. Đo chi phí mới (so mốc cũ ~4.000 trang đệm/lần):
--    explain (analyze, buffers)
--    select * from public.get_bom_availability_batch(... như câu 1 ...);
--    → Kỳ vọng: "shared hit" giảm mạnh (còn vài trăm trang).
--
-- 3. Mở POS Retail Kho Tổng trên web: ô số tồn/khả dụng các món có công
--    thức hiện Y HỆT trước khi chạy migration (đối chứng số cũ).
--
-- ĐƯỜNG LÙI (nếu số khả dụng hiện sai): chạy lại nguyên văn hàm cũ ở
-- 00123_branch_cascade_mode.sql dòng 935-1022 (create or replace là đè
-- lại được ngay, không mất gì).
-- ============================================================
