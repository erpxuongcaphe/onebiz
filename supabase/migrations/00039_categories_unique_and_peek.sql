-- ============================================================
-- 00039_categories_unique_and_peek.sql
--
-- 1. UNIQUE constraint cho categories (tenant_id, code, scope) — chặn từ
--    DB chứ không phải dedupe FE band-aid (CEO trước đó báo "Cà phê chai
--    × 4 lần" do seed insert trùng).
-- 2. Function `peek_next_group_code()` — preview số tiếp theo của 1 group
--    KHÔNG increment sequence. Dùng cho dialog tạo SP hiển thị mã thật
--    (NVL-CPH-014) ngay khi nhân viên chọn nhóm — không phải XXX placeholder.
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. Rename duplicate codes (giữ oldest, đổi tên newer) trước khi
--    add constraint. Dùng suffix `_dup{first4}` để rõ ràng + không phá FK.
-- ──────────────────────────────────────────────────────────
UPDATE public.categories
SET code = code || '_dup' || substring(id::text, 1, 4)
WHERE code IS NOT NULL
  AND scope IS NOT NULL
  AND id IN (
    SELECT id FROM (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY tenant_id, code, scope
          ORDER BY created_at, id
        ) AS rn
      FROM public.categories
      WHERE code IS NOT NULL AND scope IS NOT NULL
    ) sub
    WHERE sub.rn > 1
  );

-- ──────────────────────────────────────────────────────────
-- 2. Unique constraint — partial (bỏ NULL) để cho phép category cũ chưa
--    set code/scope. Index đặt tên rõ để debug khi insert vi phạm.
-- ──────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_categories_tenant_code_scope_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_categories_tenant_code_scope_unique
      ON public.categories (tenant_id, code, scope)
      WHERE code IS NOT NULL AND scope IS NOT NULL;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────
-- 3. peek_next_group_code() — read-only version of next_group_code
--    Trả mã preview (`NVL-CPH-014`) NHƯNG không increment counter.
--    UI tạo SP gọi hàm này khi user chọn nhóm để show preview;
--    next_group_code() chỉ chạy khi user bấm Lưu.
--
--    Trường hợp sequence chưa tồn tại → trả `{prefix}-{group}-001`.
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

  -- Sequence chưa tồn tại → đây sẽ là SP đầu tiên của nhóm này.
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
