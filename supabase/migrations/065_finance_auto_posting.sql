-- =====================================================
-- Migration: Finance Auto-Posting for POS
-- Purpose: Automatically create journal entries and update balances when POS sales are made
-- Features:
--   - Payment method to finance account mapping
--   - Auto create journal entries (debit/credit)
--   - Auto update account balances
--   - Cash receipts (phiếu thu) integration
-- =====================================================

-- Step 1: Create payment_method_accounts mapping table
CREATE TABLE IF NOT EXISTS payment_method_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_method_id UUID NOT NULL REFERENCES payment_methods(id) ON DELETE CASCADE,
  finance_account_id UUID NOT NULL REFERENCES finance_accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, payment_method_id)
);

-- Step 2: Create indexes
CREATE INDEX idx_payment_method_accounts_tenant ON payment_method_accounts(tenant_id);
CREATE INDEX idx_payment_method_accounts_method ON payment_method_accounts(payment_method_id);

-- Step 3: Enable RLS
ALTER TABLE payment_method_accounts ENABLE ROW LEVEL SECURITY;

-- Step 4: RLS Policies
CREATE POLICY payment_method_accounts_tenant_isolation ON payment_method_accounts
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY payment_method_accounts_select ON payment_method_accounts
  FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY payment_method_accounts_manage ON payment_method_accounts
  FOR ALL
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_permission('settings.manage')
  );

-- Step 5: Helper function to get or create default finance accounts
CREATE OR REPLACE FUNCTION ensure_default_finance_accounts(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  -- Create Cash account if not exists
  INSERT INTO finance_accounts (tenant_id, code, name, account_type, balance)
  VALUES (p_tenant_id, 'CASH', 'Tiền mặt', 'asset', 0)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- Create Bank account if not exists
  INSERT INTO finance_accounts (tenant_id, code, name, account_type, balance)
  VALUES (p_tenant_id, 'BANK', 'Ngân hàng', 'asset', 0)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- Create Sales Revenue account if not exists
  INSERT INTO finance_accounts (tenant_id, code, name, account_type, balance)
  VALUES (p_tenant_id, 'SALES_REVENUE', 'Doanh thu bán hàng', 'revenue', 0)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- Create Accounts Receivable if not exists
  INSERT INTO finance_accounts (tenant_id, code, name, account_type, balance)
  VALUES (p_tenant_id, 'AR', 'Phải thu khách hàng', 'asset', 0)
  ON CONFLICT (tenant_id, code) DO NOTHING;
END;
$$;

-- Step 6: Seed default payment method to account mappings for existing tenants
DO $$
DECLARE
  v_tenant RECORD;
  v_cash_method_id UUID;
  v_bank_method_id UUID;
  v_card_method_id UUID;
  v_cash_account_id UUID;
  v_bank_account_id UUID;
BEGIN
  FOR v_tenant IN SELECT id FROM tenants LOOP
    -- Ensure default accounts exist
    PERFORM ensure_default_finance_accounts(v_tenant.id);

    -- Get payment method IDs
    SELECT id INTO v_cash_method_id FROM payment_methods WHERE tenant_id = v_tenant.id AND code = 'cash';
    SELECT id INTO v_bank_method_id FROM payment_methods WHERE tenant_id = v_tenant.id AND code = 'bank_transfer';
    SELECT id INTO v_card_method_id FROM payment_methods WHERE tenant_id = v_tenant.id AND code = 'card';

    -- Get account IDs
    SELECT id INTO v_cash_account_id FROM finance_accounts WHERE tenant_id = v_tenant.id AND code = 'CASH';
    SELECT id INTO v_bank_account_id FROM finance_accounts WHERE tenant_id = v_tenant.id AND code = 'BANK';

    -- Map cash payment to Cash account
    IF v_cash_method_id IS NOT NULL AND v_cash_account_id IS NOT NULL THEN
      INSERT INTO payment_method_accounts (tenant_id, payment_method_id, finance_account_id)
      VALUES (v_tenant.id, v_cash_method_id, v_cash_account_id)
      ON CONFLICT (tenant_id, payment_method_id) DO NOTHING;
    END IF;

    -- Map bank_transfer to Bank account
    IF v_bank_method_id IS NOT NULL AND v_bank_account_id IS NOT NULL THEN
      INSERT INTO payment_method_accounts (tenant_id, payment_method_id, finance_account_id)
      VALUES (v_tenant.id, v_bank_method_id, v_bank_account_id)
      ON CONFLICT (tenant_id, payment_method_id) DO NOTHING;
    END IF;

    -- Map card to Bank account (default)
    IF v_card_method_id IS NOT NULL AND v_bank_account_id IS NOT NULL THEN
      INSERT INTO payment_method_accounts (tenant_id, payment_method_id, finance_account_id)
      VALUES (v_tenant.id, v_card_method_id, v_bank_account_id)
      ON CONFLICT (tenant_id, payment_method_id) DO NOTHING;
    END IF;

  END LOOP;
END $$;

-- Step 7: RPC - Admin configure payment method to account mapping
CREATE OR REPLACE FUNCTION admin_map_payment_method_to_account(
  p_payment_method_id UUID,
  p_finance_account_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Check permission
  IF NOT public.has_permission('settings.manage') THEN
    RAISE EXCEPTION 'Không có quyền cấu hình mapping';
  END IF;

  v_tenant_id := public.current_tenant_id();

  -- Verify payment method exists
  IF NOT EXISTS (
    SELECT 1 FROM payment_methods WHERE id = p_payment_method_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Payment method không tồn tại';
  END IF;

  -- Verify finance account exists and is asset type
  IF NOT EXISTS (
    SELECT 1 FROM finance_accounts
    WHERE id = p_finance_account_id
      AND tenant_id = v_tenant_id
      AND account_type IN ('asset') -- Only allow mapping to asset accounts (cash, bank)
  ) THEN
    RAISE EXCEPTION 'Finance account không hợp lệ hoặc không phải loại tài sản';
  END IF;

  -- Upsert mapping
  INSERT INTO payment_method_accounts (tenant_id, payment_method_id, finance_account_id)
  VALUES (v_tenant_id, p_payment_method_id, p_finance_account_id)
  ON CONFLICT (tenant_id, payment_method_id)
  DO UPDATE SET finance_account_id = p_finance_account_id, updated_at = NOW();

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_map_payment_method_to_account TO authenticated;

-- Step 8: Enhanced POS Create Sale with Finance Auto-posting
CREATE OR REPLACE FUNCTION pos_create_sale_with_finance(
  p_shift_id UUID,
  p_warehouse_id UUID,
  p_items JSONB,
  p_payment_method TEXT,
  p_customer_id UUID DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, order_id UUID, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_branch_id UUID;
  v_order_id UUID;
  v_order_number TEXT;
  v_total NUMERIC := 0;
  v_item JSONB;
  v_product RECORD;
  v_transaction_id UUID;
  v_payment_method_id UUID;
  v_debit_account_id UUID; -- Cash/Bank account
  v_credit_account_id UUID; -- Revenue account
  v_customer_name TEXT;
BEGIN
  -- Get tenant and branch
  v_tenant_id := public.current_tenant_id();

  SELECT branch_id INTO v_branch_id
  FROM pos_shifts
  WHERE id = p_shift_id AND tenant_id = v_tenant_id AND status = 'open';

  IF v_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Ca làm việc không tồn tại hoặc đã đóng';
    RETURN;
  END IF;

  -- Check permission
  IF NOT public.has_permission('pos.order.create') THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Không có quyền tạo đơn hàng';
    RETURN;
  END IF;

  -- Generate order number
  v_order_number := 'POS-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(nextval('order_number_seq')::TEXT, 6, '0');

  -- Create POS order
  INSERT INTO pos_orders (
    tenant_id, branch_id, shift_id, order_number, customer_id, status, total_amount, created_by
  )
  VALUES (
    v_tenant_id, v_branch_id, p_shift_id, v_order_number, p_customer_id, 'paid', 0, auth.uid()
  )
  RETURNING id INTO v_order_id;

  -- Process order items and calculate total
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Get product info
    SELECT p.id, p.name, p.price
    INTO v_product
    FROM products p
    WHERE p.id = (v_item->>'product_id')::UUID
      AND p.tenant_id = v_tenant_id;

    IF v_product IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, 'Sản phẩm không tồn tại: ' || (v_item->>'product_id');
      RETURN;
    END IF;

    -- Insert order item
    INSERT INTO pos_order_items (order_id, product_id, quantity, unit_price, subtotal)
    VALUES (
      v_order_id,
      v_product.id,
      (v_item->>'quantity')::NUMERIC,
      v_product.price,
      v_product.price * (v_item->>'quantity')::NUMERIC
    );

    v_total := v_total + (v_product.price * (v_item->>'quantity')::NUMERIC);

    -- Apply stock movement
    PERFORM inventory_apply_stock_movement(
      v_product.id,
      p_warehouse_id,
      -(v_item->>'quantity')::NUMERIC, -- Negative for sale
      'sale',
      'POS Sale: ' || v_order_number
    );
  END LOOP;

  -- Update order total
  UPDATE pos_orders SET total_amount = v_total WHERE id = v_order_id;

  -- Create POS payment record
  INSERT INTO pos_payments (order_id, payment_method, amount, tenant_id)
  VALUES (v_order_id, p_payment_method, v_total, v_tenant_id);

  -- ============ FINANCE AUTO-POSTING ============

  -- Get payment method ID
  SELECT id INTO v_payment_method_id
  FROM payment_methods
  WHERE tenant_id = v_tenant_id AND code = p_payment_method;

  -- Get mapped finance account (debit - asset account)
  SELECT finance_account_id INTO v_debit_account_id
  FROM payment_method_accounts
  WHERE tenant_id = v_tenant_id AND payment_method_id = v_payment_method_id;

  -- Fallback to Cash account if no mapping
  IF v_debit_account_id IS NULL THEN
    SELECT id INTO v_debit_account_id
    FROM finance_accounts
    WHERE tenant_id = v_tenant_id AND code = 'CASH';
  END IF;

  -- Get revenue account (credit)
  SELECT id INTO v_credit_account_id
  FROM finance_accounts
  WHERE tenant_id = v_tenant_id AND code = 'SALES_REVENUE';

  -- Ensure accounts exist
  IF v_debit_account_id IS NULL OR v_credit_account_id IS NULL THEN
    -- Create default accounts if missing
    PERFORM ensure_default_finance_accounts(v_tenant_id);

    -- Retry getting accounts
    SELECT id INTO v_debit_account_id FROM finance_accounts WHERE tenant_id = v_tenant_id AND code = 'CASH';
    SELECT id INTO v_credit_account_id FROM finance_accounts WHERE tenant_id = v_tenant_id AND code = 'SALES_REVENUE';
  END IF;

  -- Get customer name
  IF p_customer_id IS NOT NULL THEN
    SELECT name INTO v_customer_name FROM customers WHERE id = p_customer_id;
  ELSE
    v_customer_name := 'Khách vãng lai';
  END IF;

  -- Create journal entry (finance_transactions)
  INSERT INTO finance_transactions (
    tenant_id, transaction_date, description, reference_type, reference_id
  )
  VALUES (
    v_tenant_id,
    NOW(),
    'POS Sale: ' || v_order_number || ' - ' || v_customer_name,
    'pos_order',
    v_order_id
  )
  RETURNING id INTO v_transaction_id;

  -- Debit: Cash/Bank (Asset increases)
  INSERT INTO finance_transaction_lines (transaction_id, account_id, debit, credit)
  VALUES (v_transaction_id, v_debit_account_id, v_total, 0);

  -- Credit: Sales Revenue (Revenue increases)
  INSERT INTO finance_transaction_lines (transaction_id, account_id, debit, credit)
  VALUES (v_transaction_id, v_credit_account_id, 0, v_total);

  -- Update account balances
  UPDATE finance_accounts
  SET balance = balance + v_total, updated_at = NOW()
  WHERE id = v_debit_account_id; -- Asset account increases

  UPDATE finance_accounts
  SET balance = balance + v_total, updated_at = NOW()
  WHERE id = v_credit_account_id; -- Revenue account increases

  -- Update shift statistics
  UPDATE pos_shifts
  SET
    total_sales = total_sales + v_total,
    total_orders = total_orders + 1
  WHERE id = p_shift_id;

  RETURN QUERY SELECT TRUE, v_order_id, 'Success';
END;
$$;

GRANT EXECUTE ON FUNCTION pos_create_sale_with_finance TO authenticated;

-- Step 9: Add comments
COMMENT ON TABLE payment_method_accounts IS 'Maps payment methods to finance accounts for auto-posting journal entries';
COMMENT ON FUNCTION pos_create_sale_with_finance IS 'Create POS sale with automatic journal entry and balance updates';

-- Step 10: Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_payment_method_accounts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_method_accounts_updated_at
  BEFORE UPDATE ON payment_method_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_method_accounts_updated_at();
