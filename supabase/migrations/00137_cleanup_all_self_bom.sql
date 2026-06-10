-- ============================================================
-- Migration 00137: DỌN TẤT CẢ self-BOM (Sting + Bò húc + bất kỳ SP nào)
-- ============================================================
--
-- CEO 10/06/2026 — thay thế migration 00136 (chỉ Sting). General hơn:
-- tự tìm + gỡ + sửa data cho MỌI SP dính self-BOM, không hardcode SP.
--
-- self-BOM = BOM tự-tham-chiếu: SKU bán = NVL tiêu hao (cùng product_id).
-- CEO dùng để bán theo thùng (1 thùng = 24 chai/lon) nhưng SAI CÔNG CỤ:
-- mỗi lần bán SKU tự trừ chính nó ×N (vd HD001218: 24 chai × 24 = 576).
--
-- CEO đã gỡ Sting (has_bom=false). Bò húc có thể chưa. Migration này
-- xử lý TẤT CẢ tự động + an toàn (chỉ đụng phiếu THẬT SỰ bị nhân).
--
-- BƯỚC:
--   1. Liệt kê SP dính → in NOTICE (transparency)
--   2. Sửa phiếu RÁC bom_consume self-referential về đúng SỐ BÁN THẬT
--      (lấy từ invoice_items.quantity). Note giữ lý do, không xóa cứng.
--   3. Gỡ self-BOM: set has_bom=false + bom_code=null cho SP còn dính
--   4. Recompute branch_stock từ sổ cái cho SP affected
--   5. Recompute products.stock = SUM(branch_stock) cho SP affected
--   6. In NOTICE kết quả
--
-- AN TOÀN:
--   - Chỉ đụng phiếu reference_type='bom_consume' MÀ product = product
--     bán trong cùng hóa đơn (đặc trưng self-BOM). Không đụng phiếu BOM
--     bình thường (NVL khác SKU).
--   - Chỉ recompute SP affected, không blanket.
--   - Giữ lịch sử (UPDATE, không DELETE).
--   - Guard ở 00135 đã chặn future self-BOM consume.
-- ============================================================

-- ─── 1. Liệt kê SP dính (transparency) ─────────────────────
DO $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  RAISE NOTICE '=== SP dính self-BOM (chuẩn bị dọn) ===';
  FOR r IN
    SELECT DISTINCT p.code, p.name, p.has_bom, p.bom_code,
           COUNT(DISTINCT sm.id) OVER (PARTITION BY sm.product_id) AS so_phieu_rac
      FROM public.stock_movements sm
      JOIN public.invoices i      ON i.id = sm.reference_id
      JOIN public.invoice_items ii ON ii.invoice_id = i.id
                                  AND ii.product_id = sm.product_id
      JOIN public.products p      ON p.id = sm.product_id
     WHERE sm.reference_type = 'bom_consume'
       AND sm.quantity > ii.quantity  -- bị nhân: phiếu trừ > số bán thật
  LOOP
    v_count := v_count + 1;
    RAISE NOTICE '  • % (%) — has_bom=%, bom_code=%, % phiếu rác',
      r.code, r.name, r.has_bom, COALESCE(r.bom_code, '(null)'), r.so_phieu_rac;
  END LOOP;
  RAISE NOTICE 'Tổng: % SP dính self-BOM', v_count;
END $$;

-- ─── 2. Sửa phiếu rác → đúng số bán thật ──────────────────
WITH self_bom_phieu AS (
  SELECT sm.id          AS sm_id,
         ii.quantity    AS so_ban_that,
         sm.quantity    AS so_tru_sai,
         i.code         AS hd_code,
         p.code         AS sp_code
    FROM public.stock_movements sm
    JOIN public.invoices i      ON i.id = sm.reference_id
    JOIN public.invoice_items ii ON ii.invoice_id = i.id
                                AND ii.product_id = sm.product_id
    JOIN public.products p      ON p.id = sm.product_id
   WHERE sm.reference_type = 'bom_consume'
     AND sm.quantity > ii.quantity
)
UPDATE public.stock_movements sm
SET quantity = sbp.so_ban_that,
    note = format(
      'Bán %s %s (HĐ %s). [SỬA 10/06/2026 — migration 00137: phiếu gốc %s '
      'do BOM tự-tham-chiếu sai — chỉnh về %s = số bán thật]',
      sbp.so_ban_that, sbp.sp_code, sbp.hd_code, sbp.so_tru_sai, sbp.so_ban_that
    )
FROM self_bom_phieu sbp
WHERE sm.id = sbp.sm_id;

-- ─── 3. Gỡ self-BOM khỏi SP còn dính ──────────────────────
-- SP có bom_code trỏ tới BOM mà bom_items.material_id = chính SP đó.
WITH self_bom_sp AS (
  SELECT DISTINCT p.id
    FROM public.products p
    JOIN public.bom b           ON b.code = p.bom_code AND b.tenant_id = p.tenant_id
    JOIN public.bom_items bi    ON bi.bom_id = b.id
   WHERE bi.material_id = p.id
     AND p.has_bom = true
)
UPDATE public.products p
SET has_bom = false,
    bom_code = NULL,
    updated_at = now()
FROM self_bom_sp sbs
WHERE p.id = sbs.id;

-- ─── 4. Recompute branch_stock cho SP affected ────────────
WITH affected_sp AS (
  SELECT DISTINCT sm.product_id
    FROM public.stock_movements sm
   WHERE sm.note LIKE '%[SỬA 10/06/2026 — migration 00137%'
)
UPDATE public.branch_stock bs
SET quantity = (
      SELECT COALESCE(SUM(CASE WHEN sm.type='in'  THEN sm.quantity
                               WHEN sm.type='out' THEN -sm.quantity
                               ELSE 0 END), 0)
        FROM public.stock_movements sm
       WHERE sm.product_id = bs.product_id
         AND sm.branch_id  = bs.branch_id
    ),
    updated_at = now()
WHERE bs.product_id IN (SELECT product_id FROM affected_sp);

-- ─── 5. Recompute products.stock = SUM(branch_stock) ──────
WITH affected_sp AS (
  SELECT DISTINCT sm.product_id
    FROM public.stock_movements sm
   WHERE sm.note LIKE '%[SỬA 10/06/2026 — migration 00137%'
)
UPDATE public.products p
SET stock = (
      SELECT COALESCE(SUM(quantity), 0)
        FROM public.branch_stock bs
       WHERE bs.product_id = p.id
    )
WHERE p.id IN (SELECT product_id FROM affected_sp);

-- ─── 6. Kết quả: in NOTICE từng SP đã dọn ─────────────────
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '=== KẾT QUẢ sau dọn ===';
  FOR r IN
    SELECT p.code, p.name, p.has_bom, p.bom_code, p.stock AS products_stock,
           (SELECT COALESCE(SUM(quantity),0) FROM public.branch_stock bs
             WHERE bs.product_id = p.id) AS branch_stock_total,
           (SELECT COALESCE(SUM(CASE WHEN type='in' THEN quantity ELSE -quantity END),0)
              FROM public.stock_movements sm WHERE sm.product_id = p.id) AS so_cai
      FROM public.products p
     WHERE p.id IN (
       SELECT DISTINCT sm.product_id
         FROM public.stock_movements sm
        WHERE sm.note LIKE '%[SỬA 10/06/2026 — migration 00137%'
     )
     ORDER BY p.code
  LOOP
    RAISE NOTICE '  • % (%) — products.stock=%, branch_stock=%, sổ cái=% — has_bom=%',
      r.code, r.name, r.products_stock, r.branch_stock_total, r.so_cai, r.has_bom;
  END LOOP;
  RAISE NOTICE 'Mong đợi: 3 cột tồn KHỚP nhau cho mỗi SP, has_bom=false';
END $$;
