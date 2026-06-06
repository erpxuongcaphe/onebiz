-- ============================================================
-- Migration 00130: Sync customers.debt + suppliers.debt aggregates
--
-- ROOT CAUSE (CEO 06/06/2026):
--   /tai-chinh/cong-no hiển thị 0 KH nợ nhưng /phan-tich/cong-no-aging
--   hiển thị 4 KH nợ 3,180,000đ. Lý do: khi POS bán đơn nợ
--   (pos_complete_checkout_atomic / completeDraftOrder), code INSERT
--   invoice với debt > 0 NHƯNG KHÔNG update cột customers.debt.
--   Tương tự suppliers.debt không sync khi tạo phiếu nhập nợ.
--
-- GIẢI PHÁP:
--   Thay vì sửa nhiều entry-point (POS Retail, POS FnB, completeDraftOrder,
--   editInvoice, cancelInvoice, recordPurchasePayment, returns…), thêm
--   trigger DB-level → mọi đường vào đều tự sync.
--
-- AN TOÀN:
--   - Trigger chỉ recompute aggregates (customers.debt, suppliers.debt) từ
--     invoices/purchase_orders. KHÔNG đụng data gốc.
--   - Idempotent: chạy 1 hay 10 lần kết quả như nhau.
--   - One-time backfill ở cuối để fix data hiện tại.
--   - Không có recursion (trigger chỉ trên invoices/PO, không trên
--     customers/suppliers).
--
-- ROLLBACK: DROP TRIGGER + DROP FUNCTION (không mất data).
-- ============================================================

-- ============================================================
-- 1. Function: recompute customer debt từ invoices
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_customer_debt(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN;
  END IF;

  -- SUM debt từ invoices không bị hủy
  -- (draft + completed đều tính — draft cũng có thể đã thu trước)
  SELECT COALESCE(SUM(GREATEST(0, debt)), 0)
    INTO v_total
    FROM public.invoices
   WHERE customer_id = p_customer_id
     AND status <> 'cancelled';

  UPDATE public.customers
     SET debt = v_total,
         updated_at = now()
   WHERE id = p_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_customer_debt(uuid)
  TO authenticated, service_role;

-- ============================================================
-- 2. Function: recompute supplier debt từ purchase_orders
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_supplier_debt(p_supplier_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
BEGIN
  IF p_supplier_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(GREATEST(0, debt)), 0)
    INTO v_total
    FROM public.purchase_orders
   WHERE supplier_id = p_supplier_id
     AND status <> 'cancelled';

  UPDATE public.suppliers
     SET debt = v_total,
         updated_at = now()
   WHERE id = p_supplier_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_supplier_debt(uuid)
  TO authenticated, service_role;

-- ============================================================
-- 3. Trigger: invoices → recompute customers.debt
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_sync_customer_debt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Handle customer change (rare but possible): recompute CẢ 2 customer
  IF TG_OP = 'UPDATE' AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    PERFORM public.recompute_customer_debt(OLD.customer_id);
    PERFORM public.recompute_customer_debt(NEW.customer_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_customer_debt(OLD.customer_id);
    RETURN OLD;
  END IF;

  -- INSERT or UPDATE same customer
  PERFORM public.recompute_customer_debt(COALESCE(NEW.customer_id, OLD.customer_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_sync_customer_debt ON public.invoices;
CREATE TRIGGER trg_invoices_sync_customer_debt
AFTER INSERT OR UPDATE OF debt, customer_id, status OR DELETE
ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_customer_debt();

-- ============================================================
-- 4. Trigger: purchase_orders → recompute suppliers.debt
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_sync_supplier_debt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
    PERFORM public.recompute_supplier_debt(OLD.supplier_id);
    PERFORM public.recompute_supplier_debt(NEW.supplier_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_supplier_debt(OLD.supplier_id);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_supplier_debt(COALESCE(NEW.supplier_id, OLD.supplier_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_orders_sync_supplier_debt ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_sync_supplier_debt
AFTER INSERT OR UPDATE OF debt, supplier_id, status OR DELETE
ON public.purchase_orders
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_supplier_debt();

-- ============================================================
-- 5. ONE-TIME BACKFILL: sync TẤT CẢ customers + suppliers hiện tại
--    từ aggregates của invoices + purchase_orders.
-- ============================================================

-- 5a. Backfill customers.debt từ invoices
UPDATE public.customers c
   SET debt = COALESCE(agg.total_debt, 0),
       updated_at = now()
  FROM (
    SELECT customer_id, COALESCE(SUM(GREATEST(0, debt)), 0) AS total_debt
      FROM public.invoices
     WHERE customer_id IS NOT NULL
       AND status <> 'cancelled'
     GROUP BY customer_id
  ) agg
 WHERE c.id = agg.customer_id;

-- Set debt = 0 cho customers không có invoice nào (đã trả đủ hoặc chưa từng nợ)
UPDATE public.customers
   SET debt = 0,
       updated_at = now()
 WHERE debt <> 0
   AND id NOT IN (
     SELECT DISTINCT customer_id
       FROM public.invoices
      WHERE customer_id IS NOT NULL
        AND status <> 'cancelled'
        AND debt > 0
   );

-- 5b. Backfill suppliers.debt từ purchase_orders
UPDATE public.suppliers s
   SET debt = COALESCE(agg.total_debt, 0),
       updated_at = now()
  FROM (
    SELECT supplier_id, COALESCE(SUM(GREATEST(0, debt)), 0) AS total_debt
      FROM public.purchase_orders
     WHERE supplier_id IS NOT NULL
       AND status <> 'cancelled'
     GROUP BY supplier_id
  ) agg
 WHERE s.id = agg.supplier_id;

UPDATE public.suppliers
   SET debt = 0,
       updated_at = now()
 WHERE debt <> 0
   AND id NOT IN (
     SELECT DISTINCT supplier_id
       FROM public.purchase_orders
      WHERE supplier_id IS NOT NULL
        AND status <> 'cancelled'
        AND debt > 0
   );

-- ============================================================
-- 6. VERIFY (chạy ở cuối để CEO thấy kết quả)
-- ============================================================
DO $$
DECLARE
  v_cust_synced int;
  v_supp_synced int;
  v_cust_total numeric;
  v_supp_total numeric;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(debt), 0)
    INTO v_cust_synced, v_cust_total
    FROM public.customers
   WHERE debt > 0;

  SELECT COUNT(*), COALESCE(SUM(debt), 0)
    INTO v_supp_synced, v_supp_total
    FROM public.suppliers
   WHERE debt > 0;

  RAISE NOTICE '[Migration 00130] Backfill xong:';
  RAISE NOTICE '  Khách hàng còn nợ: % KH, tổng %', v_cust_synced, v_cust_total;
  RAISE NOTICE '  NCC phải trả: % NCC, tổng %', v_supp_synced, v_supp_total;
END $$;
