-- ============================================================
-- CLEANUP SAMPLE DATA — chuẩn bị production cho admin@xuongcaphe.com
-- ============================================================
-- CEO 06/05/2026:
--   - Xoá toàn bộ data sample (chi nhánh, hàng hoá, hoá đơn, ...)
--   - GIỮ LẠI:
--     1. Tài khoản admin: admin@xuongcaphe.com
--     2. Tenant của admin
--     3. 1 chi nhánh "Kho tổng" (branch_type='warehouse')
--     4. Roles + role_permissions + permissions
--     5. Tenant settings + code_sequences
--   - XOÁ:
--     1. Tất cả user khác (trừ admin)
--     2. Tất cả branch khác (trừ Kho tổng)
--     3. Tất cả product / customer / supplier
--     4. Tất cả invoice / order / purchase / return / shipping
--     5. Tất cả inventory transactions / cash / shifts / stock movements
--     6. Tất cả notifications / audit logs / conversations
--
-- CÁCH CHẠY:
--   1. Backup DB trước (Supabase Dashboard → Settings → Backups → Download)
--   2. Vào Supabase Dashboard → SQL Editor → New query
--   3. Copy ENTIRE file này, paste, RUN
--   4. Sau khi xong, kiểm tra count còn lại đúng (ở section cuối)
--
-- ⚠️  DESTRUCTIVE — KHÔNG THỂ UNDO. Bắt buộc backup trước.
-- ============================================================

BEGIN;

-- ============================================================
-- BƯỚC 1: Tìm admin user_id + tenant_id + branch giữ lại
-- ============================================================
-- Lưu vào temp table để tham chiếu trong các bước sau
CREATE TEMP TABLE _keep_admin AS
SELECT
  p.id AS user_id,
  p.tenant_id,
  -- Lấy 1 chi nhánh warehouse hoặc branch chính của admin
  COALESCE(
    (SELECT id FROM public.branches
     WHERE tenant_id = p.tenant_id AND branch_type = 'warehouse'
     ORDER BY created_at ASC LIMIT 1),
    p.branch_id,
    (SELECT id FROM public.branches
     WHERE tenant_id = p.tenant_id
     ORDER BY created_at ASC LIMIT 1)
  ) AS keep_branch_id
FROM public.profiles p
WHERE p.email = 'admin@xuongcaphe.com';

-- Sanity check: phải có đúng 1 row
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM _keep_admin;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 admin row, got %. ABORT.', v_count;
  END IF;
END $$;

-- ============================================================
-- BƯỚC 2: Xoá data nghiệp vụ (giữ scope by tenant_id của admin)
-- ============================================================
-- Order quan trọng: child tables trước, parent sau (FK constraint)

-- 2.1. Stock movements + branch stock
DELETE FROM public.stock_movements
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.branch_stock
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.branch_inventory
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.2. Production
DELETE FROM public.production_materials
  WHERE production_order_id IN (
    SELECT id FROM public.production_orders
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.production_orders
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.product_lots
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.bom_items
  WHERE bom_id IN (
    SELECT id FROM public.boms
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.boms
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.3. Inventory transactions
DELETE FROM public.inventory_check_items
  WHERE check_id IN (
    SELECT id FROM public.inventory_checks
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.inventory_checks
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.disposal_export_items
  WHERE disposal_id IN (
    SELECT id FROM public.disposal_exports
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.disposal_exports
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.internal_export_items
  WHERE internal_export_id IN (
    SELECT id FROM public.internal_exports
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.internal_exports
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.internal_sale_items
  WHERE internal_sale_id IN (
    SELECT id FROM public.internal_sales
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.internal_sales
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.stock_transfer_items
  WHERE transfer_id IN (
    SELECT id FROM public.stock_transfers
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.stock_transfers
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.4. Sales: invoices + orders + returns + shipping
DELETE FROM public.invoice_items
  WHERE invoice_id IN (
    SELECT id FROM public.invoices
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.invoices
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.sales_order_items
  WHERE order_id IN (
    SELECT id FROM public.sales_orders
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.sales_orders
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.return_items
  WHERE return_id IN (
    SELECT id FROM public.sales_returns
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.sales_returns
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.shipping_orders
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.5. Purchases
DELETE FROM public.po_items
  WHERE po_id IN (
    SELECT id FROM public.purchase_orders
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.purchase_orders
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.supplier_return_items
  WHERE return_id IN (
    SELECT id FROM public.supplier_returns
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.supplier_returns
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.input_invoices
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.6. F&B
DELETE FROM public.kitchen_order_items
  WHERE kitchen_order_id IN (
    SELECT id FROM public.kitchen_orders
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.kitchen_orders
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.tables
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.shifts
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.7. Cash & finance
DELETE FROM public.cash_transactions
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.8. Master data: products, customers, suppliers
DELETE FROM public.product_variants
  WHERE product_id IN (
    SELECT id FROM public.products
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.products
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.customers
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.suppliers
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.categories
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.delivery_partners
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.9. Pricing
DELETE FROM public.price_tier_items
  WHERE tier_id IN (
    SELECT id FROM public.price_tiers
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.price_tiers
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.10. Promotions / coupons / loyalty
DELETE FROM public.coupon_usages
  WHERE coupon_id IN (
    SELECT id FROM public.coupons
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.coupons
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.promotions
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.loyalty_transactions
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.11. Online orders
DELETE FROM public.online_orders
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.12. AI agents
DELETE FROM public.agent_executions
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.agent_tasks
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.kpi_breakdowns
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.agents
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.13. Conversations + notifications
DELETE FROM public.messages
  WHERE conversation_id IN (
    SELECT id FROM public.conversations
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );
DELETE FROM public.conversations
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);
DELETE FROM public.notifications
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.14. Audit log — XOÁ HẾT cho clean state production
DELETE FROM public.audit_log
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- 2.15. Favorites
DELETE FROM public.favorites
  WHERE user_id IN (
    SELECT id FROM public.profiles
    WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
  );

-- ============================================================
-- BƯỚC 3: Xoá user khác (KHÔNG xoá admin)
-- ============================================================
-- Profiles: xoá tất cả profile cùng tenant với admin TRỪ admin
DELETE FROM public.profiles
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
    AND id <> (SELECT user_id FROM _keep_admin);

-- Auth users: xoá user trong auth.users tương ứng (cẩn thận — chỉ user
-- thuộc tenant này, không đụng user system khác)
-- (Supabase admin có thể chạy DELETE FROM auth.users nhưng cần service_role)
-- → Em RECOMMEND chạy section này từ Supabase Dashboard với role postgres
-- thay vì RLS-scoped session.

-- ============================================================
-- BƯỚC 4: Xoá branches khác (giữ Kho tổng)
-- ============================================================
DELETE FROM public.branches
  WHERE tenant_id = (SELECT tenant_id FROM _keep_admin)
    AND id <> (SELECT keep_branch_id FROM _keep_admin);

-- Update Kho tổng giữ lại: ensure branch_type='warehouse' + name='Kho tổng'
UPDATE public.branches
SET
  name = 'Kho tổng',
  branch_type = 'warehouse',
  is_default = true,
  code = COALESCE(code, 'KHO01')
WHERE id = (SELECT keep_branch_id FROM _keep_admin);

-- Update profiles.branch_id của admin về Kho tổng
UPDATE public.profiles
SET branch_id = (SELECT keep_branch_id FROM _keep_admin)
WHERE id = (SELECT user_id FROM _keep_admin);

-- ============================================================
-- BƯỚC 5: Reset code sequences về 0 (để hoá đơn / phiếu mới đếm lại từ 1)
-- ============================================================
UPDATE public.code_sequences
SET counter = 0
WHERE tenant_id = (SELECT tenant_id FROM _keep_admin);

-- ============================================================
-- BƯỚC 6: Verify counts còn lại đúng
-- ============================================================
DO $$
DECLARE
  v_user_count INT;
  v_branch_count INT;
  v_product_count INT;
  v_invoice_count INT;
  v_tenant_id UUID;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM _keep_admin;

  SELECT COUNT(*) INTO v_user_count
  FROM public.profiles WHERE tenant_id = v_tenant_id;
  SELECT COUNT(*) INTO v_branch_count
  FROM public.branches WHERE tenant_id = v_tenant_id;
  SELECT COUNT(*) INTO v_product_count
  FROM public.products WHERE tenant_id = v_tenant_id;
  SELECT COUNT(*) INTO v_invoice_count
  FROM public.invoices WHERE tenant_id = v_tenant_id;

  RAISE NOTICE '=== CLEANUP COMPLETE ===';
  RAISE NOTICE 'Users:    % (expected: 1 — admin only)', v_user_count;
  RAISE NOTICE 'Branches: % (expected: 1 — Kho tổng only)', v_branch_count;
  RAISE NOTICE 'Products: % (expected: 0)', v_product_count;
  RAISE NOTICE 'Invoices: % (expected: 0)', v_invoice_count;

  IF v_user_count <> 1 THEN
    RAISE WARNING 'User count not 1 — manual check needed';
  END IF;
  IF v_branch_count <> 1 THEN
    RAISE WARNING 'Branch count not 1 — manual check needed';
  END IF;
END $$;

-- ============================================================
-- COMMIT hoặc ROLLBACK
-- ============================================================
-- Đọc kỹ output NOTICE phía trên trước khi COMMIT.
-- Nếu OK → uncomment dòng COMMIT bên dưới
-- Nếu lỗi → ROLLBACK; (giữ nguyên data cũ)

-- COMMIT;
ROLLBACK;  -- Default: rollback để CEO review trước khi commit thật
-- ============================================================
-- ⚠️  ĐỔI 'ROLLBACK' THÀNH 'COMMIT' SAU KHI XEM OUTPUT OK
-- ============================================================
