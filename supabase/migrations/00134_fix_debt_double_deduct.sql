-- ============================================================
-- Migration 00134: FIX công nợ bị trừ/cộng 2 LẦN trong RPC sổ quỹ
-- ============================================================
--
-- CEO 10/06/2026 — audit toàn web phát hiện P0 TIỀN SAI.
--
-- LỖI:
--   3 RPC ở 00046 (record_invoice_payment, record_purchase_payment,
--   cancel_cash_transaction) vừa UPDATE invoices/purchase_orders.debt
--   (→ kích hoạt trigger 00130 `trg_*_sync_*_debt` tự RECOMPUTE
--   customers/suppliers.debt = SUM(HĐ completed) = ĐÚNG), VỪA trừ/cộng
--   TAY customers/suppliers.debt thêm 1 lần nữa → trừ/cộng 2 lần.
--
--   Hệ quả:
--   - Thu nợ KH A đồng → customers.debt giảm 2A (thấp hơn thực tế).
--   - Trả nợ NCC → suppliers.debt giảm 2A.
--   - Hủy phiếu → debt cộng 2A (phình).
--   Giá trị sai TỒN TẠI tới lần trigger kế tiếp recompute đè lại, rồi
--   lại sai sau giao dịch nợ tiếp theo → aggregate công nợ KHÔNG đáng tin.
--
-- TẠI SAO 00133 CHƯA FIX:
--   00133 + payments.ts:165 chỉ gỡ write phía TypeScript (fallback path).
--   Nhưng RPC 00046 mới là ĐƯỜNG CHẠY THẬT (service gọi RPC trước) —
--   thân RPC vẫn còn block trừ tay → bug sống.
--
-- FIX (migration này):
--   CREATE OR REPLACE 3 RPC y hệt 00046 nhưng BỎ block UPDATE
--   customers/suppliers SET debt = debt ± amount. Để TRIGGER 00130 là
--   NGUỒN DUY NHẤT (Single Source of Truth) — giống pattern đúng ở
--   `void_completed_invoice_atomic` (00117) chỉ set invoices.debt, KHÔNG
--   đụng customers.debt.
--
--   Sau đó RECOMPUTE toàn bộ để sửa data đã lệch.
--
-- AN TOÀN: chỉ thay thân 3 function (idempotent CREATE OR REPLACE),
--   KHÔNG đụng schema/bảng/data trực tiếp ngoài recompute cuối.
-- ============================================================

-- ============================================================
-- 1. record_invoice_payment — BỎ block update customers.debt (bước 6 cũ)
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_note text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_invoice record;
  v_cash_id uuid;
  v_cash_code text;
  v_new_paid numeric;
  v_new_debt numeric;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT id, tenant_id, branch_id, code, customer_id, customer_name,
         total, paid, debt, status
    INTO v_invoice
    FROM public.invoices
   WHERE id = p_invoice_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy hóa đơn';
  END IF;

  v_tenant_id := v_invoice.tenant_id;
  v_branch_id := COALESCE(p_branch_id, v_invoice.branch_id);

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Số tiền thanh toán phải lớn hơn 0';
  END IF;
  IF v_invoice.debt <= 0 THEN
    RAISE EXCEPTION 'Hóa đơn này không còn công nợ';
  END IF;
  IF p_amount > v_invoice.debt THEN
    RAISE EXCEPTION 'Số tiền (%) vượt quá công nợ còn lại (%)', p_amount, v_invoice.debt;
  END IF;
  IF p_payment_method NOT IN ('cash', 'transfer', 'card', 'ewallet') THEN
    RAISE EXCEPTION 'Phương thức không hợp lệ: %', p_payment_method;
  END IF;

  v_new_paid := v_invoice.paid + p_amount;
  v_new_debt := v_invoice.debt - p_amount;

  v_cash_code := 'PT' || lpad(
    (COALESCE(
      (SELECT MAX(CAST(REGEXP_REPLACE(code, '[^0-9]', '', 'g') AS bigint))
         FROM public.cash_transactions
        WHERE tenant_id = v_tenant_id AND code LIKE 'PT%'
      ), 0) + 1
    )::text, 6, '0'
  );

  INSERT INTO public.cash_transactions (
    tenant_id, branch_id, code, type, category, amount, counterparty,
    payment_method, reference_type, reference_id, customer_id,
    note, created_by, status, transaction_date
  ) VALUES (
    v_tenant_id, v_branch_id, v_cash_code, 'receipt', 'customer_payment',
    p_amount, v_invoice.customer_name, p_payment_method,
    'invoice', v_invoice.id, v_invoice.customer_id,
    COALESCE(p_note, 'Thu nợ hóa đơn ' || v_invoice.code),
    v_user_id, 'completed', CURRENT_DATE
  ) RETURNING id INTO v_cash_id;

  -- Update invoice — trigger trg_invoices_sync_customer_debt (00130) sẽ
  -- TỰ recompute customers.debt = SUM(HĐ completed). KHÔNG trừ tay nữa.
  UPDATE public.invoices
     SET paid = v_new_paid,
         debt = v_new_debt,
         updated_at = now()
   WHERE id = v_invoice.id;

  -- [BỎ] block "UPDATE customers SET debt = debt - p_amount" — gây trừ 2 lần.

  RETURN jsonb_build_object(
    'cash_transaction_id', v_cash_id,
    'cash_code', v_cash_code,
    'new_paid', v_new_paid,
    'new_debt', v_new_debt
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_invoice_payment(uuid, numeric, text, text, uuid, uuid)
  TO authenticated, service_role;

-- ============================================================
-- 2. record_purchase_payment — BỎ block update suppliers.debt
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_purchase_payment(
  p_purchase_order_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_note text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_branch_id uuid;
  v_user_id uuid;
  v_po record;
  v_cash_id uuid;
  v_cash_code text;
  v_new_paid numeric;
  v_new_debt numeric;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  SELECT id, tenant_id, branch_id, code, supplier_id, supplier_name,
         total, paid, debt, status
    INTO v_po
    FROM public.purchase_orders
   WHERE id = p_purchase_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy đơn nhập hàng';
  END IF;

  v_tenant_id := v_po.tenant_id;
  v_branch_id := COALESCE(p_branch_id, v_po.branch_id);

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Số tiền thanh toán phải lớn hơn 0';
  END IF;
  IF v_po.debt <= 0 THEN
    RAISE EXCEPTION 'Đơn nhập hàng này không còn công nợ';
  END IF;
  IF p_amount > v_po.debt THEN
    RAISE EXCEPTION 'Số tiền (%) vượt quá công nợ còn lại (%)', p_amount, v_po.debt;
  END IF;
  IF p_payment_method NOT IN ('cash', 'transfer', 'card', 'ewallet') THEN
    RAISE EXCEPTION 'Phương thức không hợp lệ: %', p_payment_method;
  END IF;

  v_new_paid := v_po.paid + p_amount;
  v_new_debt := v_po.debt - p_amount;

  v_cash_code := 'PC' || lpad(
    (COALESCE(
      (SELECT MAX(CAST(REGEXP_REPLACE(code, '[^0-9]', '', 'g') AS bigint))
         FROM public.cash_transactions
        WHERE tenant_id = v_tenant_id AND code LIKE 'PC%'
      ), 0) + 1
    )::text, 6, '0'
  );

  INSERT INTO public.cash_transactions (
    tenant_id, branch_id, code, type, category, amount, counterparty,
    payment_method, reference_type, reference_id, supplier_id,
    note, created_by, status, transaction_date
  ) VALUES (
    v_tenant_id, v_branch_id, v_cash_code, 'payment', 'supplier_payment',
    p_amount, v_po.supplier_name, p_payment_method,
    'purchase_order', v_po.id, v_po.supplier_id,
    COALESCE(p_note, 'Trả nợ đơn nhập hàng ' || v_po.code),
    v_user_id, 'completed', CURRENT_DATE
  ) RETURNING id INTO v_cash_id;

  -- Update PO — trigger trg_purchase_orders_sync_supplier_debt (00130) sẽ
  -- TỰ recompute suppliers.debt. KHÔNG trừ tay nữa.
  UPDATE public.purchase_orders
     SET paid = v_new_paid,
         debt = v_new_debt,
         updated_at = now()
   WHERE id = v_po.id;

  -- [BỎ] block "UPDATE suppliers SET debt = debt - p_amount" — gây trừ 2 lần.

  RETURN jsonb_build_object(
    'cash_transaction_id', v_cash_id,
    'cash_code', v_cash_code,
    'new_paid', v_new_paid,
    'new_debt', v_new_debt
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_purchase_payment(uuid, numeric, text, text, uuid, uuid)
  TO authenticated, service_role;

-- ============================================================
-- 3. cancel_cash_transaction — BỎ block đảo customers/suppliers.debt
-- ============================================================
--
-- Khi hủy phiếu: chỉ cần đảo invoices/purchase_orders.debt (+= amount),
-- trigger 00130 tự recompute customers/suppliers.debt. KHÔNG cộng tay.

CREATE OR REPLACE FUNCTION public.cancel_cash_transaction(
  p_cash_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash record;
BEGIN
  SELECT id, tenant_id, type, amount, reference_type, reference_id,
         customer_id, supplier_id, status, code
    INTO v_cash
    FROM public.cash_transactions
   WHERE id = p_cash_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu';
  END IF;

  IF v_cash.status = 'cancelled' THEN
    RAISE EXCEPTION 'Phiếu đã bị hủy trước đó';
  END IF;

  -- Đảo invoice/PO debt — trigger 00130 tự recompute customer/supplier debt.
  IF v_cash.reference_type = 'invoice' AND v_cash.reference_id IS NOT NULL THEN
    UPDATE public.invoices
       SET paid = GREATEST(0, paid - v_cash.amount),
           debt = debt + v_cash.amount,
           updated_at = now()
     WHERE id = v_cash.reference_id;
    -- [BỎ] block "UPDATE customers SET debt = debt + amount" — gây cộng 2 lần.

  ELSIF v_cash.reference_type = 'purchase_order' AND v_cash.reference_id IS NOT NULL THEN
    UPDATE public.purchase_orders
       SET paid = GREATEST(0, paid - v_cash.amount),
           debt = debt + v_cash.amount,
           updated_at = now()
     WHERE id = v_cash.reference_id;
    -- [BỎ] block "UPDATE suppliers SET debt = debt + amount" — gây cộng 2 lần.
  END IF;

  UPDATE public.cash_transactions
     SET status = 'cancelled',
         note = COALESCE(note, '') || E'\n[HỦY] ' || COALESCE(p_reason, ''),
         updated_at = now()
   WHERE id = v_cash.id;

  RETURN jsonb_build_object(
    'cash_id', v_cash.id,
    'cash_code', v_cash.code,
    'reversed_amount', v_cash.amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_cash_transaction(uuid, text)
  TO authenticated, service_role;

-- ============================================================
-- 4. RECOMPUTE toàn bộ — sửa data công nợ đã lệch do bug trừ 2 lần
-- ============================================================
-- 2 hàm này định nghĩa ở 00133, recompute customers/suppliers.debt =
-- SUM(HĐ/PO completed) cho mọi entity. Chạy lại để dọn data sai.

SELECT public.recompute_all_customer_debts();
SELECT public.recompute_all_supplier_debts();
