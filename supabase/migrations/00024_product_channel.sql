-- ============================================================
-- Migration 00024: Product channel (fnb | retail)
-- Phân tách sản phẩm theo kênh bán:
--   'fnb'    = món pha chế tại quán (Caramel Macchiato, Cà phê sữa đá...)
--   'retail' = hàng đóng gói bán lẻ/sỉ (Rang xay 250g, Hộp quà, Syrup chai...)
-- NVL (nguyên liệu nội bộ) không gán channel — chỉ luân chuyển qua internal_sales.
-- ============================================================

-- 1. Thêm column channel (nullable để backward-compat cho NVL)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS channel TEXT;

-- 2. Check constraint: chỉ cho phép fnb/retail/NULL
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'products_channel_check'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_channel_check
      CHECK (channel IS NULL OR channel IN ('fnb', 'retail'));
  END IF;
END $$;

-- 3. Index cho POS query (filter WHERE channel = 'fnb' AND tenant_id = ...)
CREATE INDEX IF NOT EXISTS idx_products_channel
  ON public.products (tenant_id, channel) WHERE channel IS NOT NULL;

-- 4. Backfill dựa trên category code + product_type
-- 4a. FnB menu items: category code bắt đầu bằng F (FCA, FTR, FSV, FDA, FNE, FBG, FAN, FKM)
UPDATE public.products p
SET channel = 'fnb'
FROM public.categories c
WHERE p.category_id = c.id
  AND p.product_type = 'sku'
  AND p.channel IS NULL
  AND c.code IS NOT NULL
  AND c.code LIKE 'F%';

-- 4b. Retail SKUs: còn lại (SKU nhưng không phải F*)
-- RXA (Rang xay), CPC (Combo), BOD (Bột đóng gói), PHU (Phụ kiện), KIT (Kit), TRB (Trà bán lại)...
UPDATE public.products p
SET channel = 'retail'
WHERE p.product_type = 'sku'
  AND p.channel IS NULL;

-- NVL (product_type='nvl') để NULL — không bán ra ngoài, chỉ internal.

-- 5. Document
COMMENT ON COLUMN public.products.channel IS
  'Kênh bán: ''fnb'' (pha chế tại quán) | ''retail'' (đóng gói bán lẻ/sỉ) | NULL (NVL nội bộ)';
