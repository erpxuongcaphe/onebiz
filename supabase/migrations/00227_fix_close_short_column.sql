-- ============================================================
-- 00227 — Sửa nút "Đóng đơn còn thiếu" chết vì sai tên cột
-- ============================================================
-- Hàm close_purchase_order_short (bản sống 00084) query
--   purchase_order_items WHERE order_id = ...
-- nhưng cột thật là purchase_order_id → mọi lần bấm đều văng 42703.
-- Đã xác minh trên prod: bảng chỉ có purchase_order_id, không có order_id.
-- Chưa gây thiệt hại (0 phiếu partial từng bấm được) — vá trước khi ai dùng.
--
-- File này = copy nguyên bản 00084, đổi ĐÚNG 1 chỗ tên cột. An toàn:
-- không đụng dữ liệu, chỉ thay định nghĩa hàm.
-- ============================================================

create or replace function public.close_purchase_order_short(
  p_order_id uuid,
  p_reason text,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order record;
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_caller_tenant uuid := public._current_caller_tenant();
  v_received_count int := 0;
  v_remaining_count int := 0;
begin
  if v_caller_tenant is null then
    raise exception 'UNAUTHORIZED: không xác định được tenant của người gọi.';
  end if;

  if p_reason is null or length(trim(p_reason)) < 5 then
    raise exception 'INVALID_REASON: Lý do đóng đơn tối thiểu 5 ký tự.';
  end if;

  select * into v_order from public.purchase_orders
  where id = p_order_id for update;

  if not found then
    raise exception 'PO_NOT_FOUND: %', p_order_id;
  end if;

  if v_order.tenant_id <> v_caller_tenant then
    raise exception 'TENANT_MISMATCH: bạn không có quyền đóng đơn này.';
  end if;

  if v_order.status not in ('partial', 'ordered') then
    raise exception 'INVALID_STATUS: PO đang ở trạng thái "%" — chỉ có thể đóng đơn partial hoặc ordered.', v_order.status;
  end if;

  select
    count(*) filter (where coalesce(received_quantity, 0) >= quantity),
    count(*) filter (where coalesce(received_quantity, 0) < quantity)
  into v_received_count, v_remaining_count
  from public.purchase_order_items where purchase_order_id = p_order_id;

  update public.purchase_orders
  set status = 'completed',
      closed_short = true,
      close_reason = trim(p_reason),
      closed_at = now(),
      closed_by = v_actor,
      updated_at = now()
  where id = p_order_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_order.tenant_id, v_actor, 'close_short', 'purchase_order', p_order_id,
    jsonb_build_object(
      'code', v_order.code,
      'previous_status', v_order.status,
      'reason', trim(p_reason),
      'items_received_fully', v_received_count,
      'items_remaining', v_remaining_count,
      'closed_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'code', v_order.code,
    'items_received_fully', v_received_count,
    'items_remaining', v_remaining_count
  );
end;
$$;
-- VERIFY: chạy sau khi áp — phải ra true
-- select pg_get_functiondef('public.close_purchase_order_short'::regproc)
--        like '%purchase_order_id = p_order_id%' as da_sua_cot;
