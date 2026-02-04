-- =====================================================
-- Migration: Payment Methods CRUD
-- Purpose: Admin can create/edit/delete payment methods dynamically
-- Features:
--   - payment_methods table with tenant isolation
--   - Seed 6 default methods for existing tenants
--   - CRUD RPCs with permission checks
--   - RLS policies
-- =====================================================

-- Step 1: Drop old CHECK constraints (hard-coded payment methods)
ALTER TABLE pos_payments DROP CONSTRAINT IF EXISTS pos_payments_method_check;
ALTER TABLE invoice_payments DROP CONSTRAINT IF EXISTS invoice_payments_method_check;

-- Step 2: Create payment_methods table
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL, -- 'cash', 'bank_transfer', 'card', 'momo', 'zalopay', 'other'
  name TEXT NOT NULL, -- Display name: "Tiền mặt", "Chuyển khoản", etc.
  description TEXT,
  icon TEXT DEFAULT 'Wallet', -- Lucide icon name
  is_active BOOLEAN DEFAULT TRUE,
  is_system BOOLEAN DEFAULT FALSE, -- System methods cannot be deleted
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

-- Step 3: Create indexes
CREATE INDEX idx_payment_methods_tenant ON payment_methods(tenant_id);
CREATE INDEX idx_payment_methods_active ON payment_methods(tenant_id, is_active);

-- Step 4: Enable RLS
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

-- Step 5: RLS Policies
CREATE POLICY payment_methods_tenant_isolation ON payment_methods
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY payment_methods_select ON payment_methods
  FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY payment_methods_insert ON payment_methods
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.has_permission('settings.manage')
  );

CREATE POLICY payment_methods_update ON payment_methods
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_permission('settings.manage')
  );

CREATE POLICY payment_methods_delete ON payment_methods
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_permission('settings.manage')
    AND is_system = FALSE -- Cannot delete system methods
  );

-- Step 6: Seed default payment methods for existing tenants
INSERT INTO payment_methods (tenant_id, code, name, icon, is_system, display_order)
SELECT
  t.id,
  method.code,
  method.name,
  method.icon,
  TRUE, -- is_system = true (cannot be deleted)
  method.display_order
FROM tenants t
CROSS JOIN (VALUES
  ('cash', 'Tiền mặt', 'Banknote', 1),
  ('bank_transfer', 'Chuyển khoản', 'ArrowRightLeft', 2),
  ('card', 'Thẻ', 'CreditCard', 3),
  ('momo', 'MoMo', 'Smartphone', 4),
  ('zalopay', 'ZaloPay', 'Smartphone', 5),
  ('other', 'Khác', 'MoreHorizontal', 6)
) AS method(code, name, icon, display_order)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Step 7: RPC - Create Payment Method
CREATE OR REPLACE FUNCTION admin_create_payment_method(
  p_code TEXT,
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_icon TEXT DEFAULT 'Wallet'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_method_id UUID;
BEGIN
  -- Check permission
  IF NOT public.has_permission('settings.manage') THEN
    RAISE EXCEPTION 'Không có quyền tạo payment method';
  END IF;

  v_tenant_id := public.current_tenant_id();

  -- Validate code format (alphanumeric and underscore only)
  IF NOT p_code ~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Mã phương thức thanh toán chỉ được chứa chữ thường, số và dấu gạch dưới';
  END IF;

  -- Check if code already exists
  IF EXISTS (
    SELECT 1 FROM payment_methods
    WHERE tenant_id = v_tenant_id AND code = p_code
  ) THEN
    RAISE EXCEPTION 'Mã phương thức "%" đã tồn tại', p_code;
  END IF;

  -- Insert new payment method
  INSERT INTO payment_methods (tenant_id, code, name, description, icon, is_system, is_active)
  VALUES (v_tenant_id, p_code, p_name, p_description, p_icon, FALSE, TRUE)
  RETURNING id INTO v_method_id;

  RETURN v_method_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_create_payment_method TO authenticated;

-- Step 8: RPC - Update Payment Method
CREATE OR REPLACE FUNCTION admin_update_payment_method(
  p_method_id UUID,
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_icon TEXT DEFAULT 'Wallet',
  p_display_order INT DEFAULT 0
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
    RAISE EXCEPTION 'Không có quyền sửa payment method';
  END IF;

  v_tenant_id := public.current_tenant_id();

  -- Verify method exists in same tenant
  IF NOT EXISTS (
    SELECT 1 FROM payment_methods
    WHERE id = p_method_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Payment method không tồn tại';
  END IF;

  -- Update payment method
  UPDATE payment_methods
  SET
    name = p_name,
    description = p_description,
    icon = p_icon,
    display_order = p_display_order,
    updated_at = NOW()
  WHERE id = p_method_id AND tenant_id = v_tenant_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_payment_method TO authenticated;

-- Step 9: RPC - Toggle Payment Method Active Status
CREATE OR REPLACE FUNCTION admin_toggle_payment_method(
  p_method_id UUID,
  p_is_active BOOLEAN
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
    RAISE EXCEPTION 'Không có quyền bật/tắt payment method';
  END IF;

  v_tenant_id := public.current_tenant_id();

  -- Verify method exists
  IF NOT EXISTS (
    SELECT 1 FROM payment_methods
    WHERE id = p_method_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Payment method không tồn tại';
  END IF;

  -- Update active status
  UPDATE payment_methods
  SET is_active = p_is_active, updated_at = NOW()
  WHERE id = p_method_id AND tenant_id = v_tenant_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_toggle_payment_method TO authenticated;

-- Step 10: RPC - Delete Payment Method (only non-system methods)
CREATE OR REPLACE FUNCTION admin_delete_payment_method(
  p_method_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_is_system BOOLEAN;
BEGIN
  -- Check permission
  IF NOT public.has_permission('settings.manage') THEN
    RAISE EXCEPTION 'Không có quyền xóa payment method';
  END IF;

  v_tenant_id := public.current_tenant_id();

  -- Get method info
  SELECT is_system INTO v_is_system
  FROM payment_methods
  WHERE id = p_method_id AND tenant_id = v_tenant_id;

  IF v_is_system IS NULL THEN
    RAISE EXCEPTION 'Payment method không tồn tại';
  END IF;

  IF v_is_system = TRUE THEN
    RAISE EXCEPTION 'Không thể xóa phương thức thanh toán hệ thống';
  END IF;

  -- Check if method is being used in transactions
  IF EXISTS (
    SELECT 1 FROM pos_payments WHERE payment_method = (
      SELECT code FROM payment_methods WHERE id = p_method_id
    )
  ) OR EXISTS (
    SELECT 1 FROM invoice_payments WHERE payment_method = (
      SELECT code FROM payment_methods WHERE id = p_method_id
    )
  ) THEN
    RAISE EXCEPTION 'Không thể xóa phương thức thanh toán đang được sử dụng. Hãy vô hiệu hóa thay vì xóa.';
  END IF;

  -- Delete method
  DELETE FROM payment_methods
  WHERE id = p_method_id AND tenant_id = v_tenant_id;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_payment_method TO authenticated;

-- Step 11: Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_payment_methods_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_methods_updated_at
  BEFORE UPDATE ON payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_methods_updated_at();

-- Step 12: Add comment
COMMENT ON TABLE payment_methods IS 'Admin-configurable payment methods for POS and invoicing';
COMMENT ON COLUMN payment_methods.code IS 'Unique code for programmatic reference (lowercase, alphanumeric, underscore)';
COMMENT ON COLUMN payment_methods.is_system IS 'System methods cannot be deleted (only disabled)';
COMMENT ON COLUMN payment_methods.is_active IS 'Whether this payment method is available for selection';
