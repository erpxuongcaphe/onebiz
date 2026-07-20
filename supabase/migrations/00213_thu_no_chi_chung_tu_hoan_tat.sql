-- ============================================================
-- Migration 00213: THU NỢ CHỈ TRÊN CHỨNG TỪ ĐÃ HOÀN TẤT
-- ============================================================
--
-- Sự cố HD001438 (17/07): nháp NH000023 mang debt=540k từ lúc tạo
-- → 09:29 thu ngân "thu nợ" ngay trên NHÁP (PT000115, RPC không kiểm status)
-- → checkout POS ghi đè paid/debt theo màn thanh toán → nợ 540k hiện lại
-- → 14:03 thu nợ lần 2 (PT000117) → sổ quỹ thừa 540.000đ.
--
-- FIX: record_invoice_payment chỉ nhận HĐ status='completed';
--      record_purchase_payment chỉ nhận phiếu nhập completed/partial.
-- Thân hàm còn lại COPY NGUYÊN VĂN bản sống 00134 (đã bỏ update tay
-- customers/suppliers.debt). Code app (payments.ts) cũng đã lọc
-- danh sách chọn đơn + guard fallback cùng ngày.
--
-- AN TOÀN: CREATE OR REPLACE 2 function, không đụng data.
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

  -- [00213] HD001438 17/07: nháp mang debt=total nên thu nợ được cả ĐƠN NHÁP;
  -- checkout sau đó ghi đè paid → nợ hiện lại → thu lần 2 (sổ quỹ thừa 540k).
  -- Chỉ hóa đơn đã hoàn tất mới có nợ thật để thu.
  IF v_invoice.status <> 'completed' THEN
    RAISE EXCEPTION 'Hóa đơn % chưa hoàn tất — đơn nháp/đặt hàng thu tiền khi thanh toán trên POS', v_invoice.code;
  END IF;

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

  -- [00213] cùng lý do HD001438: chỉ trả nợ phiếu nhập đã nhập kho (completed/partial).
  IF v_po.status NOT IN ('completed', 'partial') THEN
    RAISE EXCEPTION 'Phiếu nhập % chưa nhập kho hoàn tất — không trả nợ được', v_po.code;
  END IF;

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
-- VERIFY (read-only)
-- ============================================================
SELECT proname,
       prosrc LIKE '%[00213]%' AS da_vao_guard
  FROM pg_proc
 WHERE proname IN ('record_invoice_payment', 'record_purchase_payment');
-- Kỳ vọng: 2 dòng, da_vao_guard = true cả 2.
