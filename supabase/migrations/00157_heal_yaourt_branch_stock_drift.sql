-- ============================================================
-- 00157: Heal tồn Yaourt (NVL-SST-019) lệch do duplicate branch_stock
-- ============================================================
-- CEO 04/07/2026: trang Tồn kho hiện tồn CHI NHÁNH Yaourt = -41, nhưng:
--   • Sổ chứng từ (stock_movements) net = -4
--   • Tồn TỔNG công ty (products.stock)   = -4
-- Chênh -37 là RÁC KỸ THUẬT do bug duplicate branch_stock base-row (1 SP có
-- 2 dòng tồn cùng chi nhánh; upsert cũ UPDATE cộng vào MỌI dòng trùng → trừ
-- đôi tích luỹ). Bug đã chặn ở 00156; migration 00156 gộp 2 dòng → lộ -41.
--
-- VÌ SAO PHẢI HEAL TRƯỚC KHI KIỂM KHO:
--   Phiếu kiểm kho tính chênh = (thực tế − tồn hệ thống) rồi cộng CÙNG mức đó
--   vào CẢ branch_stock LẪN products.stock. Nếu 2 số đang lệch (-41 vs -4) mà
--   kiểm kho ngay: branch về đúng nhưng products.stock lệch tiếp (vd nhập 2 →
--   +43 → products.stock = 39). Phải kéo 2 số BẰNG NHAU (= net chứng từ) trước.
--
-- FIX: set branch_stock = net stock_movements (tính động, không hardcode).
--   Sau migration này: branch_stock = products.stock = -4 (khớp sổ).
--   Số ĐẾM THỰC TẾ (~2 chai) áp RIÊNG qua PHIẾU KIỂM KHO sau đó (chênh -4→2
--   là biến động nghiệp vụ thật, cần bản ghi audit — KHÔNG sửa bằng SQL).
--
-- AN TOÀN: chỉ đúng 1 SP (NVL-SST-019) × 1 tenant; guard `is distinct from`
-- → idempotent (chạy lại không đổi gì). KHÔNG đụng movements / products.stock /
-- SP khác. Scan toàn tenant 04/07: chỉ Yaourt lệch (1 mã khác 0.01 rounding).
-- ============================================================

begin;

with ledger as (
  select
    sm.tenant_id,
    sm.product_id,
    sm.branch_id,
    sum(case when sm.type = 'out' then -sm.quantity else sm.quantity end) as net
  from public.stock_movements sm
  join public.products p
    on p.id = sm.product_id and p.tenant_id = sm.tenant_id
  where p.code = 'NVL-SST-019'
    and p.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'
  group by sm.tenant_id, sm.product_id, sm.branch_id
)
update public.branch_stock bs
   set quantity = ledger.net,
       updated_at = now()
  from ledger
 where bs.tenant_id  = ledger.tenant_id
   and bs.product_id = ledger.product_id
   and bs.branch_id  = ledger.branch_id
   and bs.variant_id is null
   and bs.quantity is distinct from ledger.net;

commit;

-- VERIFY — phải thấy branch_stock_now = -4 và product_stock_now = -4
select bs.quantity as branch_stock_now,
       p.stock     as product_stock_now,
       p.code, p.name
  from public.branch_stock bs
  join public.products p on p.id = bs.product_id and p.tenant_id = bs.tenant_id
 where p.code = 'NVL-SST-019'
   and p.tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'
   and bs.variant_id is null;
