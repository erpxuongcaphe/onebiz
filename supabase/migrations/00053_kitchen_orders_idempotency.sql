-- ============================================================
-- 00053: kitchen_orders.idempotency_key — chống duplicate khi offline retry
-- ============================================================
-- Bug audit (CEO 07/05): offline retry kitchen orders có thể duplicate khi:
--   1. Client offline tạo đơn → enqueue local (localId)
--   2. Online → replay → server commit OK
--   3. Network cắt giữa response → client tưởng fail
--   4. Retry → server tạo đơn LẦN 2 → bếp nhận trùng → chaos
--
-- Fix: server check `idempotency_key` (= localId từ client) trước khi insert.
-- Nếu đã tồn tại → return existing, không tạo mới. Pattern industry standard
-- (Stripe, Shopify, Twilio đều dùng).
--
-- Compatibility: column nullable + partial unique index — đơn online không
-- pass key vẫn insert OK (backward compat).
-- ============================================================

ALTER TABLE public.kitchen_orders
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Partial unique index — chỉ apply khi key NOT NULL.
-- Scope theo tenant_id để tránh collision giữa các tenant (nếu UUID v4 conflict
-- cực hiếm nhưng cũng tránh).
CREATE UNIQUE INDEX IF NOT EXISTS uq_kitchen_orders_idempotency
  ON public.kitchen_orders (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.kitchen_orders.idempotency_key IS
  'Client-generated unique key (localId từ offline checkout). Server dùng để dedup khi offline retry — tránh duplicate kitchen orders.';
