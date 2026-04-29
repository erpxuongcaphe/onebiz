-- ============================================================
-- 00040_cleanup_duplicate_categories.sql
--
-- Migration 00039 thất bại trên DB của CEO: UNIQUE INDEX không tạo được
-- vì các row duplicate đã tồn tại từ trước (CEO báo "thành công" vì
-- Supabase Editor parse OK nhưng execute rolled back).
--
-- File này tách riêng phần cleanup data → CREATE INDEX an toàn.
--
-- Logic:
--   1. Với mỗi nhóm trùng (tenant_id, code, scope) có >1 row:
--      a. Keeper = row OLDEST (created_at min)
--      b. REASSIGN products.category_id từ duplicate IDs → keeper ID
--         (giữ data product không bị orphan/SET NULL)
--      c. REASSIGN categories.parent_id (self-FK) tương tự
--      d. DELETE các duplicate (giữ keeper)
--   2. Tạo lại UNIQUE INDEX (idempotent qua IF NOT EXISTS)
--   3. Recreate peek_next_group_code function (idempotent qua OR REPLACE)
--
-- Idempotent: chạy nhiều lần OK — vòng lặp DO block không hit bất cứ row
-- nào nếu đã unique. CREATE INDEX IF NOT EXISTS không lỗi nếu đã tồn tại.
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. Cleanup duplicate rows + reassign FK
-- ──────────────────────────────────────────────────────────
DO $$
DECLARE
  rec RECORD;
  v_keeper_id uuid;
  v_deleted_count int;
  v_total_deleted int := 0;
BEGIN
  FOR rec IN
    SELECT tenant_id, code, scope, COUNT(*) AS cnt
    FROM public.categories
    WHERE code IS NOT NULL AND scope IS NOT NULL
    GROUP BY tenant_id, code, scope
    HAVING COUNT(*) > 1
  LOOP
    -- Chọn keeper = row OLDEST (đầu tiên được tạo, có nhiều khả năng đúng nhất).
    SELECT id INTO v_keeper_id
    FROM public.categories
    WHERE tenant_id = rec.tenant_id
      AND code = rec.code
      AND scope = rec.scope
    ORDER BY created_at, id
    LIMIT 1;

    -- Reassign products ref tới duplicates → keeper
    UPDATE public.products
    SET category_id = v_keeper_id
    WHERE category_id IN (
      SELECT id FROM public.categories
      WHERE tenant_id = rec.tenant_id
        AND code = rec.code
        AND scope = rec.scope
        AND id <> v_keeper_id
    );

    -- Reassign categories.parent_id (self-FK) — duplicate có thể là parent
    UPDATE public.categories
    SET parent_id = v_keeper_id
    WHERE parent_id IN (
      SELECT id FROM public.categories
      WHERE tenant_id = rec.tenant_id
        AND code = rec.code
        AND scope = rec.scope
        AND id <> v_keeper_id
    );

    -- Reassign customer_groups.group_id (nếu có FK)
    BEGIN
      UPDATE public.customer_groups
      SET group_id = v_keeper_id
      WHERE group_id IN (
        SELECT id FROM public.categories
        WHERE tenant_id = rec.tenant_id
          AND code = rec.code
          AND scope = rec.scope
          AND id <> v_keeper_id
      );
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      -- customer_groups.group_id có thể chưa tồn tại trên 1 số tenant
      NULL;
    END;

    -- Delete duplicates
    DELETE FROM public.categories
    WHERE tenant_id = rec.tenant_id
      AND code = rec.code
      AND scope = rec.scope
      AND id <> v_keeper_id;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_deleted_count;

    RAISE NOTICE 'Cleaned % duplicates of (code=%, scope=%) — keeper=%',
      v_deleted_count, rec.code, rec.scope, v_keeper_id;
  END LOOP;

  RAISE NOTICE 'Total duplicates removed: %', v_total_deleted;
END $$;

-- ──────────────────────────────────────────────────────────
-- 2. UNIQUE INDEX — partial (bỏ NULL), idempotent
-- ──────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_tenant_code_scope_unique
  ON public.categories (tenant_id, code, scope)
  WHERE code IS NOT NULL AND scope IS NOT NULL;

-- ──────────────────────────────────────────────────────────
-- 3. peek_next_group_code() — recreate idempotent
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.peek_next_group_code(
  p_tenant_id uuid,
  p_prefix text,
  p_group_code text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next int;
  v_padding int;
BEGIN
  SELECT current_number + 1, padding
    INTO v_next, v_padding
  FROM public.group_code_sequences
  WHERE tenant_id = p_tenant_id
    AND prefix = p_prefix
    AND group_code = p_group_code;

  IF v_next IS NULL THEN
    v_next := 1;
    v_padding := 3;
  END IF;

  RETURN p_prefix || '-' || p_group_code || '-' ||
         lpad(v_next::text, v_padding, '0');
END;
$$;

COMMENT ON FUNCTION public.peek_next_group_code IS
  'Preview mã group tiếp theo KHÔNG increment counter. Dùng cho FE preview mã trong dialog tạo SP. next_group_code() là version increment khi save.';
