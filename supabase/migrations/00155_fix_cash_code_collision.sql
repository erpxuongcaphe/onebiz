-- ============================================================
-- Migration 00155: FIX trùng mã phiếu thu/chi (23505) — hủy HĐ bị kẹt
-- ============================================================
--
-- CEO 04/07/2026 — hủy HD001284 báo lỗi:
--   duplicate key value violates unique constraint
--   "cash_transactions_tenant_id_code_key" (code: 23505)
--
-- CHẨN ĐOÁN (đo trên DB thật):
--   code_sequences.cash_payment  = prefix 'CA', current_number = 1
--   code_sequences.cash_receipt  = prefix 'CA', current_number = 85
--   → Phiếu THU và phiếu CHI dùng CHUNG dải mã 'CA…' nhưng đếm bằng
--     2 bộ đếm ĐỘC LẬP. Phiếu thu đã dùng CA000002..CA000085.
--     RPC hủy đơn (00117) xin mã phiếu chi → next_code trả 'CA000002'
--     (= phiếu thu cũ 05/06) → INSERT nổ 23505 → rollback → bộ đếm cũng
--     rollback → bấm lại vẫn đụng đúng mã đó → KẸT VĨNH VIỄN.
--
--   Gốc: next_code() tự sinh prefix = upper(left(entity_type, 2))
--   → 'cash_payment' và 'cash_receipt' CÙNG ra 'CA'.
--   Ngoài ra còn 2 nguồn sinh mã khác không nói chuyện với bộ đếm:
--   - record_invoice_payment / record_purchase_payment (00134): MAX+1
--     trực tiếp trên bảng theo prefix PT/PC.
--   - Dialog Sổ quỹ: Math.random 5 số (fix ở client cùng đợt này).
--
-- FIX (4 phần, tất cả idempotent):
--   1. Hàm MỚI next_cash_code(tenant, kind): MỘT cửa sinh mã duy nhất
--      cho phiếu thu (PT…) / phiếu chi (PC…):
--      khóa bộ đếm → GREATEST(bộ đếm, mã lớn nhất đã dùng) + 1 →
--      nếu mã đã tồn tại (mã lạ/random cũ) thì nhảy tiếp → cập nhật bộ đếm.
--   2. next_code(): delegate 'cash_payment'/'cash_receipt' sang
--      next_cash_code → RPC hủy đơn (00117), pos_checkout, mọi đường
--      TypeScript qua nextEntityCode() TỰ an toàn, KHÔNG phải sửa.
--   3. record_invoice_payment / record_purchase_payment: thay block
--      MAX+1 bằng next_cash_code (thân còn lại giữ NGUYÊN 00134).
--   4. Heal data: chuẩn hoá prefix PC/PT + đồng bộ bộ đếm ≥ mã đã dùng
--      (mọi tenant).
--
-- AN TOÀN: không đụng số tiền / công nợ / tồn kho / phiếu đã có.
-- Chỉ sửa CƠ CHẾ CẤP MÃ + 2 dòng prefix trong code_sequences.
-- ============================================================


-- ============================================================
-- 1. next_cash_code — MỘT cửa sinh mã phiếu thu/chi, chống trùng
-- ============================================================

CREATE OR REPLACE FUNCTION public.next_cash_code(
  p_tenant_id uuid,
  p_kind text  -- 'receipt' (phiếu thu PT) | 'payment' (phiếu chi PC)
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity text;
  v_prefix text;
  v_padding int := 6;
  v_counter bigint := 0;
  v_max_used bigint := 0;
  v_candidate bigint;
  v_code text;
  v_guard int := 0;
BEGIN
  IF p_kind = 'receipt' THEN
    v_entity := 'cash_receipt';  v_prefix := 'PT';
  ELSIF p_kind = 'payment' THEN
    v_entity := 'cash_payment';  v_prefix := 'PC';
  ELSE
    RAISE EXCEPTION 'next_cash_code: kind không hợp lệ: %', p_kind;
  END IF;

  -- Đảm bảo row bộ đếm tồn tại, rồi KHÓA nó (2 giao dịch đồng thời phải xếp hàng)
  INSERT INTO public.code_sequences (tenant_id, entity_type, prefix, current_number, padding)
  VALUES (p_tenant_id, v_entity, v_prefix, 0, 6)
  ON CONFLICT (tenant_id, entity_type) DO NOTHING;

  SELECT current_number, COALESCE(padding, 6)
    INTO v_counter, v_padding
    FROM public.code_sequences
   WHERE tenant_id = p_tenant_id AND entity_type = v_entity
   FOR UPDATE;

  -- Mã số lớn nhất ĐÃ DÙNG thật trong sổ. Chỉ xét dạng chuẩn PT/PC + 1..9
  -- chữ số — bỏ qua mã epoch 13 số của fallback cũ (PT17516…) để bộ đếm
  -- không nhảy lên nghìn tỷ.
  SELECT COALESCE(MAX(substring(code FROM 3)::bigint), 0)
    INTO v_max_used
    FROM public.cash_transactions
   WHERE tenant_id = p_tenant_id
     AND code ~ ('^' || v_prefix || '[0-9]{1,9}$');

  v_candidate := GREATEST(COALESCE(v_counter, 0), v_max_used) + 1;

  -- Mã lạ (random/manual) có thể chiếm chỗ phía trước → nhảy tiếp tới ô trống.
  LOOP
    v_code := v_prefix || lpad(
      v_candidate::text,
      GREATEST(v_padding, length(v_candidate::text)),  -- không bao giờ cắt số
      '0'
    );
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.cash_transactions
       WHERE tenant_id = p_tenant_id AND code = v_code
    );
    v_candidate := v_candidate + 1;
    v_guard := v_guard + 1;
    IF v_guard > 10000 THEN
      RAISE EXCEPTION 'next_cash_code: không tìm được mã trống (đã thử 10000)';
    END IF;
  END LOOP;

  UPDATE public.code_sequences
     SET current_number = v_candidate,
         prefix = v_prefix
   WHERE tenant_id = p_tenant_id AND entity_type = v_entity;

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_cash_code(uuid, text)
  TO authenticated, service_role;


-- ============================================================
-- 2. next_code — delegate phiếu thu/chi sang next_cash_code
--    (mọi caller cũ: RPC hủy đơn 00117, pos_checkout, nextEntityCode TS…
--     tự đi qua cửa an toàn, KHÔNG cần sửa từng chỗ)
-- ============================================================

CREATE OR REPLACE FUNCTION public.next_code(
  p_tenant_id uuid,
  p_entity_type text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prefix text;
  v_number int;
  v_padding int;
BEGIN
  -- CEO 04/07/2026 (00155): phiếu thu/chi có cửa sinh mã riêng chống trùng.
  IF p_entity_type = 'cash_payment' THEN
    RETURN public.next_cash_code(p_tenant_id, 'payment');
  ELSIF p_entity_type = 'cash_receipt' THEN
    RETURN public.next_cash_code(p_tenant_id, 'receipt');
  END IF;

  -- Các entity khác: giữ NGUYÊN logic gốc (00003).
  UPDATE public.code_sequences
  SET current_number = current_number + 1
  WHERE tenant_id = p_tenant_id
    AND entity_type = p_entity_type
  RETURNING prefix, current_number, padding
  INTO v_prefix, v_number, v_padding;

  IF NOT FOUND THEN
    INSERT INTO public.code_sequences (tenant_id, entity_type, prefix, current_number, padding)
    VALUES (p_tenant_id, p_entity_type, upper(left(p_entity_type, 2)), 1, 6)
    RETURNING prefix, current_number, padding
    INTO v_prefix, v_number, v_padding;
  END IF;

  RETURN v_prefix || lpad(v_number::text, v_padding, '0');
END;
$$;


-- ============================================================
-- 3a. record_invoice_payment — thay MAX+1 bằng next_cash_code
--     (thân còn lại COPY NGUYÊN 00134 — đã bỏ double-deduct)
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

  -- 00155: MỘT cửa sinh mã (trước đây MAX+1 trực tiếp, lệch bộ đếm)
  v_cash_code := public.next_cash_code(v_tenant_id, 'receipt');

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
  -- TỰ recompute customers.debt = SUM(HĐ completed). KHÔNG trừ tay (00134).
  UPDATE public.invoices
     SET paid = v_new_paid,
         debt = v_new_debt,
         updated_at = now()
   WHERE id = v_invoice.id;

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
-- 3b. record_purchase_payment — thay MAX+1 bằng next_cash_code
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

  -- 00155: MỘT cửa sinh mã (trước đây MAX+1 trực tiếp, lệch bộ đếm)
  v_cash_code := public.next_cash_code(v_tenant_id, 'payment');

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
  -- TỰ recompute suppliers.debt. KHÔNG trừ tay (00134).
  UPDATE public.purchase_orders
     SET paid = v_new_paid,
         debt = v_new_debt,
         updated_at = now()
   WHERE id = v_po.id;

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
-- 4. HEAL DATA — chuẩn hoá prefix + đồng bộ bộ đếm (mọi tenant)
-- ============================================================

-- 4a. Phiếu chi → 'PC', phiếu thu → 'PT' (chuẩn kế toán, khớp mã đang dùng)
UPDATE public.code_sequences SET prefix = 'PC'
 WHERE entity_type = 'cash_payment' AND prefix <> 'PC';
UPDATE public.code_sequences SET prefix = 'PT'
 WHERE entity_type = 'cash_receipt' AND prefix <> 'PT';

-- 4b. Bộ đếm không bao giờ được nhỏ hơn mã đã dùng thật trong sổ
UPDATE public.code_sequences cs
   SET current_number = GREATEST(cs.current_number, mx.max_used)
  FROM (
    SELECT tenant_id,
           CASE WHEN code LIKE 'PC%' THEN 'cash_payment'
                ELSE 'cash_receipt' END AS entity_type,
           MAX(substring(code FROM 3)::bigint) AS max_used
      FROM public.cash_transactions
     WHERE code ~ '^P[CT][0-9]{1,9}$'
     GROUP BY 1, 2
  ) mx
 WHERE cs.tenant_id = mx.tenant_id
   AND cs.entity_type = mx.entity_type;


-- ============================================================
-- 5. VERIFY — chạy xong phải thấy prefix PC/PT
--    (tenant chính: cash_payment ≥ 5, cash_receipt ≥ 85)
-- ============================================================

SELECT tenant_id, entity_type, prefix, current_number, padding
  FROM public.code_sequences
 WHERE entity_type IN ('cash_payment', 'cash_receipt')
 ORDER BY tenant_id, entity_type;
