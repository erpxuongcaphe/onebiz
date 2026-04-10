-- ============================================================
-- Migration 00014: RLS Hardening — Production Ready
--
-- Mục đích:
--   1. RE-ENABLE RLS trên TOÀN BỘ tables (undo 00010_dev_disable_rls)
--   2. FIX policies sai trên stock_transfers (00013)
--   3. ADD policies cho stock_transfer_items (child table)
--   4. ADD policies cho 00012 warehouse tables thiếu CRUD granular
--   5. Đảm bảo mọi table có tenant isolation qua get_user_tenant_id()
--
-- ⚠️  SAU KHI CHẠY MIGRATION NÀY:
--   - Phải có authenticated user (auth session) để truy cập dữ liệu
--   - NEXT_PUBLIC_BYPASS_AUTH=true sẽ KHÔNG hoạt động với anon key
--   - Service role key vẫn bypass RLS (dùng cho admin/migration)
-- ============================================================

-- ============================================================
-- STEP 1: RE-ENABLE RLS trên tất cả tables
-- ============================================================

-- Tables từ 00001_initial_schema
ALTER TABLE public.tenants                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_books              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_prices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_checks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_check_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_returns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_partners        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_channels           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_sequences           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log                ENABLE ROW LEVEL SECURITY;

-- Tables từ 00004_new_features
ALTER TABLE public.favorites                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_usages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_tiers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages    ENABLE ROW LEVEL SECURITY;

-- Tables từ 00006_foundation
ALTER TABLE public.product_variants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_items                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uom_conversions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_stock                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_code_sequences         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_order_materials   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_lots                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lot_allocations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_tiers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_tier_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_transitions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_items               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_history             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_automations         ENABLE ROW LEVEL SECURITY;

-- Tables từ 00012_warehouse_entities
ALTER TABLE public.supplier_returns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_return_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.input_invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disposal_exports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disposal_export_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_exports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_export_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_items        ENABLE ROW LEVEL SECURITY;

-- Tables từ 00013_stock_transfers
ALTER TABLE public.stock_transfers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_items     ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- STEP 2: FIX stock_transfers — drop broken policies, create correct ones
-- ============================================================

-- Drop the bad policies from 00013
DROP POLICY IF EXISTS "stock_transfers_tenant_isolation" ON public.stock_transfers;
DROP POLICY IF EXISTS "stock_transfer_items_via_transfer" ON public.stock_transfer_items;

-- Correct: tenant isolation via get_user_tenant_id()
CREATE POLICY "stock_transfers_select" ON public.stock_transfers
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "stock_transfers_insert" ON public.stock_transfers
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "stock_transfers_update" ON public.stock_transfers
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "stock_transfers_delete" ON public.stock_transfers
  FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- Child: via parent stock_transfers
CREATE POLICY "stock_transfer_items_select" ON public.stock_transfer_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.stock_transfers st
      WHERE st.id = stock_transfer_items.transfer_id
      AND st.tenant_id = public.get_user_tenant_id()
    )
  );
CREATE POLICY "stock_transfer_items_insert" ON public.stock_transfer_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.stock_transfers st
      WHERE st.id = stock_transfer_items.transfer_id
      AND st.tenant_id = public.get_user_tenant_id()
    )
  );
CREATE POLICY "stock_transfer_items_update" ON public.stock_transfer_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.stock_transfers st
      WHERE st.id = stock_transfer_items.transfer_id
      AND st.tenant_id = public.get_user_tenant_id()
    )
  );
CREATE POLICY "stock_transfer_items_delete" ON public.stock_transfer_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.stock_transfers st
      WHERE st.id = stock_transfer_items.transfer_id
      AND st.tenant_id = public.get_user_tenant_id()
    )
  );


-- ============================================================
-- STEP 3: Granular CRUD policies for 00012 warehouse tables
--
-- 00012 only created FOR ALL policies. Drop those and add
-- per-operation (SELECT/INSERT/UPDATE/DELETE) policies for
-- consistency and finer-grained control.
-- ============================================================

-- supplier_returns
DROP POLICY IF EXISTS "tenant_isolation" ON public.supplier_returns;
CREATE POLICY "supplier_returns_select" ON public.supplier_returns
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "supplier_returns_insert" ON public.supplier_returns
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "supplier_returns_update" ON public.supplier_returns
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "supplier_returns_delete" ON public.supplier_returns
  FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- supplier_return_items (child via parent)
DROP POLICY IF EXISTS "tenant_via_parent" ON public.supplier_return_items;
CREATE POLICY "supplier_return_items_select" ON public.supplier_return_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.supplier_returns sr
    WHERE sr.id = supplier_return_items.return_id
    AND sr.tenant_id = public.get_user_tenant_id())
  );
CREATE POLICY "supplier_return_items_insert" ON public.supplier_return_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.supplier_returns sr
    WHERE sr.id = supplier_return_items.return_id
    AND sr.tenant_id = public.get_user_tenant_id())
  );
CREATE POLICY "supplier_return_items_update" ON public.supplier_return_items
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.supplier_returns sr
    WHERE sr.id = supplier_return_items.return_id
    AND sr.tenant_id = public.get_user_tenant_id())
  );

-- input_invoices
DROP POLICY IF EXISTS "tenant_isolation" ON public.input_invoices;
CREATE POLICY "input_invoices_select" ON public.input_invoices
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "input_invoices_insert" ON public.input_invoices
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "input_invoices_update" ON public.input_invoices
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "input_invoices_delete" ON public.input_invoices
  FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- disposal_exports
DROP POLICY IF EXISTS "tenant_isolation" ON public.disposal_exports;
CREATE POLICY "disposal_exports_select" ON public.disposal_exports
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "disposal_exports_insert" ON public.disposal_exports
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "disposal_exports_update" ON public.disposal_exports
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "disposal_exports_delete" ON public.disposal_exports
  FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- disposal_export_items (child)
DROP POLICY IF EXISTS "tenant_via_parent" ON public.disposal_export_items;
CREATE POLICY "disposal_export_items_select" ON public.disposal_export_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.disposal_exports de
    WHERE de.id = disposal_export_items.disposal_id
    AND de.tenant_id = public.get_user_tenant_id())
  );
CREATE POLICY "disposal_export_items_insert" ON public.disposal_export_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.disposal_exports de
    WHERE de.id = disposal_export_items.disposal_id
    AND de.tenant_id = public.get_user_tenant_id())
  );
CREATE POLICY "disposal_export_items_update" ON public.disposal_export_items
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.disposal_exports de
    WHERE de.id = disposal_export_items.disposal_id
    AND de.tenant_id = public.get_user_tenant_id())
  );

-- internal_exports
DROP POLICY IF EXISTS "tenant_isolation" ON public.internal_exports;
CREATE POLICY "internal_exports_select" ON public.internal_exports
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "internal_exports_insert" ON public.internal_exports
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "internal_exports_update" ON public.internal_exports
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "internal_exports_delete" ON public.internal_exports
  FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- internal_export_items (child)
DROP POLICY IF EXISTS "tenant_via_parent" ON public.internal_export_items;
CREATE POLICY "internal_export_items_select" ON public.internal_export_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.internal_exports ie
    WHERE ie.id = internal_export_items.export_id
    AND ie.tenant_id = public.get_user_tenant_id())
  );
CREATE POLICY "internal_export_items_insert" ON public.internal_export_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.internal_exports ie
    WHERE ie.id = internal_export_items.export_id
    AND ie.tenant_id = public.get_user_tenant_id())
  );
CREATE POLICY "internal_export_items_update" ON public.internal_export_items
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.internal_exports ie
    WHERE ie.id = internal_export_items.export_id
    AND ie.tenant_id = public.get_user_tenant_id())
  );

-- sales_orders
DROP POLICY IF EXISTS "tenant_isolation" ON public.sales_orders;
CREATE POLICY "sales_orders_select" ON public.sales_orders
  FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "sales_orders_insert" ON public.sales_orders
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "sales_orders_update" ON public.sales_orders
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "sales_orders_delete" ON public.sales_orders
  FOR DELETE USING (tenant_id = public.get_user_tenant_id());

-- sales_order_items (child)
DROP POLICY IF EXISTS "tenant_via_parent" ON public.sales_order_items;
CREATE POLICY "sales_order_items_select" ON public.sales_order_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.sales_orders so
    WHERE so.id = sales_order_items.order_id
    AND so.tenant_id = public.get_user_tenant_id())
  );
CREATE POLICY "sales_order_items_insert" ON public.sales_order_items
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.sales_orders so
    WHERE so.id = sales_order_items.order_id
    AND so.tenant_id = public.get_user_tenant_id())
  );
CREATE POLICY "sales_order_items_update" ON public.sales_order_items
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.sales_orders so
    WHERE so.id = sales_order_items.order_id
    AND so.tenant_id = public.get_user_tenant_id())
  );


-- ============================================================
-- STEP 4: Add missing UPDATE policy for stock_movements & cash_transactions
-- (Sprint 6 cross-entity operations need to update status on these)
-- ============================================================

-- stock_movements: allow update for status changes
CREATE POLICY "stock_moves_update" ON public.stock_movements
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

-- cash_transactions: allow update for reconciliation
CREATE POLICY "cash_update" ON public.cash_transactions
  FOR UPDATE USING (tenant_id = public.get_user_tenant_id());

-- audit_log: allow insert for write operations that log
CREATE POLICY "audit_insert" ON public.audit_log
  FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());


-- ============================================================
-- STEP 5: Verify — count tables with RLS still disabled
-- ============================================================
DO $$
DECLARE
  v_count int;
  v_total int;
BEGIN
  SELECT count(*) INTO v_total
  FROM pg_tables WHERE schemaname = 'public';

  SELECT count(*) INTO v_count
  FROM pg_tables
  WHERE schemaname = 'public' AND rowsecurity = false;

  RAISE NOTICE '🔒 RLS Hardening complete. % / % public tables have RLS enabled. % tables without RLS.',
    v_total - v_count, v_total, v_count;
END $$;
