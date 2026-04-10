-- ============================================================
-- Migration 00012: Warehouse Entities
-- Creates tables for: supplier_returns, input_invoices,
-- disposal_exports, internal_exports, sales_orders
-- ============================================================

-- ============================================================
-- 1. Supplier Returns (Trả hàng nhập — trả lại NCC)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.supplier_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  code TEXT NOT NULL,
  purchase_order_id UUID REFERENCES public.purchase_orders(id),
  import_code TEXT,
  supplier_id UUID REFERENCES public.suppliers(id),
  supplier_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'cancelled')),
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  note TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.supplier_returns(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  product_name TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);

-- ============================================================
-- 2. Input Invoices (Hóa đơn đầu vào — từ NCC)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.input_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  code TEXT NOT NULL,
  supplier_id UUID REFERENCES public.suppliers(id),
  supplier_name TEXT NOT NULL DEFAULT '',
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unrecorded' CHECK (status IN ('recorded', 'unrecorded')),
  purchase_order_id UUID REFERENCES public.purchase_orders(id),
  note TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. Disposal Exports (Xuất hủy)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.disposal_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'cancelled')),
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  reason TEXT,
  note TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.disposal_export_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disposal_id UUID NOT NULL REFERENCES public.disposal_exports(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  product_name TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);

-- ============================================================
-- 4. Internal Exports (Xuất dùng nội bộ)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.internal_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'cancelled')),
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  department TEXT,
  note TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_export_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id UUID NOT NULL REFERENCES public.internal_exports(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  product_name TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);

-- ============================================================
-- 5. Sales Orders (Đặt hàng bán)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  code TEXT NOT NULL,
  customer_id UUID REFERENCES public.customers(id),
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'delivering', 'completed', 'cancelled')),
  total NUMERIC(15,2) NOT NULL DEFAULT 0,
  note TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  product_name TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  quantity NUMERIC(15,3) NOT NULL DEFAULT 0,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount NUMERIC(15,2) NOT NULL DEFAULT 0,
  total NUMERIC(15,2) NOT NULL DEFAULT 0
);

-- ============================================================
-- 6. RLS Policies
-- ============================================================
ALTER TABLE public.supplier_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.input_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disposal_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disposal_export_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_export_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped policies (same pattern as existing tables)
CREATE POLICY "tenant_isolation" ON public.supplier_returns
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_isolation" ON public.input_invoices
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_isolation" ON public.disposal_exports
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_isolation" ON public.internal_exports
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_isolation" ON public.sales_orders
  USING (tenant_id = public.get_user_tenant_id());

-- Child table policies via parent FK
CREATE POLICY "tenant_via_parent" ON public.supplier_return_items
  USING (EXISTS (
    SELECT 1 FROM public.supplier_returns sr WHERE sr.id = return_id
    AND sr.tenant_id = public.get_user_tenant_id()
  ));
CREATE POLICY "tenant_via_parent" ON public.disposal_export_items
  USING (EXISTS (
    SELECT 1 FROM public.disposal_exports de WHERE de.id = disposal_id
    AND de.tenant_id = public.get_user_tenant_id()
  ));
CREATE POLICY "tenant_via_parent" ON public.internal_export_items
  USING (EXISTS (
    SELECT 1 FROM public.internal_exports ie WHERE ie.id = export_id
    AND ie.tenant_id = public.get_user_tenant_id()
  ));
CREATE POLICY "tenant_via_parent" ON public.sales_order_items
  USING (EXISTS (
    SELECT 1 FROM public.sales_orders so WHERE so.id = order_id
    AND so.tenant_id = public.get_user_tenant_id()
  ));

-- ============================================================
-- 7. Updated_at triggers
-- ============================================================
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.supplier_returns
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.input_invoices
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.disposal_exports
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.internal_exports
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- 8. Seed code_sequences for new entity types
-- ============================================================
-- These will be auto-created by next_code() on first use per tenant,
-- but we seed them here for clarity.
-- (next_code handles missing rows gracefully)
