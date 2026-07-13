-- ============================================================
-- 00183: Bottom-Up Channel Planning — Đợt 3 (Đổi kế hoạch cơ bản)
--
-- mkt_open_plan_change_request: mở lại kế hoạch đã duyệt để chỉnh sửa —
--   CHỈ khi MỌI task sinh ra còn 'pending' (chưa ai nhận, chưa chạy).
--   Huỷ mềm các task pending → supersede version → plan về 'planning' →
--   Owner sửa lại → nộp → duyệt → sinh lại task.
--   Nếu có task đã nhận/đang chạy → PLAN_TASKS_IN_PROGRESS (để Đợt 4 xử lý
--   reconcile giữ/huỷ/đổi người/thay thế từng task).
-- ============================================================

create or replace function public.mkt_open_plan_change_request(p_plan_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_plan record;
  v_blocking integer;
  v_canceled integer;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'MISSING_REASON' using errcode = 'P0001'; end if;

  select * into v_plan from public.mkt_channel_plans where id = p_plan_id and deleted_at is null for update;
  if not found or v_plan.tenant_id <> public.get_user_tenant_id() then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (v_plan.owner_id = v_actor or public.user_has_permission(v_actor, 'mkt.manage_campaigns')) then raise exception 'INSUFFICIENT_ROLE' using errcode = 'P0001'; end if;
  if v_plan.status <> 'in_execution' then raise exception 'INVALID_STATE' using errcode = 'P0001'; end if;

  -- Chỉ cho đổi "êm" khi mọi task còn pending + chưa bắt đầu (todo/blocked).
  select count(*) into v_blocking from public.mkt_tasks
  where channel_plan_id = p_plan_id and deleted_at is null
    and not (acceptance_status = 'pending' and task_status in ('todo', 'blocked'));
  if v_blocking > 0 then raise exception 'PLAN_TASKS_IN_PROGRESS' using errcode = 'P0001'; end if;

  -- Huỷ mềm task pending (sẽ sinh lại sau khi duyệt bản mới)
  update public.mkt_tasks set task_status = 'canceled', deleted_at = now(), updated_by = v_actor
  where channel_plan_id = p_plan_id and deleted_at is null;
  get diagnostics v_canceled = row_count;

  update public.mkt_channel_plan_versions set status = 'superseded' where id = v_plan.current_version_id;
  update public.mkt_channel_plans
  set status = 'planning', version_number = v_plan.version_number + 1, revision_count = v_plan.revision_count + 1, updated_by = v_actor
  where id = p_plan_id;
  update public.mkt_channel_work_packages set status = 'planning', updated_by = v_actor where id = v_plan.work_package_id;

  perform public.mkt_enqueue_notification(
    v_plan.tenant_id, v_plan.owner_id, 'mkt_plan_change_requested', 'Kế hoạch mở lại để chỉnh sửa', p_reason,
    'mkt_channel_plan', p_plan_id, '/mkt/planning?plan=' || p_plan_id::text, '{}'::jsonb,
    'mkt_plan_change:' || p_plan_id::text || ':' || (v_plan.version_number + 1)::text
  );
  perform public.mkt_record_audit(v_plan.tenant_id, v_actor, 'mkt_channel_plan_change_requested', 'mkt_channel_plan', p_plan_id, to_jsonb(v_plan), jsonb_build_object('reason', p_reason, 'canceled_tasks', v_canceled));
  return jsonb_build_object('success', true, 'canceledTasks', v_canceled, 'versionNumber', v_plan.version_number + 1);
end;
$$;
revoke all on function public.mkt_open_plan_change_request(uuid, text) from public, anon;
grant execute on function public.mkt_open_plan_change_request(uuid, text) to authenticated;

notify pgrst, 'reload schema';
