-- ============================================================
-- Migration 00046: Cash Transactions Atomic + Schema Hardening
-- ============================================================
--
-- Sprint SỔ-QUỸ-2 — fix các P0/P1 audit phát hiện cần migration:
--
-- 1. Schema additions cho cash_transactions:
--    - `status` text  (filter UI hiện đã có nhưng dead — cần cột này để hoạt động)
--    - `transaction_date` date  (để tạo phiếu lùi ngày, group theo ngày)
--    - Mở rộng check constraint payment_method để chấp nhận 'ewallet'
--      (UI có option "Ví điện tử" nhưng INSERT bị CHECK constraint fail).
--    - `customer_id` / `supplier_id` FK  (để filter/link đúng entity thay vì
--      chỉ dùng counterparty free-text).
--
-- 2. RPC atomic — gói luồng "ghi phiếu thu/chi + update invoice/PO debt +
--    update customer/supplier debt" thành transaction. Trước đây client
--    chạy 4 step không atomic — fail giữa chừng → cash đã ghi mà debt
--    chưa giảm → công nợ ảo.
--
-- 3. RPC `cancel_cash_transaction` đảo ngược debt khi xóa/hủy phiếu có
--    reference_id. Trước đây deleteCashTransaction xóa thẳng → invoice.debt
--    đã giảm vẫn giữ nguyên → âm thầm sai số.
-- ============================================================

-- ============================================================
-- 1. Schema additions
-- ============================================================

ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('draft', 'completed', 'cancelled'));

ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS transaction_date date NOT NULL DEFAULT CURRENT_DATE;

-- FK vô KH/NCC (nullable — phiếu thu/chi tự do không bắt buộc gắn entity)
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

-- Mở rộng payment_method check constraint để chấp nhận 'ewallet'.
-- Phải DROP rồi CREATE vì PG không support ALTER CHECK trực tiếp.
ALTER TABLE public.cash_transactions
  DROP CONSTRAINT IF EXISTS cash_transactions_payment_method_check;

ALTER TABLE public.cash_transactions
  ADD CONSTRAINT cash_transactions_payment_method_check
  CHECK (payment_method IN ('cash', 'transfer', 'card', 'ewallet'));

-- Index phục vụ filter status + transaction_date + branch (3 cột phổ biến)
CREATE INDEX IF NOT EXISTS idx_cash_tx_status
  ON public.cash_transactions(tenant_id, status, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_cash_tx_customer
  ON public.cash_transactions(customer_id) WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cash_tx_supplier
  ON public.cash_transactions(supplier_id) WHERE supplier_id IS NOT NULL;

-- ============================================================
-- 2. RPC atomic: record_invoice_payment
-- ============================================================
--
-- Gói atomic: phiếu thu + update invoice.paid/debt + update customers.debt.
-- Tham số tương ứng `RecordPaymentInput` ở payments.ts.
--
-- Returns: { cash_transaction_id, cash_code, new_paid, new_debt }

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
  -- Resolve context: prefer params, fallback to current_setting (RLS context)
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập';
  END IF;

  -- 1. Lock + fetch invoice (FOR UPDATE để chặn race condition 2 user trả cùng lúc)
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

  -- 2. Validate
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

  -- 3. Generate cash code (next_group_code style — đơn giản hóa: PT + epoch)
  v_cash_code := 'PT' || lpad(
    (COALESCE(
      (SELECT MAX(CAST(REGEXP_REPLACE(code, '[^0-9]', '', 'g') AS bigint))
         FROM public.cash_transactions
        WHERE tenant_id = v_tenant_id AND code LIKE 'PT%'
      ), 0) + 1
    )::text, 6, '0'
  );

  -- 4. Insert cash receipt
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

  -- 5. Update invoice
  UPDATE public.invoices
     SET paid = v_new_paid,
         debt = v_new_debt,
         updated_at = now()
   WHERE id = v_invoice.id;

  -- 6. Update customer debt
  IF v_invoice.customer_id IS NOT NULL THEN
    UPDATE public.customers
       SET debt = GREATEST(0, debt - p_amount),
           updated_at = now()
     WHERE id = v_invoice.customer_id;
  END IF;

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
-- 3. RPC atomic: record_purchase_payment
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

  UPDATE public.purchase_orders
     SET paid = v_new_paid,
         debt = v_new_debt,
         updated_at = now()
   WHERE id = v_po.id;

  IF v_po.supplier_id IS NOT NULL THEN
    UPDATE public.suppliers
       SET debt = GREATEST(0, debt - p_amount),
           updated_at = now()
     WHERE id = v_po.supplier_id;
  END IF;

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
-- 4. RPC: cancel_cash_transaction (đảo ngược debt khi hủy phiếu)
-- ============================================================
--
-- Khi xóa/hủy phiếu thu/chi đã gắn reference_id (invoice/PO):
--   - Set status = 'cancelled' (không xóa cứng — giữ audit trail).
--   - Đảo lại invoice/PO.paid -= amount, .debt += amount.
--   - Đảo lại customer/supplier.debt += amount.

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

  -- Đảo invoice/PO debt
  IF v_cash.reference_type = 'invoice' AND v_cash.reference_id IS NOT NULL THEN
    UPDATE public.invoices
       SET paid = GREATEST(0, paid - v_cash.amount),
           debt = debt + v_cash.amount,
           updated_at = now()
     WHERE id = v_cash.reference_id;
    IF v_cash.customer_id IS NOT NULL THEN
      UPDATE public.customers
         SET debt = debt + v_cash.amount,
             updated_at = now()
       WHERE id = v_cash.customer_id;
    END IF;

  ELSIF v_cash.reference_type = 'purchase_order' AND v_cash.reference_id IS NOT NULL THEN
    UPDATE public.purchase_orders
       SET paid = GREATEST(0, paid - v_cash.amount),
           debt = debt + v_cash.amount,
           updated_at = now()
     WHERE id = v_cash.reference_id;
    IF v_cash.supplier_id IS NOT NULL THEN
      UPDATE public.suppliers
         SET debt = debt + v_cash.amount,
             updated_at = now()
       WHERE id = v_cash.supplier_id;
    END IF;
  END IF;

  -- Mark cancelled (giữ record cho audit, KHÔNG hard delete)
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
-- 5. updated_at column (cho UPDATE trong cancel RPC)
-- ============================================================
ALTER TABLE public.cash_transactions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
