-- ============================================================
-- 00054: Kitchen Stations — multi-station phiếu bếp/bar (CEO 07/05)
-- ============================================================
-- Sprint KITCHEN-1: thay phiếu bếp 1-chung-cho-tất-cả bằng routing theo
-- "trạm chế biến" (Bar pha chế, Bếp nóng, Bếp lạnh, Quầy bánh...).
--
-- Pattern industry standard VN (KiotViet/Sapo/Misa):
--   - Mỗi quán có 1+ stations (mặc định 1 = "Bar pha chế")
--   - Gán category → station: items thuộc category nào sẽ in tại station đó
--   - Khi gửi bếp: split items theo station, in N phiếu (1/station)
--   - Mỗi station có thể có máy in riêng (printer_config_id), KDS filter
--
-- Backward compat: nếu tenant không bật multi-station (chỉ có 1 station
-- "Bar pha chế" mặc định + tất cả category gán vào đó) → behavior y hệt
-- single-queue cũ. Toggle qua tenants.settings.fnb.multi_station_enabled.
-- ============================================================

-- ── 1. Table: kitchen_stations ──
CREATE TABLE IF NOT EXISTS public.kitchen_stations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  color text DEFAULT '#2563eb', -- hex color cho badge KDS / phiếu in
  icon text DEFAULT 'restaurant', -- Material Symbol name
  -- JSONB cho extensibility: auto_print, printer_config_id (FK printer cụ thể),
  -- show_on_kds, header_text custom, font_size, etc.
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kitchen_stations_tenant_branch
  ON public.kitchen_stations (tenant_id, branch_id, is_active, sort_order);

COMMENT ON TABLE public.kitchen_stations IS
  'Trạm chế biến (Bar pha chế / Bếp nóng / Quầy bánh...). Mỗi station có thể gán categories + có máy in riêng + KDS riêng.';

-- ── 2. Add station_id vào categories ──
-- Categories có thể thuộc 1 station mặc định. Khi product trong category được
-- gửi bếp → tự routing theo station này. Product có thể override station riêng
-- (Sprint sau).
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS kitchen_station_id uuid
    REFERENCES public.kitchen_stations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_categories_kitchen_station
  ON public.categories (kitchen_station_id)
  WHERE kitchen_station_id IS NOT NULL;

COMMENT ON COLUMN public.categories.kitchen_station_id IS
  'Trạm chế biến mặc định cho category (Sprint KITCHEN-1). NULL = dùng station mặc định của branch.';

-- ── 3. Add station_id vào kitchen_order_items ──
-- Mỗi item trong kitchen_order có station_id riêng để split khi in phiếu +
-- filter trên KDS. Nullable cho backward compat.
ALTER TABLE public.kitchen_order_items
  ADD COLUMN IF NOT EXISTS kitchen_station_id uuid
    REFERENCES public.kitchen_stations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_kitchen_items_station
  ON public.kitchen_order_items (kitchen_station_id)
  WHERE kitchen_station_id IS NOT NULL;

COMMENT ON COLUMN public.kitchen_order_items.kitchen_station_id IS
  'Trạm chế biến cho item này (auto-fill từ category.kitchen_station_id khi insert). Nullable = single-queue legacy mode.';

-- ── 4. Seed default station "Bar pha chế" cho mỗi branch FnB hiện có ──
-- Idempotent: chỉ insert nếu branch chưa có station nào.
DO $$
DECLARE
  v_inserted int := 0;
BEGIN
  WITH new_stations AS (
    INSERT INTO public.kitchen_stations (
      tenant_id, branch_id, name, sort_order, color, icon, settings
    )
    SELECT
      b.tenant_id,
      b.id,
      'Bar pha chế',
      1,
      '#2563eb',  -- blue
      'local_cafe',
      '{"auto_print": true, "show_on_kds": true}'::jsonb
    FROM public.branches b
    WHERE b.is_active = true
      AND (b.branch_type = 'store' OR b.branch_type IS NULL) -- store hoặc legacy null
      AND NOT EXISTS (
        SELECT 1 FROM public.kitchen_stations ks
        WHERE ks.branch_id = b.id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM new_stations;

  RAISE NOTICE '[00054] Seeded % default stations "Bar pha chế"', v_inserted;
END $$;

-- ── 5. Backfill: gán tất cả categories FnB hiện có vào station "Bar pha chế"
--    của branch tương ứng (gần như chỉ chạy 1 lần) ──
-- Logic: với mỗi category, nếu chưa có kitchen_station_id, gán vào station
-- ĐẦU TIÊN của tenant (branch matter ít vì categories thường tenant-wide).
-- Lấy station đầu tiên theo sort_order.
DO $$
DECLARE
  v_updated int := 0;
BEGIN
  WITH first_station_per_tenant AS (
    SELECT DISTINCT ON (tenant_id)
      tenant_id, id AS station_id
    FROM public.kitchen_stations
    WHERE is_active = true
    ORDER BY tenant_id, sort_order ASC, created_at ASC
  ),
  updated AS (
    UPDATE public.categories c
    SET kitchen_station_id = fs.station_id
    FROM first_station_per_tenant fs
    WHERE c.tenant_id = fs.tenant_id
      AND c.kitchen_station_id IS NULL
      AND c.scope = 'sku'  -- chỉ SKU FnB, không phải NVL
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM updated;

  RAISE NOTICE '[00054] Backfilled % categories vào default station', v_updated;
END $$;

-- ── 6. RLS policies ──
ALTER TABLE public.kitchen_stations ENABLE ROW LEVEL SECURITY;

-- DEV mode (00010_dev_disable_rls.sql) đã DISABLE RLS toàn bộ — policy này
-- chỉ active khi enable lại sau.
DROP POLICY IF EXISTS kitchen_stations_tenant_isolation ON public.kitchen_stations;
CREATE POLICY kitchen_stations_tenant_isolation
  ON public.kitchen_stations
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );
