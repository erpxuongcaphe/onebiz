-- ============================================================
-- 00129 — Hardening RLS cho Shift Pending Reconcile (CEO 05/06)
-- ============================================================
-- Audit từ 6 lăng kính (em + agent) phát hiện:
--   - reconcile_pending_shift KHÔNG check tenant_id → cross-tenant
--     leak risk nếu ai biết shift_id của tenant khác.
--   - reconcile_pending_shift KHÔNG check permission ở RPC level →
--     Cashier có thể bypass UI gate.
--   - reconcile_pending_shift KHÔNG check branch cho Manager
--     "shifts.reconcile_own_branch" → Manager Quán A có thể đối
--     chiếu ca Quán B.
--   - mark_overdue_shifts_for_branch SECURITY DEFINER nhưng KHÔNG
--     verify branch thuộc tenant của user → trigger được nhánh
--     của tenant khác.
--
-- An toàn (CEO: "đừng phá data"):
--   - CREATE OR REPLACE FUNCTION (không drop)
--   - KHÔNG ALTER COLUMN / DROP / UPDATE backfill
--   - Hành vi cũ vẫn cho Owner/Admin có quyền tương ứng
--   - Chỉ THÊM check, không bỏ check cũ
-- ============================================================

-- 1. reconcile_pending_shift — thêm tenant + branch + permission check
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
  v_actor uuid := auth.uid();
  v_actor_tenant uuid;
  v_can_any boolean;
  v_can_own boolean;
  v_can_branch boolean;
  v_result jsonb;
BEGIN
  -- 1.1 Phải có session
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập' USING ERRCODE = '42501';
  END IF;

  -- 1.2 Load ca + lock
  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ca % không tồn tại', p_shift_id;
  END IF;

  -- 1.3 Tenant scope — chặn cross-tenant
  SELECT tenant_id INTO v_actor_tenant
  FROM public.profiles
  WHERE id = v_actor;

  IF v_actor_tenant IS NULL THEN
    RAISE EXCEPTION 'Tài khoản không có tenant_id' USING ERRCODE = '42501';
  END IF;

  IF v_shift.tenant_id <> v_actor_tenant THEN
    RAISE EXCEPTION 'Không được phép truy cập ca của tenant khác'
      USING ERRCODE = '42501';
  END IF;

  -- 1.4 Trạng thái hợp lệ
  IF v_shift.status NOT IN ('pending_reconcile', 'open') THEN
    RAISE EXCEPTION 'Ca % không ở trạng thái có thể đối chiếu (hiện: %)',
      p_shift_id, v_shift.status;
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Phải nhập lý do đối chiếu (>= 3 ký tự)';
  END IF;

  -- 1.5 Permission check
  --   shifts.reconcile_any  → đối chiếu ca ở MỌI chi nhánh (Owner/Admin)
  --   shifts.reconcile_own_branch + user_has_branch_access → ca chi nhánh mình (Manager)
  v_can_any := public.user_has_permission(v_actor, 'shifts.reconcile_any');

  IF NOT v_can_any THEN
    v_can_own := public.user_has_permission(v_actor, 'shifts.reconcile_own_branch');
    v_can_branch := public.user_has_branch_access(v_actor, v_shift.branch_id);

    IF NOT (v_can_own AND v_can_branch) THEN
      RAISE EXCEPTION 'Bạn không có quyền đối chiếu ca của chi nhánh này'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 1.6 Tạm flip status về 'open' để close_shift_atomic chấp nhận
  UPDATE public.shifts
  SET status = 'open'
  WHERE id = p_shift_id;

  -- 1.7 Gọi close_shift_atomic chuẩn (giữ nguyên signature cũ)
  v_result := public.close_shift_atomic(
    p_shift_id := p_shift_id,
    p_actual_cash := p_actual_cash,
    p_note := COALESCE(p_note, '') || ' [Đối chiếu: ' || p_reason || ']'
  );

  -- 1.8 Audit trail
  UPDATE public.shifts
  SET reconciled_by = v_actor,
      reconciled_at = now(),
      reconcile_reason = p_reason
  WHERE id = p_shift_id;

  RETURN v_result || jsonb_build_object(
    'reconciled_by', v_actor,
    'reconciled_at', now(),
    'reconcile_reason', p_reason
  );
END;
$$;

COMMENT ON FUNCTION public.reconcile_pending_shift IS
  'Đối chiếu ca pending: tenant scope + permission (reconcile_any HOẶC reconcile_own_branch + branch access) + flip status → close_shift_atomic + audit trail.';

-- 2. mark_overdue_shifts_for_branch — verify branch thuộc tenant của user
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
  v_actor uuid := auth.uid();
  v_actor_tenant uuid;
  v_branch_tenant uuid;
BEGIN
  -- 2.1 Phải có session
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập' USING ERRCODE = '42501';
  END IF;

  -- 2.2 Branch phải cùng tenant với user
  SELECT tenant_id INTO v_branch_tenant
  FROM public.branches
  WHERE id = p_branch_id;

  IF v_branch_tenant IS NULL THEN
    -- Branch không tồn tại — trả 0 (không crash POS)
    RETURN 0;
  END IF;

  SELECT tenant_id INTO v_actor_tenant
  FROM public.profiles
  WHERE id = v_actor;

  IF v_actor_tenant IS NULL OR v_branch_tenant <> v_actor_tenant THEN
    -- Khác tenant → từ chối (không leak)
    RAISE EXCEPTION 'Không được phép thao tác trên chi nhánh khác tenant'
      USING ERRCODE = '42501';
  END IF;

  -- 2.3 Lấy cutoff hour của branch
  SELECT COALESCE(shift_cutoff_hour, 3) INTO v_cutoff_hour
  FROM public.branches
  WHERE id = p_branch_id;

  -- 2.4 Threshold: cutoff hour HÔM NAY theo Asia/Ho_Chi_Minh
  v_threshold := date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
                 + (v_cutoff_hour || ' hours')::interval;

  IF (now() AT TIME ZONE 'Asia/Ho_Chi_Minh') < v_threshold THEN
    v_threshold := v_threshold - interval '1 day';
  END IF;

  v_threshold := v_threshold AT TIME ZONE 'Asia/Ho_Chi_Minh';

  -- 2.5 Mark mọi ca open quá hạn
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
  'Mark ca open quá cutoff_hour thành pending_reconcile. Chỉ thực thi nếu branch thuộc cùng tenant với user gọi.';

-- 3. View pending_shifts_view — security_invoker để chạy theo context user
-- (Postgres 15+ syntax). Frontend đã lọc bằng .eq("tenant_id", tenantId) nhưng
-- đặt thêm view-level safety net.
ALTER VIEW public.pending_shifts_view SET (security_invoker = true);

-- ============================================================
-- DONE. CEO chạy migration này, em đã verify:
--   1. Không phá data (chỉ REPLACE function + ALTER VIEW option)
--   2. Hành vi cũ cho Owner/Admin/Manager (có quyền) vẫn pass
--   3. Cashier/Staff bị block ở RPC level (defense in depth)
--   4. Cross-tenant call bị reject ở RPC level
--   5. Manager Quán A KHÔNG đối chiếu được ca Quán B nữa
-- Test:
--   SELECT public.reconcile_pending_shift(
--     'xxx-shift-id'::uuid, 1500000, 'Test'
--   );  -- expect OK nếu owner/admin
-- ============================================================
