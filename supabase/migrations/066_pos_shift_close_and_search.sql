-- =====================================================
-- Migration: POS Shift Close & Order Search
-- Purpose: Support shift closing with reconciliation and order lookup
-- Phase: 2 - POS Critical Features
-- =====================================================

-- PART 1: Enhance pos_shifts for reconciliation
-- Add variance tracking columns
ALTER TABLE pos_shifts
  ADD COLUMN IF NOT EXISTS total_sales NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_orders INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_sales NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bank_sales NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS card_sales NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_sales NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_cash NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cash NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_variance NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variance_notes TEXT;

-- Create index for shift statistics
CREATE INDEX IF NOT EXISTS idx_pos_shifts_stats
  ON pos_shifts(tenant_id, branch_id, status, closed_at DESC);

-- PART 2: RPC - Get Shift Summary
CREATE OR REPLACE FUNCTION pos_get_shift_summary(p_shift_id UUID)
RETURNS TABLE(
  shift_id UUID,
  shift_code TEXT,
  cashier_name TEXT,
  opened_at TIMESTAMPTZ,
  opening_cash NUMERIC,
  total_orders INTEGER,
  total_sales NUMERIC,
  cash_sales NUMERIC,
  bank_sales NUMERIC,
  card_sales NUMERIC,
  momo_sales NUMERIC,
  zalopay_sales NUMERIC,
  other_sales NUMERIC,
  expected_cash NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_shift RECORD;
BEGIN
  -- Permission check
  IF NOT has_permission('pos.shift.update') THEN
    RAISE EXCEPTION 'Không có quyền xem thông tin ca làm việc';
  END IF;

  v_tenant_id := current_tenant_id();

  -- Get shift info
  SELECT
    s.id, s.code, s.opened_at, s.opening_cash,
    p.full_name as cashier_name
  INTO v_shift
  FROM pos_shifts s
  LEFT JOIN profiles p ON s.opened_by = p.id
  WHERE s.id = p_shift_id
    AND s.tenant_id = v_tenant_id
    AND s.status = 'open';

  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Ca làm việc không tồn tại hoặc đã đóng';
  END IF;

  -- Calculate sales by payment method
  RETURN QUERY
  SELECT
    v_shift.id,
    v_shift.code,
    v_shift.cashier_name,
    v_shift.opened_at,
    v_shift.opening_cash,
    COUNT(DISTINCT o.id)::INTEGER as total_orders,
    COALESCE(SUM(o.total_amount), 0) as total_sales,
    COALESCE(SUM(CASE WHEN pp.payment_method = 'cash' THEN pp.amount ELSE 0 END), 0) as cash_sales,
    COALESCE(SUM(CASE WHEN pp.payment_method = 'bank_transfer' THEN pp.amount ELSE 0 END), 0) as bank_sales,
    COALESCE(SUM(CASE WHEN pp.payment_method = 'card' THEN pp.amount ELSE 0 END), 0) as card_sales,
    COALESCE(SUM(CASE WHEN pp.payment_method = 'momo' THEN pp.amount ELSE 0 END), 0) as momo_sales,
    COALESCE(SUM(CASE WHEN pp.payment_method = 'zalopay' THEN pp.amount ELSE 0 END), 0) as zalopay_sales,
    COALESCE(SUM(CASE WHEN pp.payment_method NOT IN ('cash', 'bank_transfer', 'card', 'momo', 'zalopay') THEN pp.amount ELSE 0 END), 0) as other_sales,
    v_shift.opening_cash + COALESCE(SUM(CASE WHEN pp.payment_method = 'cash' THEN pp.amount ELSE 0 END), 0) as expected_cash
  FROM pos_shifts s
  LEFT JOIN pos_orders o ON o.shift_id = s.id AND o.status = 'paid'
  LEFT JOIN pos_payments pp ON pp.order_id = o.id
  WHERE s.id = v_shift.id
  GROUP BY s.id, v_shift.code, v_shift.cashier_name, v_shift.opened_at, v_shift.opening_cash;
END;
$$;

GRANT EXECUTE ON FUNCTION pos_get_shift_summary(UUID) TO authenticated;

-- PART 3: RPC - Close Shift with Reconciliation
CREATE OR REPLACE FUNCTION pos_close_shift(
  p_shift_id UUID,
  p_actual_cash NUMERIC,
  p_variance_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_summary RECORD;
  v_variance NUMERIC;
BEGIN
  -- Permission check
  IF NOT has_permission('pos.shift.update') THEN
    RAISE EXCEPTION 'Không có quyền đóng ca';
  END IF;

  v_tenant_id := current_tenant_id();

  -- Get shift summary
  SELECT * INTO v_summary FROM pos_get_shift_summary(p_shift_id);

  IF v_summary.shift_id IS NULL THEN
    RAISE EXCEPTION 'Không lấy được thông tin ca làm việc';
  END IF;

  -- Calculate variance
  v_variance := p_actual_cash - v_summary.expected_cash;

  -- Update shift with reconciliation data
  UPDATE pos_shifts
  SET
    status = 'closed',
    closed_at = NOW(),
    closed_by = auth.uid(),
    total_sales = v_summary.total_sales,
    total_orders = v_summary.total_orders,
    cash_sales = v_summary.cash_sales,
    bank_sales = v_summary.bank_sales,
    card_sales = v_summary.card_sales,
    other_sales = v_summary.momo_sales + v_summary.zalopay_sales + v_summary.other_sales,
    expected_cash = v_summary.expected_cash,
    actual_cash = p_actual_cash,
    cash_variance = v_variance,
    variance_notes = p_variance_notes,
    updated_at = NOW()
  WHERE id = p_shift_id
    AND tenant_id = v_tenant_id
    AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ca đã đóng hoặc không tồn tại';
  END IF;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION pos_close_shift(UUID, NUMERIC, TEXT) TO authenticated;

-- PART 4: RPC - Search Orders
CREATE OR REPLACE FUNCTION pos_search_orders(
  p_branch_id UUID,
  p_search_text TEXT DEFAULT NULL,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE(
  order_id UUID,
  order_number TEXT,
  customer_name TEXT,
  total NUMERIC,
  payment_method TEXT,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Permission check
  IF NOT has_permission('pos.read') THEN
    RAISE EXCEPTION 'Không có quyền tra cứu đơn hàng';
  END IF;

  v_tenant_id := current_tenant_id();

  -- Build dynamic query
  RETURN QUERY
  SELECT
    o.id,
    o.order_number,
    COALESCE(c.name, 'Khách vãng lai') as customer_name,
    o.total_amount,
    pp.payment_method,
    o.status,
    o.created_at
  FROM pos_orders o
  LEFT JOIN sales_customers c ON o.customer_id = c.id
  LEFT JOIN pos_payments pp ON pp.order_id = o.id
  WHERE o.tenant_id = v_tenant_id
    AND o.branch_id = p_branch_id
    AND o.status IN ('paid', 'refunded')
    AND (
      p_search_text IS NULL
      OR o.order_number ILIKE '%' || p_search_text || '%'
      OR c.name ILIKE '%' || p_search_text || '%'
    )
    AND (p_from_date IS NULL OR DATE(o.created_at) >= p_from_date)
    AND (p_to_date IS NULL OR DATE(o.created_at) <= p_to_date)
  ORDER BY o.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION pos_search_orders(UUID, TEXT, DATE, DATE, INTEGER) TO authenticated;

-- PART 5: Add comments
COMMENT ON FUNCTION pos_get_shift_summary IS 'Get shift summary with payment breakdown for closing';
COMMENT ON FUNCTION pos_close_shift IS 'Close shift with cash reconciliation';
COMMENT ON FUNCTION pos_search_orders IS 'Search POS orders by number, customer, or date range';
