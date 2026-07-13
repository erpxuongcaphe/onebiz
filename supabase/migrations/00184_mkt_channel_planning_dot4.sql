-- ============================================================
-- 00184: Bottom-Up Channel Planning — Đợt 4 (Điều chỉnh việc đã chạy)
--
-- Khi kế hoạch đã sinh việc và có việc đã nhận/đang chạy, Change Request "êm"
-- (00183) bị chặn. Đợt 4 cho Leader điều chỉnh TỪNG việc theo quyết định:
--   keep      — giữ nguyên
--   cancel    — huỷ việc (không huỷ việc đã Done)
--   reassign  — đổi người (việc quay về Chờ nhận việc cho người mới)
-- ("Thay thế" = huỷ + tạo việc tay bằng chức năng tạo task thủ công sẵn có.)
-- Áp dụng cho task sinh từ plan (channel_plan_id không null). Ghi audit từng thao tác.
-- ============================================================

create or replace function public.mkt_reconcile_plan_task(
  p_task_id uuid,
  p_decision text,
  p_new_assignee_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_task record;
  v_dep_status text;
  v_next_status text;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if not public.user_has_permission(v_actor, 'mkt.manage_campaigns') then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if p_decision not in ('keep', 'cancel', 'reassign') then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  select * into v_task from public.mkt_tasks where id = p_task_id and deleted_at is null for update;
  if not found or v_task.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v_task.channel_plan_id is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  if p_decision = 'keep' then
    null; -- giữ nguyên

  elsif p_decision = 'cancel' then
    if v_task.task_status = 'done' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
    update public.mkt_tasks set task_status = 'canceled', deleted_at = now(), updated_by = v_actor where id = p_task_id;

  elsif p_decision = 'reassign' then
    if p_new_assignee_id is null then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
    if v_task.task_status = 'done' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.profiles p where p.id = p_new_assignee_id and p.tenant_id = v_task.tenant_id and coalesce(p.is_active, true)) then
      raise exception 'INVALID_STATE' using errcode = 'P0001';
    end if;
    -- Xác định trạng thái: còn phụ thuộc chưa xong → blocked, else todo
    v_next_status := 'todo';
    if v_task.dependency_task_id is not null then
      select task_status into v_dep_status from public.mkt_tasks where id = v_task.dependency_task_id and tenant_id = v_task.tenant_id;
      if v_dep_status is distinct from 'done' then v_next_status := 'blocked'; end if;
    end if;
    update public.mkt_tasks set
      assignee_id = p_new_assignee_id, acceptance_status = 'pending', task_status = v_next_status,
      blocked_reason = case when v_next_status = 'blocked' then 'DEPENDENCY_BLOCKED' else null end,
      started_at = null, reject_reason = null, discussion_reason = null, requires_leader_action = false, updated_by = v_actor
    where id = p_task_id;
    perform public.mkt_enqueue_notification(
      v_task.tenant_id, p_new_assignee_id, 'mkt_task_assigned', 'Task MKT mới (được giao lại)', v_task.title,
      'mkt_task', p_task_id, '/mkt/tasks?task=' || p_task_id::text, '{}'::jsonb,
      'mkt_task_reassigned:' || p_task_id::text || ':' || p_new_assignee_id::text
    );
  end if;

  perform public.mkt_record_audit(v_task.tenant_id, v_actor, 'mkt_plan_task_' || p_decision, 'mkt_task', p_task_id, to_jsonb(v_task), jsonb_build_object('decision', p_decision, 'new_assignee_id', p_new_assignee_id));
  return jsonb_build_object('success', true, 'decision', p_decision);
end;
$$;
revoke all on function public.mkt_reconcile_plan_task(uuid, text, uuid) from public, anon;
grant execute on function public.mkt_reconcile_plan_task(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
