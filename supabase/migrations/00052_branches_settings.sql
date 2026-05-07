-- ============================================================
-- 00052: branches.settings JSONB — per-branch layout preferences
-- ============================================================
-- CEO 06/05 (mockup v3 sprint E): "bố cục theo ý" — mỗi chi nhánh có layout
-- riêng (số sảnh, thứ tự sảnh hiển thị, kích thước canvas...).
--
-- Tenants table đã có settings jsonb cho global preferences (currency,
-- theme...). Branches cần JSONB tương tự cho per-branch overrides.
--
-- Schema dự kiến trong settings:
--   {
--     "pos_zone_order": ["Sảnh 1", "Sảnh 2", "Sân vườn"],
--     "pos_layout_mode": "manual",   -- auto | manual
--     "pos_canvas_width": 1024,
--     "pos_canvas_height": 720,
--     "pos_cart_position": "right"   -- right | bottom (Sprint sau)
--   }
--
-- Default {} — POS fallback về thứ tự alpha của zone names + auto layout.
-- ============================================================

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Comment giải thích cho dev:
COMMENT ON COLUMN public.branches.settings IS
  'Per-branch layout/UI preferences. Keys: pos_zone_order (string[]), pos_layout_mode (auto|manual), pos_canvas_width, pos_canvas_height, pos_cart_position. Mặc định {} → POS fallback default.';
