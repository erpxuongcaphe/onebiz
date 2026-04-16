-- ============================================================
-- Migration 00023: Fix internal_sales issues from self-test
-- 1. Fix created_by FK: auth.users → profiles
-- 2. Add UNIQUE(tenant_id, code) on internal_sales
-- 3. Fix seed_internal_entities: proper ON CONFLICT targets
-- ============================================================

-- 1. Fix FK: created_by should reference profiles(id), not auth.users(id)
-- Drop old FK and create new one
ALTER TABLE public.internal_sales
  DROP CONSTRAINT IF EXISTS internal_sales_created_by_fkey;

ALTER TABLE public.internal_sales
  ADD CONSTRAINT internal_sales_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.profiles(id);

-- 2. Add UNIQUE constraint on (tenant_id, code) to prevent duplicate codes
ALTER TABLE public.internal_sales
  ADD CONSTRAINT internal_sales_tenant_code_unique UNIQUE (tenant_id, code);

-- 3. Add unique constraints on customers/suppliers for internal entities
-- so ON CONFLICT can target them properly
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_internal_branch
  ON public.customers (tenant_id, branch_id) WHERE is_internal = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_internal_branch
  ON public.suppliers (tenant_id, branch_id) WHERE is_internal = true;

-- 4. Replace seed function with proper ON CONFLICT targets
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
    -- Mỗi branch → customer nội bộ
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
    ON CONFLICT (tenant_id, branch_id) WHERE is_internal = true
    DO UPDATE SET
      name = EXCLUDED.name,
      code = EXCLUDED.code;

    -- Mỗi branch → supplier nội bộ
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
    ON CONFLICT (tenant_id, branch_id) WHERE is_internal = true
    DO UPDATE SET
      name = EXCLUDED.name,
      code = EXCLUDED.code;
  END LOOP;
END;
$$;
