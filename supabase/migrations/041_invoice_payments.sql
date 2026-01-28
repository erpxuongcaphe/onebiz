-- OneBiz ERP - Invoice Payments & Partial Payment Support
-- Migration: 041_invoice_payments.sql

-- 1. Add 'unpaid' status to pos_orders for invoice tracking
ALTER TABLE public.pos_orders
DROP CONSTRAINT IF EXISTS pos_orders_status_check;

ALTER TABLE public.pos_orders
ADD CONSTRAINT pos_orders_status_check
CHECK (status IN ('draft', 'paid', 'void', 'refunded', 'unpaid'));

-- 2. Add payment tracking columns to pos_orders
ALTER TABLE public.pos_orders
ADD COLUMN IF NOT EXISTS amount_paid numeric(15,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS due_date date,
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending'
  CHECK (payment_status IN ('pending', 'partial', 'paid', 'overdue'));

-- 3. Create invoice_payments table for partial payment tracking
CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.pos_orders (id) ON DELETE CASCADE,
  amount numeric(15,2) NOT NULL,
  method text NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash', 'bank_transfer', 'card', 'momo', 'zalopay', 'other')),
  paid_at timestamptz NOT NULL DEFAULT now(),
  reference text,
  notes text,
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_order_id ON public.invoice_payments (order_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_tenant_paid_at ON public.invoice_payments (tenant_id, paid_at DESC);
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies for invoice_payments
CREATE POLICY "tenant_isolation_invoice_payments" ON public.invoice_payments
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY "invoice_payments_select" ON public.invoice_payments
  FOR SELECT USING (true);

CREATE POLICY "invoice_payments_insert" ON public.invoice_payments
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 5. Function to record invoice payment
CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_order record;
  v_new_amount_paid numeric;
  v_new_status text;
  v_payment_id uuid;
BEGIN
  -- Get tenant from order
  SELECT tenant_id, total, amount_paid, status
  INTO v_order
  FROM public.pos_orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;

  v_tenant_id := v_order.tenant_id;

  -- Check order status allows payment
  IF v_order.status NOT IN ('unpaid', 'draft') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order status does not allow payment');
  END IF;

  -- Calculate new amount paid
  v_new_amount_paid := COALESCE(v_order.amount_paid, 0) + p_amount;

  -- Determine new payment status
  IF v_new_amount_paid >= v_order.total THEN
    v_new_status := 'paid';
  ELSE
    v_new_status := 'partial';
  END IF;

  -- Insert payment record
  INSERT INTO public.invoice_payments (
    tenant_id, order_id, amount, method, reference, notes, created_by
  ) VALUES (
    v_tenant_id, p_order_id, p_amount, p_method, p_reference, p_notes, auth.uid()
  )
  RETURNING id INTO v_payment_id;

  -- Update order
  UPDATE public.pos_orders
  SET
    amount_paid = v_new_amount_paid,
    payment_status = v_new_status,
    status = CASE WHEN v_new_amount_paid >= total THEN 'paid' ELSE status END,
    updated_at = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'amount_paid', v_new_amount_paid,
    'remaining', v_order.total - v_new_amount_paid,
    'payment_status', v_new_status
  );
END;
$$;

-- 6. Function to get accounts receivable summary
CREATE OR REPLACE FUNCTION public.get_accounts_receivable(
  p_customer_id uuid DEFAULT NULL
)
RETURNS TABLE (
  customer_id uuid,
  customer_name text,
  total_receivable numeric,
  total_paid numeric,
  total_outstanding numeric,
  invoice_count bigint,
  oldest_invoice_date timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id as customer_id,
    c.name as customer_name,
    COALESCE(SUM(o.total), 0) as total_receivable,
    COALESCE(SUM(o.amount_paid), 0) as total_paid,
    COALESCE(SUM(o.total - o.amount_paid), 0) as total_outstanding,
    COUNT(o.id) as invoice_count,
    MIN(o.created_at) as oldest_invoice_date
  FROM public.sales_customers c
  LEFT JOIN public.pos_orders o ON o.customer_id = c.id
    AND o.status IN ('unpaid', 'draft')
    AND o.payment_status IN ('pending', 'partial')
  WHERE (p_customer_id IS NULL OR c.id = p_customer_id)
  GROUP BY c.id, c.name
  HAVING COALESCE(SUM(o.total - o.amount_paid), 0) > 0
  ORDER BY total_outstanding DESC;
$$;

-- 7. Function to get aging report
CREATE OR REPLACE FUNCTION public.get_aging_report()
RETURNS TABLE (
  customer_id uuid,
  customer_name text,
  current_0_7 numeric,
  days_8_30 numeric,
  days_31_60 numeric,
  days_over_60 numeric,
  total_outstanding numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id as customer_id,
    c.name as customer_name,
    COALESCE(SUM(CASE
      WHEN o.created_at > now() - interval '7 days' THEN o.total - o.amount_paid
      ELSE 0
    END), 0) as current_0_7,
    COALESCE(SUM(CASE
      WHEN o.created_at <= now() - interval '7 days'
       AND o.created_at > now() - interval '30 days' THEN o.total - o.amount_paid
      ELSE 0
    END), 0) as days_8_30,
    COALESCE(SUM(CASE
      WHEN o.created_at <= now() - interval '30 days'
       AND o.created_at > now() - interval '60 days' THEN o.total - o.amount_paid
      ELSE 0
    END), 0) as days_31_60,
    COALESCE(SUM(CASE
      WHEN o.created_at <= now() - interval '60 days' THEN o.total - o.amount_paid
      ELSE 0
    END), 0) as days_over_60,
    COALESCE(SUM(o.total - o.amount_paid), 0) as total_outstanding
  FROM public.sales_customers c
  LEFT JOIN public.pos_orders o ON o.customer_id = c.id
    AND o.status IN ('unpaid', 'draft')
    AND o.payment_status IN ('pending', 'partial')
  GROUP BY c.id, c.name
  HAVING COALESCE(SUM(o.total - o.amount_paid), 0) > 0
  ORDER BY total_outstanding DESC;
$$;
