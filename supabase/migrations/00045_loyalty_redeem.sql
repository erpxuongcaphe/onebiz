-- ============================================================
-- 00045_loyalty_redeem.sql
--
-- Sprint L-3 — Redeem loyalty points
--
-- earn_loyalty_points đã có ở 00005. KM-3 thêm RPC redeem để KH dùng
-- điểm trừ tiền hoá đơn:
--   1. Validate points <= customer.loyalty_points (atomic check)
--   2. Decrement points
--   3. Insert loyalty_transactions (type='redeem', points = -X)
--   4. Return new balance
--
-- Discount amount tính ở client (engine) qua redemption_value /
-- redemption_points + cap maxRedemptionPercent. Server chỉ atomic
-- decrement để chống race khi 2 thiết bị cùng redeem 1 KH.
-- ============================================================

CREATE OR REPLACE FUNCTION public.redeem_loyalty_points(
  p_customer_id UUID,
  p_points INTEGER,
  p_invoice_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id UUID;
  v_balance INTEGER;
BEGIN
  v_tenant_id := public.get_user_tenant_id();

  IF p_points <= 0 THEN
    RAISE EXCEPTION 'Số điểm phải lớn hơn 0';
  END IF;

  -- Atomic check + decrement: chỉ trừ nếu đủ điểm. Không qua 2 statement
  -- (SELECT then UPDATE) để tránh race condition giữa nhiều thiết bị.
  UPDATE public.customers
  SET loyalty_points = loyalty_points - p_points
  WHERE id = p_customer_id
    AND tenant_id = v_tenant_id
    AND loyalty_points >= p_points
  RETURNING loyalty_points INTO v_balance;

  IF v_balance IS NULL THEN
    -- Hoặc KH không tồn tại trong tenant này, hoặc không đủ điểm
    SELECT loyalty_points INTO v_balance FROM public.customers
      WHERE id = p_customer_id AND tenant_id = v_tenant_id;
    IF v_balance IS NULL THEN
      RAISE EXCEPTION 'Khách hàng không tồn tại';
    ELSE
      RAISE EXCEPTION 'Khách hàng không đủ điểm (còn % điểm, cần % điểm)', v_balance, p_points;
    END IF;
  END IF;

  -- Ghi sổ — points lưu negative để dễ aggregate
  INSERT INTO public.loyalty_transactions (
    tenant_id, customer_id, type, points, balance_after,
    reference_type, reference_id, created_by
  )
  VALUES (
    v_tenant_id, p_customer_id, 'redeem', -p_points, v_balance,
    'invoice', p_invoice_id, auth.uid()
  );

  RETURN v_balance;
END;
$$;

COMMENT ON FUNCTION public.redeem_loyalty_points IS
  'Atomic redeem: validate points >= requested, decrement, log. Trả new balance. Discount amount client tính qua loyalty_settings.';
