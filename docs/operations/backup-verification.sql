-- ============================================================
-- Backup Verification Queries — Sprint LT-4
-- ============================================================
--
-- Chạy hằng TUẦN trong Supabase SQL Editor để verify backup
-- mechanism còn hoạt động + data integrity OK.
--
-- Mục tiêu:
-- 1. Check Supabase backup mới nhất < 24h
-- 2. Check audit_log đang track đúng (FK đã hardening qua 00049)
-- 3. Check số row các bảng critical — trend bình thường, không drop bất thường
-- 4. Check disk usage — không vượt limit free tier
--
-- Cách chạy:
-- 1. Mở https://supabase.com/dashboard/project/<id>/sql/new
-- 2. Paste toàn bộ file này
-- 3. Click Run
-- 4. Save kết quả → copy vào Google Sheets / Notion lưu hằng tuần
-- ============================================================

-- ============================================================
-- 1. Disk usage — Free tier limit 500MB
-- ============================================================
SELECT
  pg_size_pretty(pg_database_size(current_database())) AS db_size,
  pg_database_size(current_database()) / (1024.0 * 1024.0) AS db_size_mb;
-- Mong đợi: < 400MB (chừa room cho growth)
-- Nếu > 400MB: cleanup audit_log cũ hoặc upgrade Pro plan

-- ============================================================
-- 2. Số row các bảng critical
-- ============================================================
SELECT
  schemaname,
  relname AS table_name,
  n_live_tup AS rows,
  n_dead_tup AS dead_rows,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) AS size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname IN (
    'invoices', 'invoice_items', 'customers', 'products',
    'stock_movements', 'cash_transactions', 'audit_log',
    'production_orders', 'inventory_checks', 'stock_transfers',
    'shifts', 'branches', 'profiles'
  )
ORDER BY n_live_tup DESC;
-- Đối chiếu với kết quả tuần trước. Số rows giảm đột ngột → red flag.
-- audit_log thường tăng nhanh nhất (mỗi action ghi 1 row).

-- ============================================================
-- 3. Audit log activity hôm nay
-- ============================================================
SELECT
  DATE(created_at) AS day,
  action,
  entity_type,
  COUNT(*) AS events
FROM public.audit_log
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(created_at), action, entity_type
ORDER BY day DESC, events DESC
LIMIT 50;
-- Mong đợi: mỗi ngày có hoạt động create/update đều đặn
-- Nếu 1 ngày không có audit log → có thể audit broken hoặc business pause

-- ============================================================
-- 4. Top 10 user hoạt động (đảm bảo audit log link đúng user)
-- ============================================================
SELECT
  p.full_name,
  p.email,
  COUNT(*) AS actions
FROM public.audit_log al
JOIN public.profiles p ON p.id = al.user_id
WHERE al.created_at > NOW() - INTERVAL '7 days'
GROUP BY p.full_name, p.email
ORDER BY actions DESC
LIMIT 10;
-- Nếu thấy user lạ với nhiều actions → red flag (hack?)

-- ============================================================
-- 5. FK constraints check (verify migration 00049 vẫn intact)
-- ============================================================
SELECT
  tc.table_name,
  tc.constraint_name,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.constraint_name IN (
    'audit_log_tenant_id_fkey',
    'bom_product_id_fkey',
    'branch_stock_product_id_fkey',
    'loyalty_transactions_customer_id_fkey',
    'coupon_usages_coupon_id_fkey',
    'customers_loyalty_tier_id_fkey'
  )
ORDER BY tc.table_name;
-- Mong đợi:
--   audit_log_tenant_id_fkey               RESTRICT
--   bom_product_id_fkey                    RESTRICT
--   branch_stock_product_id_fkey           RESTRICT
--   coupon_usages_coupon_id_fkey           RESTRICT
--   customers_loyalty_tier_id_fkey         SET NULL
--   loyalty_transactions_customer_id_fkey  SET NULL
-- Nếu khác → FK bị rollback, data drift risk → fix lại migration

-- ============================================================
-- 6. Orphan stock_movements check (data integrity)
-- ============================================================
-- stock_movements với reference_type='invoice' nhưng invoice không tồn tại
SELECT COUNT(*) AS orphan_movements
FROM public.stock_movements sm
WHERE sm.reference_type = 'invoice'
  AND NOT EXISTS (
    SELECT 1 FROM public.invoices i WHERE i.id = sm.reference_id
  );
-- Mong đợi: 0
-- > 0 → cần investigate (do migration cũ chưa CASCADE clean)

-- ============================================================
-- 7. Customer balance integrity
-- ============================================================
-- Tổng debt customer = sum(invoice.debt) per customer (kiểm tra drift)
WITH invoice_debt AS (
  SELECT
    customer_id,
    SUM(debt) AS total_debt
  FROM public.invoices
  WHERE customer_id IS NOT NULL
    AND status = 'completed'
  GROUP BY customer_id
)
SELECT
  c.code,
  c.name,
  c.debt AS recorded_debt,
  COALESCE(id.total_debt, 0) AS calculated_debt,
  c.debt - COALESCE(id.total_debt, 0) AS drift
FROM public.customers c
LEFT JOIN invoice_debt id ON id.customer_id = c.id
WHERE ABS(c.debt - COALESCE(id.total_debt, 0)) > 1
ORDER BY ABS(c.debt - COALESCE(id.total_debt, 0)) DESC
LIMIT 20;
-- Mong đợi: 0 row (drift = 0)
-- Nếu có drift > 1₫ → công nợ ảo, cần investigate

-- ============================================================
-- 8. RPC functions intact (verify migrations đầy đủ)
-- ============================================================
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    -- Migration 00046: cash transaction atomic
    'record_invoice_payment',
    'cancel_cash_transaction',
    -- Migration 00047: production rollback
    'revert_production_materials',
    -- Migration 00048: idempotency
    'find_invoice_by_session_id',
    'cleanup_expired_auto_drafts',
    -- Migration 00049: chưa thêm RPC, chỉ FK
    -- Original RPCs
    'next_code',
    'increment_product_stock',
    'upsert_branch_stock'
  )
ORDER BY routine_name;
-- Mong đợi: 7+ row
-- Thiếu RPC nào → migration bị rollback / chưa apply đúng

-- ============================================================
-- 9. Last write timestamp per critical table
-- ============================================================
-- Đảm bảo không có bảng nào "đứng yên" bất thường
SELECT 'invoices' AS t, MAX(created_at) AS last_write FROM invoices
UNION ALL
SELECT 'customers', MAX(created_at) FROM customers
UNION ALL
SELECT 'products', MAX(created_at) FROM products
UNION ALL
SELECT 'stock_movements', MAX(created_at) FROM stock_movements
UNION ALL
SELECT 'cash_transactions', MAX(created_at) FROM cash_transactions
UNION ALL
SELECT 'audit_log', MAX(created_at) FROM audit_log
ORDER BY t;
-- Mong đợi: bảng critical có last_write trong 24h gần nhất
-- Nếu 1 bảng đứng > 7 ngày → có thể write path broken

-- ============================================================
-- Save kết quả vào Google Sheets / Notion để track theo tuần
-- Khi có drift / red flag → check `docs/operations/emergency-runbook.md`
-- ============================================================
