-- ============================================================
-- Sprint D: F&B Enhancements — Real-world VN coffee shop scenarios
-- ============================================================
-- Adds: discount tracking, delivery platform, order merging,
--       void/refund support, table transfer audit

-- 1. kitchen_orders: thêm discount + delivery fields
ALTER TABLE public.kitchen_orders
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason text,
  ADD COLUMN IF NOT EXISTS delivery_platform text
    CHECK (delivery_platform IS NULL OR delivery_platform IN ('shopee_food','grab_food','gojek','be','direct')),
  ADD COLUMN IF NOT EXISTS delivery_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_commission numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.kitchen_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_table_id uuid REFERENCES public.restaurant_tables(id) ON DELETE SET NULL;

-- 2. kitchen_order_items: cancelled_qty for partial cancel
ALTER TABLE public.kitchen_order_items
  ADD COLUMN IF NOT EXISTS cancelled_qty int NOT NULL DEFAULT 0;

-- 3. invoices: thêm delivery + platform tracking
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS delivery_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_commission numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_type text DEFAULT 'fixed'
    CHECK (discount_type IN ('fixed','percent')),
  ADD COLUMN IF NOT EXISTS discount_percent numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid;

-- 4. Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_delivery_platform
  ON public.kitchen_orders (delivery_platform)
  WHERE delivery_platform IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_kitchen_orders_merged_into
  ON public.kitchen_orders (merged_into_id)
  WHERE merged_into_id IS NOT NULL;
