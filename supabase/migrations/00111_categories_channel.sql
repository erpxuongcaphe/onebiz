-- ============================================================
-- 00111: Categories channel (fnb | retail) — CEO 22/05/2026
-- ============================================================
-- Trang /hang-hoa/nhom thiếu chọn channel khi tạo SKU category. Hiện
-- khi user tạo nhóm SKU, không phân biệt Retail vs FnB → khi tạo SP
-- thuộc nhóm này, cashier phải chọn channel lại cho mỗi SP — dễ nhầm.
--
-- Fix: thêm field categories.channel cho scope='sku'.
--   - 'fnb'    = nhóm menu pha chế tại quán
--   - 'retail' = nhóm hàng đóng gói bán lẻ
--   - NULL     = NVL hoặc category scope khác (customer/supplier)
--
-- Sau migration:
--   - Khi tạo SKU thuộc nhóm có channel → tự fill channel cho SP, không
--     cần cashier chọn lại
--   - Báo cáo cross-channel filter chính xác hơn (nhóm × channel)
--   - Migration backfill từ pattern code 'F*' (FnB) và còn lại (retail)

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS channel TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'categories_channel_check'
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_channel_check
      CHECK (channel IS NULL OR channel IN ('fnb', 'retail'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_categories_channel
  ON public.categories (tenant_id, channel) WHERE channel IS NOT NULL;

-- Backfill từ products: nếu 1 category có >50% SP channel='fnb' → set fnb,
-- ngược lại retail. NVL/customer/supplier giữ NULL.
WITH category_stats AS (
  SELECT
    c.id,
    c.scope,
    COUNT(*) FILTER (WHERE p.channel = 'fnb') AS fnb_count,
    COUNT(*) FILTER (WHERE p.channel = 'retail') AS retail_count
  FROM public.categories c
  LEFT JOIN public.products p ON p.category_id = c.id
  WHERE c.scope = 'sku'
  GROUP BY c.id, c.scope
)
UPDATE public.categories c
SET channel = CASE
  WHEN s.fnb_count >= s.retail_count AND s.fnb_count > 0 THEN 'fnb'
  WHEN s.retail_count > 0 THEN 'retail'
  ELSE NULL
END
FROM category_stats s
WHERE c.id = s.id
  AND c.channel IS NULL;

COMMENT ON COLUMN public.categories.channel IS
  'Kênh bán cho category scope=sku: fnb (pha chế tại quán) | retail (đóng gói bán lẻ) | NULL (NVL/customer/supplier). CEO 22/05/2026.';

NOTIFY pgrst, 'reload schema';
