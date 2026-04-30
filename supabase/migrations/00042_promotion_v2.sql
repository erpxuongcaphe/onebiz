-- ============================================================
-- 00042_promotion_v2.sql
--
-- Sprint KM-1 — Promotion v2: bổ sung field cho engine + table settings
--
-- Plan KM CEO chốt 30/04/2026 (4 sprint, tổng ~8 ngày):
--   KM-1 (sprint này): Schema enhancement + Settings persist
--   KM-2: Promotion Engine + POS wire
--   KM-3: BOGO + Gift + Time-based filter
--   KM-4: Báo cáo hiệu quả KM
--
-- Sprint này bổ sung 7 field mới vào public.promotions:
--   - channel:        retail / fnb / both — giống price_tiers.scope (00041)
--   - branch_ids:     array[] giới hạn KM theo chi nhánh; rỗng = áp toàn chuỗi
--   - usage_limit:    null = unlimited; số int = giới hạn tổng lượt dùng
--   - usage_count:    đã dùng bao nhiêu (tăng atomic ở engine — KM-2)
--   - time_start:     giờ vàng start (vd 14:00) — null = áp cả ngày
--   - time_end:       giờ vàng end (vd 17:00)   — null = áp cả ngày
--   - days_of_week:   array[0..6] (0=CN, 1=T2, ..., 6=T7); rỗng = áp mọi ngày
--
-- Và 1 table mới `promotion_settings` (1 row / tenant) để lưu cài đặt chung
-- thay vì local state hiện tại (UI fake settings page chưa persist).
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. promotions: bổ sung field
-- ──────────────────────────────────────────────────────────

-- channel — phân loại theo POS Retail / FnB
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'both';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'promotions_channel_check'
  ) THEN
    ALTER TABLE public.promotions
      ADD CONSTRAINT promotions_channel_check
      CHECK (channel IN ('retail', 'fnb', 'both'));
  END IF;
END $$;

COMMENT ON COLUMN public.promotions.channel IS
  'Channel áp dụng: retail (POS Retail), fnb (POS FnB), both (cả 2). Default both để KM cũ vẫn áp dụng tất cả nơi.';

-- branch_ids — giới hạn theo chi nhánh
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS branch_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.promotions.branch_ids IS
  'Mảng branch_id giới hạn KM. Rỗng = áp toàn chuỗi. VD ["b1","b2"] = chỉ áp 2 quán này. Engine filter ở KM-2.';

-- usage_limit + usage_count
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS usage_limit INTEGER;

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'promotions_usage_count_nonneg'
  ) THEN
    ALTER TABLE public.promotions
      ADD CONSTRAINT promotions_usage_count_nonneg
      CHECK (usage_count >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'promotions_usage_limit_nonneg'
  ) THEN
    ALTER TABLE public.promotions
      ADD CONSTRAINT promotions_usage_limit_nonneg
      CHECK (usage_limit IS NULL OR usage_limit >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.promotions.usage_limit IS
  'Giới hạn tổng số lượt dùng. NULL = không giới hạn. VD 100 = chỉ 100 đơn đầu được áp.';
COMMENT ON COLUMN public.promotions.usage_count IS
  'Số lượt đã dùng. Engine atomic increment khi check out (KM-2). Khi >= usage_limit → KM dừng áp.';

-- time-of-day window
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS time_start TIME;

ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS time_end TIME;

COMMENT ON COLUMN public.promotions.time_start IS
  'Giờ vàng bắt đầu (LOCAL VN). NULL + time_end NULL = áp cả ngày. VD 14:00 + 17:00 = trà chiều.';
COMMENT ON COLUMN public.promotions.time_end IS
  'Giờ vàng kết thúc (LOCAL VN). Cả 2 phải null hoặc cả 2 phải có giá trị (engine validate).';

-- days_of_week — limit theo thứ trong tuần
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS days_of_week INTEGER[] NOT NULL DEFAULT '{}'::integer[];

COMMENT ON COLUMN public.promotions.days_of_week IS
  'Mảng [0..6] (0=CN, 1=T2, ..., 6=T7). Rỗng = áp mọi ngày. VD [0,6] = chỉ T7+CN.';

-- Index để engine query nhanh: tenant + active + đang trong window
CREATE INDEX IF NOT EXISTS idx_promotions_engine_lookup
  ON public.promotions (tenant_id, is_active, channel, start_date, end_date)
  WHERE is_active = true;

-- ──────────────────────────────────────────────────────────
-- 2. promotion_settings — 1 row / tenant
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promotion_settings (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Engine tự chọn KM giảm nhiều nhất khi cart match nhiều KM
  auto_apply_best BOOLEAN NOT NULL DEFAULT TRUE,
  -- Cho phép cộng dồn nhiều KM trong 1 đơn (vd KM% + voucher cố định)
  allow_multiple BOOLEAN NOT NULL DEFAULT FALSE,
  -- In thông tin KM trên hoá đơn
  show_on_invoice BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.promotion_settings IS
  'Cài đặt khuyến mãi cấp tenant — 1 row / tenant. Trước đây UI cài đặt chỉ là local state, giờ persist DB.';

-- updated_at trigger (dùng function có sẵn từ 00005)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'set_updated_at'
      AND event_object_table = 'promotion_settings'
  ) THEN
    CREATE TRIGGER set_updated_at
      BEFORE UPDATE ON public.promotion_settings
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

-- RLS — tenant isolation
ALTER TABLE public.promotion_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'promotion_settings' AND policyname = 'promotion_settings_select'
  ) THEN
    CREATE POLICY "promotion_settings_select" ON public.promotion_settings
      FOR SELECT USING (tenant_id = public.get_user_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'promotion_settings' AND policyname = 'promotion_settings_insert'
  ) THEN
    CREATE POLICY "promotion_settings_insert" ON public.promotion_settings
      FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'promotion_settings' AND policyname = 'promotion_settings_update'
  ) THEN
    CREATE POLICY "promotion_settings_update" ON public.promotion_settings
      FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────
-- 3. RPC: increment_promotion_usage (atomic, dùng ở KM-2 checkout)
-- ──────────────────────────────────────────────────────────
-- Atomic increment để 2 cashier checkout cùng lúc không double-count.
-- Trả về usage_count mới sau khi tăng. Nếu vượt usage_limit → raise exception.
CREATE OR REPLACE FUNCTION public.increment_promotion_usage(p_promotion_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_count INTEGER;
  v_limit INTEGER;
BEGIN
  -- Atomic update: chỉ tăng nếu chưa vượt limit
  UPDATE public.promotions
  SET usage_count = usage_count + 1
  WHERE id = p_promotion_id
    AND tenant_id = public.get_user_tenant_id()
    AND (usage_limit IS NULL OR usage_count < usage_limit)
  RETURNING usage_count, usage_limit INTO v_new_count, v_limit;

  IF v_new_count IS NULL THEN
    -- Không match → không tồn tại HOẶC đã hết lượt
    SELECT usage_limit INTO v_limit FROM public.promotions
      WHERE id = p_promotion_id AND tenant_id = public.get_user_tenant_id();
    IF v_limit IS NULL THEN
      RAISE EXCEPTION 'Khuyến mãi không tồn tại hoặc không thuộc tenant';
    ELSE
      RAISE EXCEPTION 'Khuyến mãi đã hết lượt sử dụng (giới hạn: %)', v_limit;
    END IF;
  END IF;

  RETURN v_new_count;
END;
$$;

COMMENT ON FUNCTION public.increment_promotion_usage IS
  'Atomic increment usage_count. Raise exception nếu vượt usage_limit. Dùng ở KM-2 sau khi POS checkout xong.';
