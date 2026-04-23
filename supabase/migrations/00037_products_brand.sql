-- ============================================================
-- 00037_products_brand.sql
-- Thêm cột `brand` (thương hiệu) cho bảng products.
--
-- Lý do: trước đây detail panel trang Hàng hoá hardcoded "Thương hiệu:
-- Chưa có" cho mọi sản phẩm — CEO phản ánh thông tin sản phẩm sơ sài.
-- Thêm brand cho phép lưu thương hiệu NVL/SKU (VD: Monin, Trung Nguyên,
-- Highlands…) + filter theo brand ở sidebar.
--
-- Nullable vì product cũ không có brand. FE chỉ hiển thị khi có.
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS brand TEXT;

COMMENT ON COLUMN public.products.brand IS
  'Thương hiệu / nhãn hàng của sản phẩm (VD: Monin, Trung Nguyên). Nullable vì nhiều NVL không có brand.';

-- Index phục vụ filter brand ở danh sách hàng hoá. Partial (bỏ NULL) để
-- giảm size, chỉ index rows đã set brand.
CREATE INDEX IF NOT EXISTS idx_products_brand
  ON public.products (tenant_id, brand)
  WHERE brand IS NOT NULL;
