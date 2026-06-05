-- ============================================================
-- 00127 — Shift Pending Reconcile state
-- ============================================================
-- CEO 05/06/2026: cashier quên đóng ca → tự động chuyển sang
-- 'pending_reconcile' khi quá cutoff giờ (default 3h sáng). Manager
-- (quyền: owner/admin hoặc manager chi nhánh) đối chiếu sau bằng
-- cách nhập tiền mặt thực tế + lý do.
--
-- Thiết kế:
--   - KHÔNG dùng pg_cron (cần admin enable extension)
--   - Client-driven: POS mount → check + mark pending qua RPC
--   - RPC reconcile_pending_shift chốt số liệu via close_shift_atomic
--   - Audit trail: lưu auto_marked_pending_at, reconciled_by, reason
--
-- An toàn:
--   - Mở rộng enum (KHÔNG drop value cũ)
--   - ADD COLUMN nullable
--   - Ca cũ status='open'/'closed' giữ nguyên
--   - Không backfill data
-- ============================================================

-- 1. Mở rộng enum status: thêm 'pending_reconcile' ─────────────
-- Cách an toàn: dùng CHECK constraint thay vì TYPE enum
-- (vì có thể đã có CHECK với 2 value cũ)

DO $$
BEGIN
  -- Drop CHECK cũ nếu có (tên có thể khác nhau, em catch lỗi)
  BEGIN
    ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_status_check;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_status_check
  CHECK (status IN ('open', 'pending_reconcile', 'closed'));

-- 2. Cột tracking auto-pending + reconcile ────────────────────

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS auto_marked_pending_at timestamptz;

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS reconciled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS reconcile_reason text;

COMMENT ON COLUMN public.shifts.auto_marked_pending_at IS
  'Thời điểm system tự chuyển ca sang pending_reconcile (cashier quên đóng quá cutoff)';
COMMENT ON COLUMN public.shifts.reconciled_by IS
  'User (admin/manager) đã đối chiếu ca pending → chốt số liệu';
COMMENT ON COLUMN public.shifts.reconcile_reason IS
  'Lý do đóng muộn — bắt buộc khi reconcile pending shift';

-- Index cho query pending shifts theo branch
CREATE INDEX IF NOT EXISTS idx_shifts_pending_branch
  ON public.shifts(branch_id, status)
  WHERE status = 'pending_reconcile';

-- 3. Cột config cutoff theo chi nhánh ─────────────────────────

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS shift_cutoff_hour smallint NOT NULL DEFAULT 3
  CHECK (shift_cutoff_hour >= 0 AND shift_cutoff_hour <= 23);

COMMENT ON COLUMN public.branches.shift_cutoff_hour IS
  'Giờ chốt ca (0-23). Ca mở quá cutoff hôm nay → auto pending. Default 3h sáng.';

-- 4. RPC: mark mọi ca quá hạn của 1 branch ────────────────────
-- Gọi từ client khi POS mount. Trả về số ca vừa chuyển pending.

CREATE OR REPLACE FUNCTION public.mark_overdue_shifts_for_branch(
  p_branch_id uuid
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff_hour smallint;
  v_threshold timestamptz;
  v_count int;
BEGIN
  -- Lấy cutoff hour của branch
  SELECT COALESCE(shift_cutoff_hour, 3) INTO v_cutoff_hour
  FROM public.branches
  WHERE id = p_branch_id;

  IF v_cutoff_hour IS NULL THEN
    RETURN 0; -- branch không tồn tại
  END IF;

  -- Threshold: cutoff hour của HÔM NAY theo timezone server (Asia/Ho_Chi_Minh).
  -- Nếu giờ hiện tại < cutoff → so với cutoff HÔM QUA (vd 1h sáng < 3h sáng
  -- → ca mở trước cutoff hôm qua = ca từ 2 ngày trước → pending).
  v_threshold := date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
                 + (v_cutoff_hour || ' hours')::interval;

  -- Nếu giờ hiện tại đã qua cutoff hôm nay → ca mở trước cutoff hôm nay = pending
  -- Nếu chưa qua cutoff → so với cutoff hôm qua
  IF (now() AT TIME ZONE 'Asia/Ho_Chi_Minh') < v_threshold THEN
    v_threshold := v_threshold - interval '1 day';
  END IF;

  -- Convert threshold về timestamptz UTC để so với opened_at
  v_threshold := v_threshold AT TIME ZONE 'Asia/Ho_Chi_Minh';

  UPDATE public.shifts
  SET status = 'pending_reconcile',
      auto_marked_pending_at = now()
  WHERE branch_id = p_branch_id
    AND status = 'open'
    AND opened_at < v_threshold;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.mark_overdue_shifts_for_branch IS
  'Mark mọi ca open quá cutoff_hour của branch thành pending_reconcile. Gọi từ POS mount. Trả về số ca vừa mark.';

-- 5. RPC: reconcile pending shift → chốt qua close_shift_atomic ─

CREATE OR REPLACE FUNCTION public.reconcile_pending_shift(
  p_shift_id uuid,
  p_actual_cash numeric,
  p_reason text,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift record;
  v_result jsonb;
BEGIN
  -- Validate ca tồn tại + đang pending
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ca % không tồn tại', p_shift_id;
  END IF;

  IF v_shift.status NOT IN ('pending_reconcile', 'open') THEN
    RAISE EXCEPTION 'Ca % không ở trạng thái có thể đối chiếu (hiện: %)',
      p_shift_id, v_shift.status;
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Phải nhập lý do đối chiếu (>= 3 ký tự)';
  END IF;

  -- Đổi tạm status về 'open' để close_shift_atomic chấp nhận
  -- (RPC cũ chỉ accept status='open' for update)
  UPDATE public.shifts
  SET status = 'open'
  WHERE id = p_shift_id;

  -- Gọi close_shift_atomic chuẩn (đã có sẵn, không thay đổi)
  v_result := public.close_shift_atomic(
    p_shift_id := p_shift_id,
    p_actual_cash := p_actual_cash,
    p_note := COALESCE(p_note, '') || ' [Đối chiếu: ' || p_reason || ']'
  );

  -- Ghi audit trail
  UPDATE public.shifts
  SET reconciled_by = auth.uid(),
      reconciled_at = now(),
      reconcile_reason = p_reason
  WHERE id = p_shift_id;

  -- Add metadata vào kết quả
  RETURN v_result || jsonb_build_object(
    'reconciled_by', auth.uid(),
    'reconciled_at', now(),
    'reconcile_reason', p_reason
  );
END;
$$;

COMMENT ON FUNCTION public.reconcile_pending_shift IS
  'Đối chiếu ca pending: validate + flip status → open → close_shift_atomic + audit trail.';

-- 6. View: pending shifts cho admin/manager ──────────────────

CREATE OR REPLACE VIEW public.pending_shifts_view AS
SELECT
  s.id,
  s.tenant_id,
  s.branch_id,
  b.name AS branch_name,
  s.cashier_id,
  p.full_name AS cashier_name,
  s.opened_at,
  s.auto_marked_pending_at,
  s.starting_cash,
  EXTRACT(EPOCH FROM (s.auto_marked_pending_at - s.opened_at))/3600 AS shift_duration_hours
FROM public.shifts s
LEFT JOIN public.branches b ON b.id = s.branch_id
LEFT JOIN public.profiles p ON p.id = s.cashier_id
WHERE s.status = 'pending_reconcile';

COMMENT ON VIEW public.pending_shifts_view IS
  'Danh sách ca đang chờ đối chiếu — manager/admin tham khảo.';

-- ============================================================
-- DONE. KHÔNG cần seed data, KHÔNG cần backfill.
-- Test:
--   1. SELECT mark_overdue_shifts_for_branch('xxx-branch-id');
--      → Trả về số ca vừa pending
--   2. SELECT * FROM pending_shifts_view WHERE branch_id = 'xxx';
--   3. SELECT reconcile_pending_shift('xxx-shift-id', 1500000, 'Trang về sớm');
-- ============================================================
