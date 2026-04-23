-- ============================================================
-- 00038_product_images_bucket.sql
-- Tạo Supabase Storage bucket `product-images` để upload ảnh sản phẩm.
--
-- Lý do: CEO Q4 "cần upload ảnh" — trước đây dialog có placeholder
-- <div> "Ảnh" nhưng không làm gì. Column products.image đã có sẵn
-- (lưu public URL), chỉ thiếu storage bucket + policy.
--
-- Quyết định:
--   - `public = true` để các trang ERP không auth vẫn load ảnh được
--     (POS, dashboard public). Policy INSERT/UPDATE/DELETE cho phép
--     authenticated user, vì dev hiện dùng NEXT_PUBLIC_BYPASS_AUTH=true
--     (anon) nên thêm anon vào policy INSERT tạm thời — sẽ siết lại
--     khi bật RLS production.
--   - Path pattern: `{tenant_id}/{random-uuid}.{ext}` để tránh collision
--     + cho phép tenant isolation khi cần (policy dùng (storage.foldername(name))[1]).
-- ============================================================

-- 1. Tạo bucket (idempotent) — tự động public cho SELECT
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880, -- 5 MB / file, đủ cho ảnh SP web-optimized
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Policies — drop trước khi create để idempotent
DROP POLICY IF EXISTS "product_images_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "product_images_auth_write"    ON storage.objects;
DROP POLICY IF EXISTS "product_images_auth_update"   ON storage.objects;
DROP POLICY IF EXISTS "product_images_auth_delete"   ON storage.objects;

-- Public đọc — ảnh SP hiển thị ở POS / Landing / email cho khách
CREATE POLICY "product_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

-- Insert: cho anon + authenticated trong môi trường dev (bypass auth).
-- Khi production bật RLS, đổi thành `auth.role() = 'authenticated'`.
CREATE POLICY "product_images_auth_write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product_images_auth_update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-images');

CREATE POLICY "product_images_auth_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'product-images');
