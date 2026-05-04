-- ============================================================
-- Migration 00048: Invoice client_session_id + auto_saved
-- ============================================================
--
-- Sprint POS-RECOVERY-1 (CEO 04/05/2026): auto-save & recovery cho POS
-- Retail. Thay vì để cashier mất data khi cúp điện / sập wifi / hư máy,
-- form state tự lưu liên tục qua saveDraftOrder background. Mở lại web →
-- recovery dialog list các đơn dở để cashier chọn tiếp tục.
--
-- 1. `client_session_id` UUID — idempotency key chống duplicate invoice.
--    Khi cashier ấn Thanh toán 2 lần (network slow + retry), 2 RPC
--    posCheckout cùng session_id → server reject lần 2 qua UNIQUE
--    constraint, return existing invoice → KHÔNG TRÙNG (KiotViet bug).
--
-- 2. `auto_saved` BOOLEAN — phân biệt 2 loại nháp:
--    - F9 manual (auto_saved=FALSE): cashier chủ động lưu vì nghiệp vụ
--      (kho hết hàng, chờ duyệt) → giữ vĩnh viễn cho tới khi xử lý
--    - Auto background (auto_saved=TRUE): backup phòng cúp điện → cleanup
--      sau 30 ngày qua function `cleanup_expired_auto_drafts`
--
-- 3. Trigger `handle_updated_at` cho invoices — saveDraftOrder upsert
--    phải refresh updated_at để TTL cleanup tính đúng (auto-save mỗi
--    1.5s → updated_at luôn fresh khi cashier còn edit).
--
-- 4. Index hỗ trợ recovery dialog: list drafts theo (tenant, branch)
--    sorted by updated_at desc.
-- ============================================================

-- ============================================================
-- 1. Schema additions
-- ============================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS client_session_id uuid;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS auto_saved boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.invoices.client_session_id IS
  'UUID generated client-side per form session. Idempotency key chống duplicate invoice từ retry/recover. NULL cho invoice cũ (pre-migration).';

COMMENT ON COLUMN public.invoices.auto_saved IS
  'TRUE = nháp do auto-save background (TTL 30 ngày). FALSE = invoice thật hoặc nháp F9 manual (giữ vĩnh viễn).';

-- ============================================================
-- 2. UNIQUE partial index trên client_session_id
-- ============================================================

-- Chỉ unique khi NOT NULL (NULL = invoice cũ pre-migration, không track).
-- Scope (tenant_id, client_session_id) — mỗi tenant một session_id duy nhất.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_client_session_id_unique
  ON public.invoices (tenant_id, client_session_id)
  WHERE client_session_id IS NOT NULL;

-- ============================================================
-- 3. Index hỗ trợ recovery dialog
-- ============================================================

-- List drafts theo (tenant, branch, status='draft') sorted updated_at desc.
-- Partial index → chỉ index draft, không bloat với invoices completed.
CREATE INDEX IF NOT EXISTS idx_invoices_drafts_recent
  ON public.invoices (tenant_id, branch_id, updated_at DESC)
  WHERE status = 'draft';

-- ============================================================
-- 4. Trigger updated_at cho invoices
-- ============================================================

-- Hàm handle_updated_at đã tồn tại từ 00003 — chỉ cần attach trigger.
-- Trước đây invoices không có trigger này → updated_at chỉ set lúc INSERT,
-- không refresh khi UPDATE. Auto-save mỗi 1.5s cần updated_at fresh để
-- TTL cleanup tính đúng.

DROP TRIGGER IF EXISTS set_updated_at ON public.invoices;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- 5. Cleanup function — auto-saved drafts > 30 ngày
-- ============================================================

-- Gọi từ client (background sync khi POS mở) hoặc cron job server-side.
-- Chỉ xoá auto_saved=TRUE — F9 manual giữ vĩnh viễn theo CEO.
-- SECURITY DEFINER để bypass RLS (cleanup là system task).
CREATE OR REPLACE FUNCTION public.cleanup_expired_auto_drafts(
  p_tenant_id uuid,
  p_days integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Xoá invoice_items trước (FK CASCADE đã handle nhưng explicit cho rõ)
  WITH expired_drafts AS (
    SELECT id FROM public.invoices
    WHERE tenant_id = p_tenant_id
      AND status = 'draft'
      AND auto_saved = true
      AND updated_at < NOW() - (p_days || ' days')::INTERVAL
  )
  DELETE FROM public.invoices
  WHERE id IN (SELECT id FROM expired_drafts);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_auto_drafts(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.cleanup_expired_auto_drafts IS
  'Xoá auto-saved drafts (auto_saved=TRUE) quá p_days ngày. Default 30. F9 manual không bị xoá. Gọi background khi POS Retail mở.';

-- ============================================================
-- 6. RPC: posCheckout với idempotency check
-- ============================================================

-- Wrapper trên posCheckout client-side: check trùng session_id trước khi
-- INSERT. Nếu trùng → return existing (200 OK, không error). Nếu chưa →
-- delegate về client để INSERT bình thường.
--
-- Note: RPC này chỉ TRA cứu, không INSERT. Lý do: posCheckout flow client
-- vẫn cần multi-step (invoice + items + stock + cash) — gói full flow
-- thành RPC sẽ phá pattern hiện tại. Em làm idempotency 2 lớp:
-- 1. Client check qua RPC này TRƯỚC khi gọi posCheckout
-- 2. DB UNIQUE INDEX là safety net cuối — nếu race condition xảy ra,
--    INSERT lần 2 fail với error code 23505, client catch + retry SELECT.
CREATE OR REPLACE FUNCTION public.find_invoice_by_session_id(
  p_tenant_id uuid,
  p_client_session_id uuid
)
RETURNS TABLE (
  id uuid,
  code text,
  status text,
  total numeric,
  paid numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, code, status, total, paid
  FROM public.invoices
  WHERE tenant_id = p_tenant_id
    AND client_session_id = p_client_session_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.find_invoice_by_session_id(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.find_invoice_by_session_id IS
  'Tra cứu invoice theo client_session_id để chống duplicate. Trả null nếu chưa tồn tại → client tự INSERT. Trả row nếu đã có → client dùng existing.';

-- ============================================================
-- 7. Verification queries (manual run sau apply migration)
-- ============================================================

-- Check column tồn tại:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'invoices' AND column_name IN ('client_session_id', 'auto_saved');
--
-- Check index:
--   SELECT indexname FROM pg_indexes WHERE tablename = 'invoices';
--
-- Test cleanup function (dry run trên tenant test):
--   SELECT public.cleanup_expired_auto_drafts(
--     'TENANT_UUID'::uuid,
--     30
--   );
