-- ============================================================
-- Migration 00032: Add `created_by → profiles(id)` FK on tables
-- that were missing it, so PostgREST JOIN can hydrate
-- `profiles.full_name` for "Người tạo" display across the UI.
--
-- Context: UI shows raw UUIDs trong nhiều bảng (CEO feedback 21/04):
--   "các phần thông tin một số ô nó hiện mã chứ không hiện thông tin"
--
-- Các bảng trong 00012_warehouse_entities, 00016_fnb_tables và
-- 00025_ai_agents khai báo `created_by UUID NOT NULL` không FK
-- (hoặc FK tới auth.users). Migration này đồng bộ hóa chúng về
-- profiles(id) để giữ nguyên pattern đang dùng ở internal_sales.
--
-- Safe to re-run: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.
-- Nếu data có created_by không match profiles.id thì ADD FK sẽ fail —
-- chạy validation query (bottom) trước nếu nghi ngờ.
-- ============================================================

-- 1. disposal_exports (xuất hủy)
ALTER TABLE public.disposal_exports
  DROP CONSTRAINT IF EXISTS disposal_exports_created_by_fkey;
ALTER TABLE public.disposal_exports
  ADD CONSTRAINT disposal_exports_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id);

-- 2. internal_exports (xuất dùng nội bộ)
ALTER TABLE public.internal_exports
  DROP CONSTRAINT IF EXISTS internal_exports_created_by_fkey;
ALTER TABLE public.internal_exports
  ADD CONSTRAINT internal_exports_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id);

-- 3. sales_orders (đơn hàng bán — chưa có FK)
ALTER TABLE public.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_created_by_fkey;
ALTER TABLE public.sales_orders
  ADD CONSTRAINT sales_orders_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id);

-- 4. kitchen_orders (đơn bếp)
ALTER TABLE public.kitchen_orders
  DROP CONSTRAINT IF EXISTS kitchen_orders_created_by_fkey;
ALTER TABLE public.kitchen_orders
  ADD CONSTRAINT kitchen_orders_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id);

-- 5. agents (AI Agent config — reference auth.users → switch to profiles)
ALTER TABLE public.agents
  DROP CONSTRAINT IF EXISTS agents_created_by_fkey;
ALTER TABLE public.agents
  ADD CONSTRAINT agents_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id);

-- 6. input_invoices (hoá đơn đầu vào — 00012)
ALTER TABLE public.input_invoices
  DROP CONSTRAINT IF EXISTS input_invoices_created_by_fkey;
ALTER TABLE public.input_invoices
  ADD CONSTRAINT input_invoices_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id);

-- 7. supplier_returns (trả hàng nhập — 00012)
ALTER TABLE public.supplier_returns
  DROP CONSTRAINT IF EXISTS supplier_returns_created_by_fkey;
ALTER TABLE public.supplier_returns
  ADD CONSTRAINT supplier_returns_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id);

-- 8. purchase_order_entries (nếu có — dựng draft receipts trước khi complete)
-- Migration guard: only ALTER nếu bảng tồn tại
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'purchase_order_entries'
  ) THEN
    EXECUTE 'ALTER TABLE public.purchase_order_entries
      DROP CONSTRAINT IF EXISTS purchase_order_entries_created_by_fkey';
    EXECUTE 'ALTER TABLE public.purchase_order_entries
      ADD CONSTRAINT purchase_order_entries_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.profiles(id)';
  END IF;
END $$;

-- ============================================================
-- Validation queries (chạy trước nếu production đã có data cũ):
--
-- SELECT 'disposal_exports' AS t, created_by FROM public.disposal_exports
--  WHERE created_by NOT IN (SELECT id FROM public.profiles);
-- SELECT 'internal_exports' AS t, created_by FROM public.internal_exports
--  WHERE created_by NOT IN (SELECT id FROM public.profiles);
-- SELECT 'sales_orders' AS t, created_by FROM public.sales_orders
--  WHERE created_by NOT IN (SELECT id FROM public.profiles);
-- SELECT 'kitchen_orders' AS t, created_by FROM public.kitchen_orders
--  WHERE created_by NOT IN (SELECT id FROM public.profiles);
-- SELECT 'agents' AS t, created_by FROM public.agents
--  WHERE created_by NOT IN (SELECT id FROM public.profiles);
-- SELECT 'input_invoices' AS t, created_by FROM public.input_invoices
--  WHERE created_by NOT IN (SELECT id FROM public.profiles);
-- SELECT 'supplier_returns' AS t, created_by FROM public.supplier_returns
--  WHERE created_by NOT IN (SELECT id FROM public.profiles);
-- ============================================================
