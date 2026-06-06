-- ============================================================
-- Migration 00133: Debt aggregate hardening — Plan A from research
--
-- CEO 06/06/2026 báo bug: Xưởng Premium BL hiển thị 280k nhưng thực tế
-- 140k. Root cause: race condition giữa trigger 00130 và app-side write
-- `customers.debt -= amount` trong recordInvoicePayment (payments.ts:165).
--
-- Plus phát hiện thêm 2 lỗi trong trigger 00130:
--   1. Include cả `draft` invoices vào tổng nợ (sai — chỉ completed mới
--      là phải thu thực sự).
--   2. Include cả customer_id của khách lẻ POS (KL-VL) — KPI thổi phồng.
--
-- Research finding (Odoo + SAP B1 + PG community): Trigger DB là Single
-- Source of Truth. App-side đã bỏ trong commit code song song.
--
-- FIX:
--   1. Sửa trigger 00130 chỉ tính status='completed'
--   2. Re-recompute TẤT CẢ customers + suppliers
--   3. Add RPC public hook để UI gọi "Đối chiếu lại" thủ công
--
-- AN TOÀN:
--   - REPLACE function (không drop trigger → không mất events)
--   - Idempotent — chạy lại không sai
--   - Backfill all-or-nothing
-- ============================================================

-- 1. SỬA function recompute_customer_debt: chỉ tính 'completed'
CREATE OR REPLACE FUNCTION public.recompute_customer_debt(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
BEGIN
  IF p_customer_id IS NULL THEN RETURN; END IF;

  -- CHỈ status='completed' (sửa từ 'status <> cancelled' của 00130).
  -- Draft là dự thảo chưa phát hành → không phải nợ phải thu thực.
  SELECT COALESCE(SUM(GREATEST(0, debt)), 0)
    INTO v_total
    FROM public.invoices
   WHERE customer_id = p_customer_id
     AND status = 'completed';

  UPDATE public.customers
     SET debt = v_total,
         updated_at = now()
   WHERE id = p_customer_id;
END;
$$;

-- 2. SỬA function recompute_supplier_debt tương tự
CREATE OR REPLACE FUNCTION public.recompute_supplier_debt(p_supplier_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
BEGIN
  IF p_supplier_id IS NULL THEN RETURN; END IF;

  -- PO: 'completed' + 'partial' (đã nhận 1 phần thì nợ thật)
  SELECT COALESCE(SUM(GREATEST(0, debt)), 0)
    INTO v_total
    FROM public.purchase_orders
   WHERE supplier_id = p_supplier_id
     AND status IN ('completed', 'partial');

  UPDATE public.suppliers
     SET debt = v_total,
         updated_at = now()
   WHERE id = p_supplier_id;
END;
$$;

-- 3. RECOMPUTE_ALL — RPC public cho UI gọi "Đối chiếu lại toàn bộ"
CREATE OR REPLACE FUNCTION public.recompute_all_customer_debts()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.customers LOOP
    PERFORM public.recompute_customer_debt(v_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_all_supplier_debts()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.suppliers LOOP
    PERFORM public.recompute_supplier_debt(v_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_all_customer_debts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_all_supplier_debts() TO authenticated, service_role;

-- 4. CHẠY NGAY — re-sync TẤT CẢ customers + suppliers theo formula mới
SELECT public.recompute_all_customer_debts();
SELECT public.recompute_all_supplier_debts();

-- 5. VERIFY
DO $$
DECLARE
  v_cust_count int;
  v_cust_total numeric;
  v_supp_count int;
  v_supp_total numeric;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(debt), 0)
    INTO v_cust_count, v_cust_total
    FROM public.customers WHERE debt > 0;

  SELECT COUNT(*), COALESCE(SUM(debt), 0)
    INTO v_supp_count, v_supp_total
    FROM public.suppliers WHERE debt > 0;

  RAISE NOTICE '[Migration 00133] Re-sync xong (chỉ status=completed):';
  RAISE NOTICE '  KH còn nợ: % KH, tổng % đồng', v_cust_count, v_cust_total;
  RAISE NOTICE '  NCC phải trả: % NCC, tổng % đồng', v_supp_count, v_supp_total;
  RAISE NOTICE 'Trigger 00130 vẫn fire — chỉ formula recompute đã thay đổi.';
END $$;
