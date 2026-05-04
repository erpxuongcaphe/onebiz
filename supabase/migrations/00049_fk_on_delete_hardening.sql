-- ============================================================
-- Migration 00049: FK ON DELETE Hardening (Sprint LT-1, CEO 04/05/2026)
-- ============================================================
--
-- Vấn đề phát hiện qua audit FK relationships:
-- Một số FK đang dùng ON DELETE CASCADE quá tay → xoá parent kéo theo
-- child không đáng mất (dữ liệu kế toán/audit/công thức). Đồng thời vài
-- FK chưa khai báo ON DELETE explicit → mặc định RESTRICT chấp nhận
-- nhưng nên explicit + đổi vài chỗ sang SET NULL để giữ history.
--
-- Migration này CHỈ thay đổi ON DELETE behavior — KHÔNG đụng dữ liệu
-- hiện tại, KHÔNG drop NOT NULL (defer phase 2 sau khi audit code).
--
-- ============================================================
-- FK changes
-- ============================================================
--
-- | # | FK | Cũ | Mới | Lý do |
-- |---|---|---|---|---|
-- | 1 | audit_log.tenant_id → tenants.id | CASCADE | RESTRICT | Audit phải tồn tại độc lập tenant. Compliance + investigation phải giữ. |
-- | 2 | bom.product_id → products.id | CASCADE | RESTRICT | Xoá product hủy luôn công thức rang xay → mất nghiệp vụ. Buộc admin xoá BOM thủ công trước. |
-- | 3 | branch_stock.product_id → products.id | CASCADE | RESTRICT | Xoá product mất số dư kho silently. Buộc giảm stock về 0 trước khi xoá. |
-- | 4 | loyalty_transactions.customer_id → customers.id | CASCADE (NOT NULL) | SET NULL (nullable) | Giữ lịch sử điểm thưởng khi KH bị xoá (kế toán). Drop NOT NULL kèm. |
-- | 5 | coupon_usages.coupon_id → coupons.id | CASCADE | RESTRICT | Giữ audit trail dùng coupon (chống gian lận, báo cáo KM). |
-- | 6 | customers.loyalty_tier_id → loyalty_tiers.id | (no action) | SET NULL | Đổi/xoá tier không gãy customer record. |
--
-- DEFER sang migration phase 2 (cần audit code trước, có thể break read flow):
-- - audit_log.user_id NOT NULL drop + SET NULL
-- - invoices.created_by, stock_movements.created_by, cash_transactions.created_by
--   (NOT NULL drop + SET NULL) — code đang assume created_by truthy
--
-- ============================================================

-- ============================================================
-- 1. audit_log.tenant_id: CASCADE → RESTRICT
-- ============================================================
-- Trước: xoá tenant kéo theo tất cả audit_log → mất compliance trail.
-- Sau: chặn xoá tenant nếu còn audit. Cleanup tenant phải qua proc thủ
-- công 2-step: archive audit → DELETE tenant.

ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_tenant_id_fkey;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
  ON DELETE RESTRICT;

-- ============================================================
-- 2. bom.product_id: CASCADE → RESTRICT
-- ============================================================
-- Trước: xoá product → BOM (công thức) cũng mất, mất nghiệp vụ rang xay.
-- Sau: chặn xoá product nếu còn BOM. Admin phải xoá BOM trước rồi mới
-- xoá product. Hoặc soft-delete product (is_active=false) — không trigger.

ALTER TABLE public.bom
  DROP CONSTRAINT IF EXISTS bom_product_id_fkey;

ALTER TABLE public.bom
  ADD CONSTRAINT bom_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id)
  ON DELETE RESTRICT;

-- ============================================================
-- 3. branch_stock.product_id: CASCADE → RESTRICT
-- ============================================================
-- Trước: xoá product → branch_stock row mất → balance kho silently 0.
-- Sau: chặn xoá product nếu còn branch_stock. Admin phải kiểm kê + giảm
-- stock về 0 trước khi xoá product (nghiệp vụ đúng).

ALTER TABLE public.branch_stock
  DROP CONSTRAINT IF EXISTS branch_stock_product_id_fkey;

ALTER TABLE public.branch_stock
  ADD CONSTRAINT branch_stock_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id)
  ON DELETE RESTRICT;

-- ============================================================
-- 4. loyalty_transactions.customer_id: CASCADE (NOT NULL) → SET NULL
-- ============================================================
-- Trước: xoá customer → tất cả lịch sử điểm thưởng mất → kế toán + báo
-- cáo loyalty bị thiếu. Customer bị xoá nhầm → không thể recover điểm.
-- Sau: SET NULL → giữ row, ẩn link customer. UI hiển thị "—" thay tên
-- khách. Cần drop NOT NULL trước (Postgres requirement cho SET NULL).

ALTER TABLE public.loyalty_transactions
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.loyalty_transactions
  DROP CONSTRAINT IF EXISTS loyalty_transactions_customer_id_fkey;

ALTER TABLE public.loyalty_transactions
  ADD CONSTRAINT loyalty_transactions_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id)
  ON DELETE SET NULL;

-- ============================================================
-- 5. coupon_usages.coupon_id: CASCADE → RESTRICT
-- ============================================================
-- Trước: xoá coupon (vd hết hạn) → toàn bộ lịch sử dùng coupon đó mất →
-- không audit được KM, không phát hiện gian lận đã xảy ra.
-- Sau: chặn xoá coupon nếu còn lịch sử dùng. Hết hạn → soft-delete
-- (is_active=false) thay vì DELETE.

ALTER TABLE public.coupon_usages
  DROP CONSTRAINT IF EXISTS coupon_usages_coupon_id_fkey;

ALTER TABLE public.coupon_usages
  ADD CONSTRAINT coupon_usages_coupon_id_fkey
  FOREIGN KEY (coupon_id) REFERENCES public.coupons(id)
  ON DELETE RESTRICT;

-- ============================================================
-- 6. customers.loyalty_tier_id: (no action) → SET NULL
-- ============================================================
-- Trước: không khai báo ON DELETE → mặc định RESTRICT (chặn xoá tier nếu
-- còn customer dùng).
-- Sau: SET NULL → admin đổi/gộp tier, customer về tier mặc định (NULL).

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_loyalty_tier_id_fkey;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_loyalty_tier_id_fkey
  FOREIGN KEY (loyalty_tier_id) REFERENCES public.loyalty_tiers(id)
  ON DELETE SET NULL;

-- ============================================================
-- 7. Verification queries (manual run sau apply)
-- ============================================================
-- Check FK constraints đã đổi đúng:
--   SELECT
--     tc.table_name, tc.constraint_name, rc.delete_rule
--   FROM information_schema.table_constraints tc
--   JOIN information_schema.referential_constraints rc
--     ON tc.constraint_name = rc.constraint_name
--   WHERE tc.constraint_type = 'FOREIGN KEY'
--     AND tc.table_schema = 'public'
--     AND tc.constraint_name IN (
--       'audit_log_tenant_id_fkey',
--       'bom_product_id_fkey',
--       'branch_stock_product_id_fkey',
--       'loyalty_transactions_customer_id_fkey',
--       'coupon_usages_coupon_id_fkey',
--       'customers_loyalty_tier_id_fkey'
--     )
--   ORDER BY tc.table_name;
--
-- Mong đợi:
--   audit_log_tenant_id_fkey         RESTRICT
--   bom_product_id_fkey              RESTRICT
--   branch_stock_product_id_fkey     RESTRICT
--   coupon_usages_coupon_id_fkey     RESTRICT
--   customers_loyalty_tier_id_fkey   SET NULL
--   loyalty_transactions_customer_id_fkey  SET NULL

-- ============================================================
-- Rollback (nếu cần)
-- ============================================================
-- Tất cả thay đổi đều khả nghịch. Để rollback, chạy ngược lại với
-- DROP CONSTRAINT + ADD CONSTRAINT cũ. Lưu ý: nếu đã có data
-- loyalty_transactions với customer_id NULL, cần fill trước khi rollback
-- ALTER COLUMN customer_id SET NOT NULL.
