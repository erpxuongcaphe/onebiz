-- =====================================================
-- Migration 065: Finance Auto-Posting for POS
-- Purpose: payment-method ↔ account mapping + auto journal on POS sale
-- IDEMPOTENT: safe to re-run (Steps 1-4 may have already executed)
-- =====================================================

-- ─── Step 1: mapping table ────────────────────────────
CREATE TABLE IF NOT EXISTS payment_method_accounts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_method_id   UUID        NOT NULL REFERENCES payment_methods(id) ON DELETE CASCADE,
  finance_account_id  UUID        NOT NULL REFERENCES finance_accounts(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, payment_method_id)
);

-- ─── Step 2: indexes (IF NOT EXISTS) ─────────────────
CREATE INDEX IF NOT EXISTS idx_payment_method_accounts_tenant ON payment_method_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_method_accounts_method ON payment_method_accounts(payment_method_id);

-- ─── Step 3: RLS ──────────────────────────────────────
ALTER TABLE payment_method_accounts ENABLE ROW LEVEL SECURITY;

-- ─── Step 4: policies (DROP first for idempotency) ───
DROP POLICY IF EXISTS payment_method_accounts_tenant_isolation ON payment_method_accounts;
DROP POLICY IF EXISTS payment_method_accounts_select           ON payment_method_accounts;
DROP POLICY IF EXISTS payment_method_accounts_manage           ON payment_method_accounts;

CREATE POLICY payment_method_accounts_select
  ON payment_method_accounts
  FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY payment_method_accounts_manage
  ON payment_method_accounts
  FOR ALL
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_permission('settings.manage')
  );

-- ─── Step 5: seed-helper (no balance column!) ────────
CREATE OR REPLACE FUNCTION ensure_default_finance_accounts(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO finance_accounts (tenant_id, code, name, account_type)
  VALUES (p_tenant_id, 'CASH',          'Tiền mặt',            'asset')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO finance_accounts (tenant_id, code, name, account_type)
  VALUES (p_tenant_id, 'BANK',          'Ngân hàng',           'asset')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO finance_accounts (tenant_id, code, name, account_type)
  VALUES (p_tenant_id, 'SALES_REVENUE', 'Doanh thu bán hàng',  'revenue')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO finance_accounts (tenant_id, code, name, account_type)
  VALUES (p_tenant_id, 'AR',            'Phải thu khách hàng', 'asset')
  ON CONFLICT (tenant_id, code) DO NOTHING;
END;
$$;

-- ─── Step 6: seed default mappings for existing tenants
DO $$
DECLARE
  v_tenant          RECORD;
  v_cash_method_id  UUID;
  v_bank_method_id  UUID;
  v_card_method_id  UUID;
  v_cash_acct_id    UUID;
  v_bank_acct_id    UUID;
BEGIN
  FOR v_tenant IN SELECT id FROM tenants LOOP
    PERFORM ensure_default_finance_accounts(v_tenant.id);

    SELECT id INTO v_cash_method_id FROM payment_methods WHERE tenant_id = v_tenant.id AND code = 'cash';
    SELECT id INTO v_bank_method_id FROM payment_methods WHERE tenant_id = v_tenant.id AND code = 'bank_transfer';
    SELECT id INTO v_card_method_id FROM payment_methods WHERE tenant_id = v_tenant.id AND code = 'card';

    SELECT id INTO v_cash_acct_id FROM finance_accounts WHERE tenant_id = v_tenant.id AND code = 'CASH';
    SELECT id INTO v_bank_acct_id FROM finance_accounts WHERE tenant_id = v_tenant.id AND code = 'BANK';

    IF v_cash_method_id IS NOT NULL AND v_cash_acct_id IS NOT NULL THEN
      INSERT INTO payment_method_accounts (tenant_id, payment_method_id, finance_account_id)
      VALUES (v_tenant.id, v_cash_method_id, v_cash_acct_id)
      ON CONFLICT (tenant_id, payment_method_id) DO NOTHING;
    END IF;

    IF v_bank_method_id IS NOT NULL AND v_bank_acct_id IS NOT NULL THEN
      INSERT INTO payment_method_accounts (tenant_id, payment_method_id, finance_account_id)
      VALUES (v_tenant.id, v_bank_method_id, v_bank_acct_id)
      ON CONFLICT (tenant_id, payment_method_id) DO NOTHING;
    END IF;

    IF v_card_method_id IS NOT NULL AND v_bank_acct_id IS NOT NULL THEN
      INSERT INTO payment_method_accounts (tenant_id, payment_method_id, finance_account_id)
      VALUES (v_tenant.id, v_card_method_id, v_bank_acct_id)
      ON CONFLICT (tenant_id, payment_method_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;

-- ─── Step 7: admin RPC — map payment method → account
CREATE OR REPLACE FUNCTION admin_map_payment_method_to_account(
  p_payment_method_id   UUID,
  p_finance_account_id  UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  IF NOT public.has_permission('settings.manage') THEN
    RAISE EXCEPTION 'Không có quyền cấu hình mapping';
  END IF;

  v_tenant_id := public.current_tenant_id();

  IF NOT EXISTS (
    SELECT 1 FROM payment_methods WHERE id = p_payment_method_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Payment method không tồn tại';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM finance_accounts
    WHERE id = p_finance_account_id AND tenant_id = v_tenant_id AND account_type = 'asset'
  ) THEN
    RAISE EXCEPTION 'Finance account không hợp lệ hoặc không phải loại tài sản';
  END IF;

  INSERT INTO payment_method_accounts (tenant_id, payment_method_id, finance_account_id)
  VALUES (v_tenant_id, p_payment_method_id, p_finance_account_id)
  ON CONFLICT (tenant_id, payment_method_id)
  DO UPDATE SET finance_account_id = p_finance_account_id, updated_at = NOW();

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_map_payment_method_to_account(uuid, uuid) TO authenticated;

-- ─── Step 8: POS sale with finance auto-posting ──────
-- Mirrors 030_pos_sale_rpc pattern exactly; adds journal entries.
CREATE OR REPLACE FUNCTION pos_create_sale_with_finance(
  p_shift_id          UUID,
  p_warehouse_id      UUID,
  p_items             JSONB,
  p_payment_method    TEXT,
  p_customer_id       UUID  DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, order_id UUID, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id        UUID;
  v_branch_id        UUID;
  v_order_id         UUID;
  v_order_number     TEXT;
  v_total            NUMERIC := 0;
  v_item             JSONB;
  v_prod_id          UUID;
  v_prod_sku         TEXT;
  v_prod_name        TEXT;
  v_prod_price       NUMERIC;
  v_qty              NUMERIC;
  v_transaction_id   UUID;
  v_txn_number       TEXT;
  v_payment_method_id   UUID;
  v_debit_account_id    UUID;
  v_credit_account_id   UUID;
  v_customer_name    TEXT;
BEGIN
  v_tenant_id := public.current_tenant_id();

  -- Validate shift
  SELECT branch_id INTO v_branch_id
  FROM pos_shifts
  WHERE id = p_shift_id AND tenant_id = v_tenant_id AND status = 'open';

  IF v_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Ca làm việc không tồn tại hoặc đã đóng';
    RETURN;
  END IF;

  -- Permission check
  IF NOT public.has_permission('pos.order.create') THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Không có quyền tạo đơn hàng';
    RETURN;
  END IF;

  -- Generate order number (same pattern as 030)
  v_order_number := 'POS-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6));

  -- Create POS order (columns match 021 schema: subtotal, discount, tax, total)
  INSERT INTO pos_orders (
    tenant_id, branch_id, shift_id, order_number, customer_id, status,
    subtotal, discount, tax, total,
    created_by
  )
  VALUES (
    v_tenant_id, v_branch_id, p_shift_id, v_order_number, p_customer_id, 'paid',
    0, 0, 0, 0,
    auth.uid()
  )
  RETURNING id INTO v_order_id;

  -- Process items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id   := (v_item->>'product_id')::UUID;
    v_qty       := (v_item->>'quantity')::NUMERIC;

    -- Look up product from inventory_products (NOT "products")
    SELECT id, sku, name, selling_price
    INTO   v_prod_id, v_prod_sku, v_prod_name, v_prod_price
    FROM   inventory_products
    WHERE  id = v_prod_id AND tenant_id = v_tenant_id;

    IF v_prod_sku IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, 'Sản phẩm không tồn tại: ' || (v_item->>'product_id');
      RETURN;
    END IF;

    -- Insert order item (columns match 021 schema; no "subtotal" column)
    INSERT INTO pos_order_items (tenant_id, order_id, product_id, sku, name, quantity, unit_price)
    VALUES (v_tenant_id, v_order_id, v_prod_id, v_prod_sku, v_prod_name, v_qty, v_prod_price);

    v_total := v_total + (v_qty * v_prod_price);

    -- Deduct stock (argument order matches 014 signature: type, qty, ref_type, ref_id, notes)
    PERFORM public.inventory_apply_stock_movement(
      v_prod_id,
      p_warehouse_id,
      'sale',
      -v_qty,
      'pos_order',
      v_order_id,
      'POS Sale: ' || v_order_number
    );
  END LOOP;

  -- Update order totals
  UPDATE pos_orders
  SET subtotal = v_total, total = v_total, updated_at = now()
  WHERE id = v_order_id;

  -- Record payment (column is "method", not "payment_method")
  INSERT INTO pos_payments (tenant_id, order_id, method, amount)
  VALUES (v_tenant_id, v_order_id, p_payment_method, v_total);

  -- ──── FINANCE AUTO-POSTING ─────────────────────────

  -- Resolve debit account from mapping
  SELECT pma.finance_account_id INTO v_debit_account_id
  FROM payment_method_accounts pma
  JOIN payment_methods pm ON pm.id = pma.payment_method_id
  WHERE pma.tenant_id = v_tenant_id AND pm.code = p_payment_method;

  -- Fallback to CASH
  IF v_debit_account_id IS NULL THEN
    SELECT id INTO v_debit_account_id
    FROM finance_accounts WHERE tenant_id = v_tenant_id AND code = 'CASH';
  END IF;

  -- Revenue account
  SELECT id INTO v_credit_account_id
  FROM finance_accounts WHERE tenant_id = v_tenant_id AND code = 'SALES_REVENUE';

  -- Ensure accounts exist if still NULL
  IF v_debit_account_id IS NULL OR v_credit_account_id IS NULL THEN
    PERFORM ensure_default_finance_accounts(v_tenant_id);
    SELECT id INTO v_debit_account_id  FROM finance_accounts WHERE tenant_id = v_tenant_id AND code = 'CASH';
    SELECT id INTO v_credit_account_id FROM finance_accounts WHERE tenant_id = v_tenant_id AND code = 'SALES_REVENUE';
  END IF;

  -- Customer name for description
  IF p_customer_id IS NOT NULL THEN
    SELECT name INTO v_customer_name FROM sales_customers WHERE id = p_customer_id;
  END IF;
  v_customer_name := COALESCE(v_customer_name, 'Khách vãng lai');

  -- Generate finance transaction number
  v_txn_number := 'FIN-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(random()::text), 1, 6));

  -- Create journal entry (finance_transactions requires transaction_number + total_amount)
  INSERT INTO finance_transactions (
    tenant_id, transaction_number, transaction_date, description,
    reference_type, reference_id, total_amount, status
  )
  VALUES (
    v_tenant_id,
    v_txn_number,
    now()::date,
    'POS Sale: ' || v_order_number || ' - ' || v_customer_name,
    'pos_order',
    v_order_id,
    v_total,
    'posted'
  )
  RETURNING id INTO v_transaction_id;

  -- Debit line: Cash/Bank (asset ↑)  — includes tenant_id
  INSERT INTO finance_transaction_lines (tenant_id, transaction_id, account_id, debit, credit)
  VALUES (v_tenant_id, v_transaction_id, v_debit_account_id, v_total, 0);

  -- Credit line: Sales Revenue (revenue ↑)
  INSERT INTO finance_transaction_lines (tenant_id, transaction_id, account_id, debit, credit)
  VALUES (v_tenant_id, v_transaction_id, v_credit_account_id, 0, v_total);

  -- NOTE: balance is NOT a column on finance_accounts.
  -- Account balances are computed on-the-fly from finance_transaction_lines (debit – credit).
  -- No UPDATE needed here.

  RETURN QUERY SELECT TRUE, v_order_id, 'Success';
END;
$$;

GRANT EXECUTE ON FUNCTION pos_create_sale_with_finance(uuid, uuid, jsonb, text, uuid) TO authenticated;

-- ─── Step 9: comments ─────────────────────────────────
COMMENT ON TABLE  payment_method_accounts          IS 'Maps payment methods to finance accounts for auto-posting';
COMMENT ON FUNCTION pos_create_sale_with_finance   IS 'POS sale with automatic journal-entry creation';

-- ─── Step 10: updated_at trigger (idempotent) ────────
CREATE OR REPLACE FUNCTION update_payment_method_accounts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_method_accounts_updated_at ON payment_method_accounts;
CREATE TRIGGER payment_method_accounts_updated_at
  BEFORE UPDATE ON payment_method_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_method_accounts_updated_at();
