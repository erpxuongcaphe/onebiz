-- ============================================================
-- 00106: BOM decouple product — Phase 2 (relax product_id + new unique)
--
-- Tiếp nối Migration 00105 (Phase 1) — sau khi backfill products.bom_code
-- thành công và get_active_bom_for_branch() đã override ưu tiên đọc bom_code.
--
-- Phase 2 thay đổi:
--   1. RELAX bom.product_id từ NOT NULL → NULLABLE
--      → Cho phép tạo BOM standalone qua Excel (không cần Mã SKU)
--   2. Drop unique index cũ (tenant_id, product_id, branch_id)
--      → Replace bằng (tenant_id, code, branch_id) — model mới identify BOM
--        bằng CODE, không phải product_id
--   3. Giữ unique cũ với điều kiện product_id IS NOT NULL → backward compat
--      cho BOM cũ còn product_id
--
-- An toàn:
--   - Existing BOMs vẫn có product_id NOT NULL (sau backfill 00105)
--   - get_active_bom_for_branch() ưu tiên bom_code path → POS vẫn work
--   - Excel BOM Phase 3 sẽ tạo BOM với product_id NULL (sau migration này)
-- ============================================================

-- 1. Drop unique cũ
drop index if exists public.idx_bom_product_branch_unique;

-- 2. Relax NOT NULL
alter table public.bom
  alter column product_id drop not null;

-- 3. Unique mới — identify BOM bằng CODE
-- 1 tenant × 1 code × 1 branch (hoặc global) = tối đa 1 BOM active.
-- COALESCE để treat NULL branch_id như 1 giá trị.
create unique index if not exists idx_bom_code_branch_unique
  on public.bom (
    tenant_id,
    code,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where is_active = true and code is not null;

-- 4. Recreate old unique nhưng có điều kiện product_id IS NOT NULL
-- → BOM cũ với product_id NOT NULL vẫn enforce unique (tenant, product, branch)
-- → BOM mới với product_id NULL không apply unique này
create unique index if not exists idx_bom_product_branch_unique
  on public.bom (
    tenant_id,
    product_id,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where is_active = true and product_id is not null;

-- 5. Index bổ sung: nhanh lookup BOM theo code
create index if not exists idx_bom_tenant_code
  on public.bom(tenant_id, code) where code is not null;

-- 6. Comment
comment on column public.bom.product_id is
  'CEO 20/05/2026 (Phase 2): NULLABLE. BOM có thể tạo standalone (product_id=null), gắn SKU sau qua products.bom_code. Nếu có giá trị thì là BOM gắn cứng với 1 SKU (legacy).';

comment on column public.bom.code is
  'CEO 20/05/2026: Mã BOM định danh BOM trong tenant. Format chuẩn BOM-{NHÓM}-{NNN} (vd BOM-CFS-001). Unique per (tenant, code, branch_id).';

-- 7. Reload schema cache
notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY (chạy thủ công sau migration):
--
-- 1. Test insert BOM standalone (product_id = NULL):
--    INSERT INTO bom (tenant_id, code, name, branch_id, batch_size, yield_qty, yield_unit)
--    VALUES ('<your-tenant-id>', 'BOM-TEST-999', 'Test standalone', NULL, 1, 1, 'cái');
--    → kỳ vọng SUCCESS (không có lỗi NOT NULL)
--
-- 2. Test duplicate code → fail:
--    INSERT INTO bom (tenant_id, code, name, branch_id, batch_size, yield_qty, yield_unit)
--    VALUES ('<your-tenant-id>', 'BOM-TEST-999', 'Duplicate', NULL, 1, 1, 'cái');
--    → kỳ vọng ERROR unique violation
--
-- 3. Cleanup test:
--    DELETE FROM bom WHERE code = 'BOM-TEST-999';
-- ============================================================
