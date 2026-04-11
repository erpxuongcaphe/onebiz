-- ============================================================
-- Migration 00015: VAT (Thuế GTGT) support
-- Thêm tax_rate cho products, invoice_items, purchase_order_items
-- Thêm tax_amount cho invoices, purchase_orders
-- ============================================================

-- 1. Products — thuế suất mặc định cho từng sản phẩm
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.products.vat_rate IS 'Thuế suất GTGT mặc định (%). Ví dụ: 0, 5, 8, 10';

-- 2. Invoice Items — thuế tại thời điểm bán
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.invoice_items.vat_rate IS 'Thuế suất GTGT (%) snapshot tại thời điểm bán';
COMMENT ON COLUMN public.invoice_items.vat_amount IS 'Tiền thuế GTGT = (unit_price * quantity - discount) * vat_rate / 100';

-- 3. Invoices — tổng thuế
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.invoices.tax_amount IS 'Tổng thuế GTGT đầu ra (VAT output)';

-- 4. Purchase Order Items — thuế tại thời điểm nhập
ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.purchase_order_items.vat_rate IS 'Thuế suất GTGT (%) snapshot tại thời điểm nhập';
COMMENT ON COLUMN public.purchase_order_items.vat_amount IS 'Tiền thuế GTGT = (unit_price * quantity - discount) * vat_rate / 100';

-- 5. Purchase Orders — tổng thuế
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.purchase_orders.tax_amount IS 'Tổng thuế GTGT đầu vào (VAT input)';

-- 6. Supplier Return Items — thuế khi trả hàng nhập
ALTER TABLE public.supplier_return_items
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
