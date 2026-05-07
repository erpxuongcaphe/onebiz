-- ============================================================
-- 00051: products.sort_order — manual reorder cho menu FnB
-- ============================================================
-- CEO 06/05 (mockup v3 sprint D): "sắp xếp thực đơn theo ý"
--
-- Thêm column `sort_order` vào products để admin có thể đổi thứ tự SP
-- hiển thị trong POS FnB grid + POS Retail. Trước đây POS sort theo `name`
-- mặc định → quán muốn "Cà phê đen" đứng đầu vì best-seller phải đổi tên
-- thành "01. Cà phê đen" (hack ugly).
--
-- Backfill: ROW_NUMBER() partition by category để các SP cùng nhóm có
-- sort_order liên tiếp 0, 1, 2, ... ban đầu theo thứ tự alpha của name.
-- Service `moveProductSortOrder` swap với neighbor trong cùng category.
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- Backfill — chỉ run nếu cột mới (DEFAULT 0 nên existing data có thể đều 0).
-- Dùng row_number partition theo (tenant_id, category_id, product_type, channel)
-- để swap neighbor logic stable trong cùng scope.
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.products
  WHERE sort_order > 0;

  IF v_count = 0 THEN
    -- Chưa từng backfill — set theo row_number alpha trong cùng nhóm
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY tenant_id, category_id, product_type, channel
          ORDER BY name ASC, code ASC
        ) - 1 AS rn
      FROM public.products
    )
    UPDATE public.products p
    SET sort_order = r.rn
    FROM ranked r
    WHERE p.id = r.id;

    RAISE NOTICE '[00051] Backfilled sort_order cho % SP', v_count;
  ELSE
    RAISE NOTICE '[00051] Skip backfill — đã có sort_order > 0';
  END IF;
END $$;

-- Index cho query order theo sort_order trong cùng category — perf
-- POS FnB load 200 SP/category sẽ dùng index này.
CREATE INDEX IF NOT EXISTS idx_products_category_sort
  ON public.products (tenant_id, category_id, sort_order)
  WHERE is_active = true;

-- ============================================================
-- Note types.ts: cần regenerate qua `supabase gen types typescript`
-- để TS biết products.sort_order. Trong service layer hiện cast `any`
-- để tránh compile error trước khi migration apply.
-- ============================================================
