-- ============================================================
-- Migration 00022: Internal Sales (Phase 1 — Sprint 1.1)
-- Cho phép giao dịch nội bộ giữa các chi nhánh (profit center)
-- ============================================================

-- 1. ALTER customers: thêm is_internal + branch_id
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);

CREATE INDEX IF NOT EXISTS idx_customers_is_internal
  ON public.customers (tenant_id, is_internal) WHERE is_internal = true;

-- 2. ALTER suppliers: thêm is_internal + branch_id
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);

CREATE INDEX IF NOT EXISTS idx_suppliers_is_internal
  ON public.suppliers (tenant_id, is_internal) WHERE is_internal = true;

-- 3. CREATE TABLE internal_sales
CREATE TABLE IF NOT EXISTS public.internal_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  code TEXT NOT NULL,
  from_branch_id UUID NOT NULL REFERENCES public.branches(id),
  to_branch_id UUID NOT NULL REFERENCES public.branches(id),
  invoice_id UUID REFERENCES public.invoices(id),
  input_invoice_id UUID REFERENCES public.input_invoices(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'completed', 'cancelled')),
  subtotal NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  note TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT different_branches CHECK (from_branch_id <> to_branch_id)
);

CREATE INDEX IF NOT EXISTS idx_internal_sales_tenant
  ON public.internal_sales (tenant_id);
CREATE INDEX IF NOT EXISTS idx_internal_sales_from_branch
  ON public.internal_sales (from_branch_id);
CREATE INDEX IF NOT EXISTS idx_internal_sales_to_branch
  ON public.internal_sales (to_branch_id);
CREATE INDEX IF NOT EXISTS idx_internal_sales_status
  ON public.internal_sales (tenant_id, status);

-- 4. CREATE TABLE internal_sale_items
CREATE TABLE IF NOT EXISTS public.internal_sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_sale_id UUID NOT NULL REFERENCES public.internal_sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'cái',
  quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_internal_sale_items_sale
  ON public.internal_sale_items (internal_sale_id);

-- 5. Updated_at trigger
CREATE TRIGGER set_updated_at_internal_sales
  BEFORE UPDATE ON public.internal_sales
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 6. RLS policies
ALTER TABLE public.internal_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal_sales_tenant_isolation" ON public.internal_sales
  FOR ALL USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "internal_sale_items_tenant_isolation" ON public.internal_sale_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.internal_sales s
      WHERE s.id = internal_sale_id
        AND s.tenant_id = public.get_user_tenant_id()
    )
  );

-- 7. Seed function: tạo customer/supplier nội bộ cho mỗi branch
CREATE OR REPLACE FUNCTION public.seed_internal_entities(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  branch RECORD;
  next_cust_code TEXT;
  next_supp_code TEXT;
BEGIN
  FOR branch IN
    SELECT id, name, code, branch_type
    FROM public.branches
    WHERE tenant_id = p_tenant_id AND is_active = true
  LOOP
    -- Mỗi branch → customer nội bộ (các branch khác mua hàng từ branch này sẽ thấy nó là supplier,
    -- nhưng branch này cần có customer record để tạo invoice bán cho branch khác)
    IF NOT EXISTS (
      SELECT 1 FROM public.customers
      WHERE tenant_id = p_tenant_id AND is_internal = true AND branch_id = branch.id
    ) THEN
      -- Generate next customer code
      SELECT 'KH-NB-' || COALESCE(branch.code, LEFT(branch.id::text, 4))
        INTO next_cust_code;

      INSERT INTO public.customers (
        tenant_id, code, name, phone, customer_type,
        is_internal, branch_id, is_active
      ) VALUES (
        p_tenant_id,
        next_cust_code,
        'NB: ' || branch.name,
        '',
        'company',
        true,
        branch.id,
        true
      )
      ON CONFLICT DO NOTHING;
    END IF;

    -- Mỗi branch (factory/warehouse) → supplier nội bộ
    -- Store thường không bán cho branch khác, nhưng vẫn tạo để linh hoạt
    IF NOT EXISTS (
      SELECT 1 FROM public.suppliers
      WHERE tenant_id = p_tenant_id AND is_internal = true AND branch_id = branch.id
    ) THEN
      SELECT 'NCC-NB-' || COALESCE(branch.code, LEFT(branch.id::text, 4))
        INTO next_supp_code;

      INSERT INTO public.suppliers (
        tenant_id, code, name, phone,
        is_internal, branch_id, is_active
      ) VALUES (
        p_tenant_id,
        next_supp_code,
        'NB: ' || branch.name,
        '',
        true,
        branch.id,
        true
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END;
$$;
