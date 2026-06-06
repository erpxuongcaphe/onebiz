-- ============================================================
-- Migration 00132: Customer Saved Views (Saved Filter Tabs)
--
-- CEO 06/06/2026: research xác nhận "Saved Views" là gap lớn nhất của
-- ERP Việt. Có ở Sapo, MISA, HubSpot, Square, Odoo (5/8 hệ thống).
--
-- Use case: anh lưu bộ filter "VIP còn nợ" → next time mở 1 click thay
-- vì set lại 4-5 filter.
--
-- AN TOÀN:
--   - Bảng mới, không động bảng cũ
--   - RLS isolate per user (mỗi user thấy view của mình)
--   - Owner cũng có thể share view qua flag is_shared (Phase 2)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.customer_saved_views (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  icon text,
  is_shared boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id, name)
);

COMMENT ON TABLE public.customer_saved_views IS
  'Bộ filter đã lưu cho /khach-hang — pattern Sapo/HubSpot/Square. JSONB filters lưu state {debt: "has_debt", salesRange: "tier_vip", ...}';

CREATE INDEX IF NOT EXISTS idx_csv_user
  ON public.customer_saved_views(tenant_id, user_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_csv_shared
  ON public.customer_saved_views(tenant_id)
  WHERE is_shared = true;

-- RLS
ALTER TABLE public.customer_saved_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "csv_select_own_or_shared" ON public.customer_saved_views;
CREATE POLICY "csv_select_own_or_shared"
  ON public.customer_saved_views
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (is_shared = true AND tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "csv_insert_own" ON public.customer_saved_views;
CREATE POLICY "csv_insert_own"
  ON public.customer_saved_views
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id IN (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "csv_update_own" ON public.customer_saved_views;
CREATE POLICY "csv_update_own"
  ON public.customer_saved_views
  FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "csv_delete_own" ON public.customer_saved_views;
CREATE POLICY "csv_delete_own"
  ON public.customer_saved_views
  FOR DELETE
  USING (user_id = auth.uid());

-- updated_at auto
CREATE OR REPLACE FUNCTION public.trg_csv_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_csv_updated_at ON public.customer_saved_views;
CREATE TRIGGER trg_csv_updated_at
BEFORE UPDATE ON public.customer_saved_views
FOR EACH ROW EXECUTE FUNCTION public.trg_csv_updated_at();
